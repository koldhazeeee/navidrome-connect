package subsonic

import (
	"net/http"
	"strconv"

	"github.com/navidrome/navidrome/core/scrobbler"
	"github.com/navidrome/navidrome/model/request"
	"github.com/navidrome/navidrome/server/subsonic/responses"
	"github.com/navidrome/navidrome/utils/req"
)

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
