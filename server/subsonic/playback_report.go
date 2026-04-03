package subsonic

import (
	"net/http"
	"strconv"
	"time"

	"github.com/navidrome/navidrome/core/connect"
	"github.com/navidrome/navidrome/core/scrobbler"
	"github.com/navidrome/navidrome/log"
	"github.com/navidrome/navidrome/model/request"
	"github.com/navidrome/navidrome/server/events"
	"github.com/navidrome/navidrome/server/subsonic/responses"
	"github.com/navidrome/navidrome/utils/req"
)

const connectHostPreSeekGracePeriod = 8 * time.Second

func (api *Router) ReportPlayback(r *http.Request) (*responses.Subsonic, error) {
	p := req.Params(r)

	mediaID, err := p.String("mediaId")
	if err != nil {
		return nil, err
	}

	mediaType, err := p.String("mediaType")
	if err != nil {
		return nil, err
	}
	if !isValidMediaType(mediaType) {
		return nil, newError(responses.ErrorGeneric, "mediaType '%s' is not yet supported", mediaType)
	}

	positionMs, err := p.Int64("positionMs")
	if err != nil {
		return nil, err
	}
	if positionMs < 0 {
		return nil, newError(responses.ErrorGeneric, "positionMs must be greater than or equal to 0")
	}

	state, err := p.String("state")
	if err != nil {
		return nil, err
	}
	playbackState := scrobbler.PlaybackState(state)
	if !playbackState.IsValid() {
		return nil, newError(responses.ErrorGeneric, "invalid playback state: %s", state)
	}

	playbackRate, err := parsePlaybackRate(p)
	if err != nil {
		return nil, err
	}

	ctx := r.Context()
	player, _ := request.PlayerFrom(ctx)
	playerID, ok := request.ClientUniqueIdFrom(ctx)
	if !ok || playerID == "" {
		playerID = player.ID
	}
	playerName, _ := request.ClientFrom(ctx)
	if playerName == "" {
		playerName = player.Name
	}
	playMode := p.StringOr("playMode", "")

	err = api.scrobbler.ReportPlayback(ctx, scrobbler.PlaybackReport{
		TrackID:        mediaID,
		PlayerID:       playerID,
		PlayerName:     playerName,
		PositionMs:     positionMs,
		State:          playbackState,
		PlaybackRate:   playbackRate,
		IgnoreScrobble: p.BoolOr("ignoreScrobble", false),
	})
	if err != nil {
		return nil, err
	}

	api.withConnectSupport(ctx, func(deviceManager connect.DeviceManager) {
		username, ok := request.UsernameFrom(ctx)
		if !ok || username == "" {
			return
		}

		mediaFile, mediaErr := api.ds.MediaFile(ctx).Get(mediaID)
		if mediaErr != nil {
			log.Warn(ctx, "Could not load media file for connect playback update", "mediaId", mediaID, mediaErr)
			mediaFile = nil
		}

		durationMs := int64(0)
		title := ""
		artist := ""
		if mediaFile != nil {
			durationMs = int64(mediaFile.Duration * 1000)
			title = mediaFile.Title
			artist = mediaFile.Artist
		}

		hostState := deviceManager.GetHost(username)
		if hostState != nil && hostState.DeviceId == playerID && hostState.TrackId == mediaID {
			if hostState.IgnoreLowerPositionUntil.After(time.Now()) && positionMs < hostState.PositionMs-5000 {
				log.Debug(
					ctx,
					"Ignoring pre-seek playback report for connect host",
					"playerId", playerID,
					"reportedPositionMs", positionMs,
					"expectedPositionMs", hostState.EstimatedPositionMs(),
					"ignoreLowerPositionUntil", hostState.IgnoreLowerPositionUntil,
				)
				return
			}
		}

		api.broker.SendMessage(ctx, &events.ConnectStateChanged{
			ForUser:    username,
			DeviceId:   playerID,
			TrackId:    mediaID,
			Title:      title,
			Artist:     artist,
			State:      string(playbackState),
			PositionMs: positionMs,
			DurationMs: durationMs,
			PlayMode:   playMode,
		})

		switch {
		case hostState != nil && hostState.DeviceId == playerID:
			deviceManager.SetHost(username, connect.HostState{
				DeviceId:   playerID,
				TrackId:    mediaID,
				PositionMs: positionMs,
				Playing:    playbackState == scrobbler.PlaybackStatePlaying,
			})

		case hostState == nil && playbackState == scrobbler.PlaybackStatePlaying:
			if !deviceManager.SetHostIfNone(username, connect.HostState{
				DeviceId:   playerID,
				TrackId:    mediaID,
				PositionMs: positionMs,
				Playing:    true,
			}) {
				return
			}

			for _, device := range deviceManager.GetDevicesForUser(username) {
				if device.ClientUniqueId == playerID {
					continue
				}
				targetCtx := request.WithUsername(ctx, username)
				targetCtx = request.WithTargetClientUniqueId(targetCtx, device.ClientUniqueId)
				api.broker.SendMessage(targetCtx, &events.ConnectCommand{
					ForUser:        username,
					TargetDeviceId: device.ClientUniqueId,
					Command:        "becomeFollower",
					HostDeviceId:   playerID,
					TrackId:        mediaID,
					PositionMs:     positionMs,
					StartPlaying:   true,
				})
			}
		}
	})

	return newResponse(), nil
}

func parsePlaybackRate(p *req.Values) (float64, error) {
	value := p.StringPtr("playbackRate")
	if value == nil || *value == "" {
		return 1.0, nil
	}

	rate, err := strconv.ParseFloat(*value, 64)
	if err != nil {
		return 0, newError(responses.ErrorGeneric, "invalid playbackRate: %s", *value)
	}
	if rate < 0 {
		return 0, newError(responses.ErrorGeneric, "playbackRate must be greater than or equal to 0")
	}
	return rate, nil
}
