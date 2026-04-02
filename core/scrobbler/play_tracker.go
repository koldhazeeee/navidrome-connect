package scrobbler

import (
	"context"
	"maps"
	"sort"
	"sync"
	"time"

	"github.com/navidrome/navidrome/conf"
	"github.com/navidrome/navidrome/consts"
	"github.com/navidrome/navidrome/log"
	"github.com/navidrome/navidrome/model"
	"github.com/navidrome/navidrome/model/request"
	"github.com/navidrome/navidrome/server/events"
	"github.com/navidrome/navidrome/utils/cache"
	"github.com/navidrome/navidrome/utils/singleton"
)

type NowPlayingInfo struct {
	MediaFile    model.MediaFile
	Start        time.Time
	Position     int
	Username     string
	PlayerId     string
	PlayerName   string
	State        PlaybackState
	PositionMs   *int64
	PlaybackRate *float64
}

type Submission struct {
	TrackID   string
	Timestamp time.Time
}

type PlaybackState string

const (
	PlaybackStateStarting PlaybackState = "starting"
	PlaybackStatePlaying  PlaybackState = "playing"
	PlaybackStatePaused   PlaybackState = "paused"
	PlaybackStateStopped  PlaybackState = "stopped"
)

type PlaybackReport struct {
	TrackID        string
	PlayerID       string
	PlayerName     string
	PositionMs     int64
	State          PlaybackState
	PlaybackRate   float64
	IgnoreScrobble bool
}

func (s PlaybackState) IsValid() bool {
	switch s {
	case PlaybackStateStarting, PlaybackStatePlaying, PlaybackStatePaused, PlaybackStateStopped:
		return true
	default:
		return false
	}
}

func (n NowPlayingInfo) CurrentPositionMs(now time.Time) *int64 {
	if n.PositionMs == nil {
		return nil
	}

	position := *n.PositionMs
	if n.State == PlaybackStatePlaying && n.PlaybackRate != nil && *n.PlaybackRate > 0 {
		elapsedMs := max(now.Sub(n.Start).Milliseconds(), int64(0))
		position += int64(float64(elapsedMs) * *n.PlaybackRate)
	}
	if position < 0 {
		position = 0
	}
	if n.MediaFile.Duration > 0 {
		durationMs := int64(float64(n.MediaFile.Duration) * 1000)
		position = min(position, durationMs)
	}
	return &position
}

type nowPlayingEntry struct {
	ctx      context.Context
	userId   string
	track    *model.MediaFile
	position int
}

type PlayTracker interface {
	NowPlaying(ctx context.Context, playerId string, playerName string, trackId string, position int) error
	ReportPlayback(ctx context.Context, report PlaybackReport) error
	GetNowPlaying(ctx context.Context) ([]NowPlayingInfo, error)
	Submit(ctx context.Context, submissions []Submission) error
}

const (
	playbackReportGracePeriod = 30 * time.Minute
	playbackReportStoppedTTL  = 2 * time.Second
)

// PluginLoader is a minimal interface for plugin manager usage in PlayTracker
// (avoids import cycles)
type PluginLoader interface {
	PluginNames(capability string) []string
	LoadScrobbler(name string) (Scrobbler, bool)
}

type playTracker struct {
	ds                model.DataStore
	broker            events.Broker
	playMap           cache.SimpleCache[string, NowPlayingInfo]
	builtinScrobblers map[string]Scrobbler
	pluginScrobblers  map[string]Scrobbler
	pluginLoader      PluginLoader
	mu                sync.RWMutex
	npQueue           map[string]nowPlayingEntry
	npMu              sync.Mutex
	npSignal          chan struct{}
	shutdown          chan struct{}
	workerDone        chan struct{}
}

func GetPlayTracker(ds model.DataStore, broker events.Broker, pluginManager PluginLoader) PlayTracker {
	return singleton.GetInstance(func() *playTracker {
		return newPlayTracker(ds, broker, pluginManager)
	})
}

// This constructor only exists for testing. For normal usage, the PlayTracker has to be a singleton, returned by
// the GetPlayTracker function above
func newPlayTracker(ds model.DataStore, broker events.Broker, pluginManager PluginLoader) *playTracker {
	m := cache.NewSimpleCache[string, NowPlayingInfo]()
	p := &playTracker{
		ds:                ds,
		playMap:           m,
		broker:            broker,
		builtinScrobblers: make(map[string]Scrobbler),
		pluginScrobblers:  make(map[string]Scrobbler),
		pluginLoader:      pluginManager,
		npQueue:           make(map[string]nowPlayingEntry),
		npSignal:          make(chan struct{}, 1),
		shutdown:          make(chan struct{}),
		workerDone:        make(chan struct{}),
	}
	if conf.Server.EnableNowPlaying {
		m.OnExpiration(func(_ string, _ NowPlayingInfo) {
			broker.SendBroadcastMessage(context.Background(), &events.NowPlayingCount{Count: m.Len()})
		})
	}

	var enabled []string
	for name, constructor := range constructors {
		s := constructor(ds)
		if s == nil {
			log.Debug("Scrobbler not available. Missing configuration?", "name", name)
			continue
		}
		enabled = append(enabled, name)
		s = newBufferedScrobbler(ds, s, name)
		p.builtinScrobblers[name] = s
	}
	log.Debug("List of builtin scrobblers enabled", "names", enabled)
	go p.nowPlayingWorker()
	return p
}

// stopNowPlayingWorker stops the background worker. This is primarily for testing.
func (p *playTracker) stopNowPlayingWorker() {
	close(p.shutdown)
	<-p.workerDone // Wait for worker to finish
}

// pluginNamesMatchScrobblers returns true if the set of pluginNames matches the keys in pluginScrobblers.
func pluginNamesMatchScrobblers(pluginNames []string, scrobblers map[string]Scrobbler) bool {
	if len(pluginNames) != len(scrobblers) {
		return false
	}
	for _, name := range pluginNames {
		if _, ok := scrobblers[name]; !ok {
			return false
		}
	}
	return true
}

// refreshPluginScrobblers updates the pluginScrobblers map to match the current set of plugin scrobblers.
// The buffered scrobblers use a loader function to dynamically get the current plugin instance,
// so we only need to add/remove scrobblers when plugins are added/removed (not when reloaded).
func (p *playTracker) refreshPluginScrobblers() {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.pluginLoader == nil {
		return
	}

	// Get the list of available plugin names
	pluginNames := p.pluginLoader.PluginNames("Scrobbler")

	// Early return if plugin names match existing scrobblers (no change)
	if pluginNamesMatchScrobblers(pluginNames, p.pluginScrobblers) {
		return
	}

	// Build a set of current plugins for faster lookups
	current := make(map[string]struct{}, len(pluginNames))

	// Process additions - add new plugins with a loader that dynamically fetches the current instance
	for _, name := range pluginNames {
		current[name] = struct{}{}
		if _, exists := p.pluginScrobblers[name]; !exists {
			// Capture the name for the closure
			pluginName := name
			loader := p.pluginLoader
			p.pluginScrobblers[name] = newBufferedScrobblerWithLoader(p.ds, name, func() (Scrobbler, bool) {
				return loader.LoadScrobbler(pluginName)
			})
		}
	}

	type stoppableScrobbler interface {
		Scrobbler
		Stop()
	}

	// Process removals - remove plugins that no longer exist
	for name, scrobbler := range p.pluginScrobblers {
		if _, exists := current[name]; !exists {
			// If the scrobbler implements stoppableScrobbler, call Stop() before removing it
			if stoppable, ok := scrobbler.(stoppableScrobbler); ok {
				log.Debug("Stopping scrobbler", "name", name)
				stoppable.Stop()
			}
			delete(p.pluginScrobblers, name)
		}
	}
}

// getActiveScrobblers refreshes plugin scrobblers, acquires a read lock,
// combines builtin and plugin scrobblers into a new map, releases the lock,
// and returns the combined map.
func (p *playTracker) getActiveScrobblers() map[string]Scrobbler {
	p.refreshPluginScrobblers()
	p.mu.RLock()
	defer p.mu.RUnlock()
	combined := maps.Clone(p.builtinScrobblers)
	maps.Copy(combined, p.pluginScrobblers)
	return combined
}

func (p *playTracker) NowPlaying(ctx context.Context, playerId string, playerName string, trackId string, position int) error {
	mf, err := p.ds.MediaFile(ctx).GetWithParticipants(trackId)
	if err != nil {
		log.Error(ctx, "Error retrieving mediaFile", "id", trackId, err)
		return err
	}

	user, _ := request.UserFrom(ctx)
	positionMs := int64(max(position, 0)) * 1000
	playbackRate := 1.0
	info := NowPlayingInfo{
		MediaFile:    *mf,
		Start:        time.Now(),
		Position:     position,
		Username:     user.UserName,
		PlayerId:     playerId,
		PlayerName:   playerName,
		State:        PlaybackStatePlaying,
		PositionMs:   &positionMs,
		PlaybackRate: &playbackRate,
	}

	// Calculate TTL based on remaining track duration. If position exceeds track duration,
	// remaining is set to 0 to avoid negative TTL.
	remaining := max(int(mf.Duration)-position, 0)
	// Add 5 seconds buffer to ensure the NowPlaying info is available slightly longer than the track duration.
	ttl := time.Duration(remaining+5) * time.Second
	p.storeNowPlaying(ctx, playerId, info, ttl)
	player, _ := request.PlayerFrom(ctx)
	if player.ScrobbleEnabled {
		p.enqueueNowPlaying(ctx, playerId, user.ID, mf, position)
	}
	return nil
}

func (p *playTracker) ReportPlayback(ctx context.Context, report PlaybackReport) error {
	current, hasCurrent := p.currentPlayback(report.PlayerID)
	if report.State == PlaybackStateStopped && (!hasCurrent || current.MediaFile.ID != report.TrackID || current.State == PlaybackStateStopped) {
		return nil
	}

	mf, err := p.trackForPlaybackReport(ctx, report.TrackID, current, hasCurrent)
	if err != nil {
		return err
	}

	user, _ := request.UserFrom(ctx)
	positionMs := max(report.PositionMs, int64(0))
	playbackRate := report.PlaybackRate
	info := NowPlayingInfo{
		MediaFile:    *mf,
		Start:        time.Now(),
		Position:     int(positionMs / 1000),
		Username:     user.UserName,
		PlayerId:     report.PlayerID,
		PlayerName:   report.PlayerName,
		State:        report.State,
		PositionMs:   &positionMs,
		PlaybackRate: &playbackRate,
	}

	p.storeNowPlaying(ctx, report.PlayerID, info, reportPlaybackTTL(*mf, positionMs, report.State, playbackRate))

	player, _ := request.PlayerFrom(ctx)
	if report.State != PlaybackStateStopped && !report.IgnoreScrobble && player.ScrobbleEnabled {
		p.enqueueNowPlaying(ctx, report.PlayerID, user.ID, mf, info.Position)
	}

	if report.State == PlaybackStateStopped && !report.IgnoreScrobble && hasCurrent &&
		current.MediaFile.ID == report.TrackID && shouldSubmitPlaybackReport(*mf, positionMs) {
		return p.Submit(ctx, []Submission{{TrackID: report.TrackID, Timestamp: time.Now()}})
	}

	return nil
}

func (p *playTracker) enqueueNowPlaying(ctx context.Context, playerId string, userId string, track *model.MediaFile, position int) {
	p.npMu.Lock()
	defer p.npMu.Unlock()
	ctx = context.WithoutCancel(ctx) // Prevent cancellation from affecting background processing
	p.npQueue[playerId] = nowPlayingEntry{
		ctx:      ctx,
		userId:   userId,
		track:    track,
		position: position,
	}
	p.sendNowPlayingSignal()
}

func (p *playTracker) sendNowPlayingSignal() {
	// Don't block if the previous signal was not read yet
	select {
	case p.npSignal <- struct{}{}:
	default:
	}
}

func (p *playTracker) storeNowPlaying(ctx context.Context, playerID string, info NowPlayingInfo, ttl time.Duration) {
	_ = p.playMap.AddWithTTL(playerID, info, ttl)
	if conf.Server.EnableNowPlaying {
		p.broker.SendBroadcastMessage(ctx, &events.NowPlayingCount{Count: p.playMap.Len()})
	}
}

func (p *playTracker) currentPlayback(playerID string) (NowPlayingInfo, bool) {
	info, err := p.playMap.Get(playerID)
	if err != nil {
		return NowPlayingInfo{}, false
	}
	return info, true
}

func (p *playTracker) trackForPlaybackReport(ctx context.Context, trackID string, current NowPlayingInfo, hasCurrent bool) (*model.MediaFile, error) {
	if hasCurrent && current.MediaFile.ID == trackID {
		return &current.MediaFile, nil
	}
	mf, err := p.ds.MediaFile(ctx).GetWithParticipants(trackID)
	if err != nil {
		log.Error(ctx, "Error retrieving mediaFile", "id", trackID, err)
		return nil, err
	}
	return mf, nil
}

func reportPlaybackTTL(track model.MediaFile, positionMs int64, state PlaybackState, playbackRate float64) time.Duration {
	if state == PlaybackStateStopped {
		return playbackReportStoppedTTL
	}

	durationMs := int64(float64(track.Duration) * 1000)
	if durationMs <= 0 {
		return playbackReportGracePeriod
	}

	remainingMs := max(durationMs-positionMs, int64(0))
	if state == PlaybackStatePlaying && playbackRate > 0 {
		return time.Duration(float64(remainingMs)/playbackRate)*time.Millisecond + playbackReportGracePeriod
	}
	return time.Duration(remainingMs)*time.Millisecond + playbackReportGracePeriod
}

func shouldSubmitPlaybackReport(track model.MediaFile, positionMs int64) bool {
	durationMs := int64(float64(track.Duration) * 1000)
	if durationMs <= 0 {
		return false
	}
	thresholdMs := min(durationMs/2, int64((4*time.Minute)/time.Millisecond))
	return positionMs >= thresholdMs
}

func (p *playTracker) nowPlayingWorker() {
	defer close(p.workerDone)
	for {
		select {
		case <-p.shutdown:
			return
		case <-time.After(time.Second):
		case <-p.npSignal:
		}

		p.npMu.Lock()
		if len(p.npQueue) == 0 {
			p.npMu.Unlock()
			continue
		}

		// Keep a copy of the entries to process and clear the queue
		entries := p.npQueue
		p.npQueue = make(map[string]nowPlayingEntry)
		p.npMu.Unlock()

		// Process entries without holding lock
		for _, entry := range entries {
			p.dispatchNowPlaying(entry.ctx, entry.userId, entry.track, entry.position)
		}
	}
}

func (p *playTracker) dispatchNowPlaying(ctx context.Context, userId string, t *model.MediaFile, position int) {
	if t.Artist == consts.UnknownArtist {
		log.Debug(ctx, "Ignoring external NowPlaying update for track with unknown artist", "track", t.Title, "artist", t.Artist)
		return
	}
	allScrobblers := p.getActiveScrobblers()
	for name, s := range allScrobblers {
		if !s.IsAuthorized(ctx, userId) {
			continue
		}
		log.Debug(ctx, "Sending NowPlaying update", "scrobbler", name, "track", t.Title, "artist", t.Artist, "position", position)
		err := s.NowPlaying(ctx, userId, t, position)
		if err != nil {
			log.Error(ctx, "Error sending NowPlayingInfo", "scrobbler", name, "track", t.Title, "artist", t.Artist, err)
			continue
		}
	}
}

func (p *playTracker) GetNowPlaying(_ context.Context) ([]NowPlayingInfo, error) {
	res := p.playMap.Values()
	sort.Slice(res, func(i, j int) bool {
		return res[i].Start.After(res[j].Start)
	})
	return res, nil
}

func (p *playTracker) Submit(ctx context.Context, submissions []Submission) error {
	username, _ := request.UsernameFrom(ctx)
	player, _ := request.PlayerFrom(ctx)
	if !player.ScrobbleEnabled {
		log.Debug(ctx, "External scrobbling disabled for this player", "player", player.Name, "ip", player.IP, "user", username)
	}
	event := &events.RefreshResource{}
	success := 0

	for _, s := range submissions {
		mf, err := p.ds.MediaFile(ctx).GetWithParticipants(s.TrackID)
		if err != nil {
			log.Error(ctx, "Cannot find track for scrobbling", "id", s.TrackID, "user", username, err)
			continue
		}
		err = p.incPlay(ctx, mf, s.Timestamp)
		if err != nil {
			log.Error(ctx, "Error updating play counts", "id", mf.ID, "track", mf.Title, "user", username, err)
		} else {
			success++
			event.With("song", mf.ID).With("album", mf.AlbumID).With("artist", mf.AlbumArtistID)
			log.Info(ctx, "Scrobbled", "title", mf.Title, "artist", mf.Artist, "user", username, "timestamp", s.Timestamp)
			if player.ScrobbleEnabled {
				p.dispatchScrobble(ctx, mf, s.Timestamp)
			}
		}
	}

	if success > 0 {
		p.broker.SendMessage(ctx, event)
	}
	return nil
}

func (p *playTracker) incPlay(ctx context.Context, track *model.MediaFile, timestamp time.Time) error {
	return p.ds.WithTx(func(tx model.DataStore) error {
		err := tx.MediaFile(ctx).IncPlayCount(track.ID, timestamp)
		if err != nil {
			return err
		}
		err = tx.Album(ctx).IncPlayCount(track.AlbumID, timestamp)
		if err != nil {
			return err
		}
		for _, artist := range track.Participants[model.RoleArtist] {
			err = tx.Artist(ctx).IncPlayCount(artist.ID, timestamp)
			if err != nil {
				return err
			}
		}
		if conf.Server.EnableScrobbleHistory {
			return tx.Scrobble(ctx).RecordScrobble(track.ID, timestamp)
		}
		return nil
	})
}

func (p *playTracker) dispatchScrobble(ctx context.Context, t *model.MediaFile, playTime time.Time) {
	if t.Artist == consts.UnknownArtist {
		log.Debug(ctx, "Ignoring external Scrobble for track with unknown artist", "track", t.Title, "artist", t.Artist)
		return
	}

	allScrobblers := p.getActiveScrobblers()
	u, _ := request.UserFrom(ctx)
	scrobble := Scrobble{MediaFile: *t, TimeStamp: playTime}
	for name, s := range allScrobblers {
		if !s.IsAuthorized(ctx, u.ID) {
			continue
		}
		log.Debug(ctx, "Buffering Scrobble", "scrobbler", name, "track", t.Title, "artist", t.Artist)
		err := s.Scrobble(ctx, u.ID, scrobble)
		if err != nil {
			log.Error(ctx, "Error sending Scrobble", "scrobbler", name, "track", t.Title, "artist", t.Artist, err)
			continue
		}
	}
}

var constructors map[string]Constructor

func Register(name string, init Constructor) {
	if constructors == nil {
		constructors = make(map[string]Constructor)
	}
	constructors[name] = init
}
