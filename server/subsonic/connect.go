package subsonic

import (
	"fmt"
	"net/http"
	"time"

	"github.com/navidrome/navidrome/core/connect"
	"github.com/navidrome/navidrome/log"
	"github.com/navidrome/navidrome/model/request"
	"github.com/navidrome/navidrome/server/events"
	"github.com/navidrome/navidrome/server/subsonic/responses"
	"github.com/navidrome/navidrome/utils/req"
)

func (api *Router) GetConnectDevices(r *http.Request) (*responses.Subsonic, error) {
	if err := api.requireConnect(); err != nil {
		return nil, err
	}

	ctx := r.Context()
	username, ok := request.UsernameFrom(ctx)
	if !ok || username == "" {
		return nil, newError(responses.ErrorGeneric, "authentication required")
	}

	user, _ := request.UserFrom(ctx)
	nowPlaying, err := api.scrobbler.GetNowPlaying(ctx)
	if err != nil {
		return nil, err
	}

	nowPlayingByDevice := make(map[string]*responses.ConnectNowPlaying)
	for _, np := range nowPlaying {
		if np.Username != username {
			continue
		}

		positionMs := int64(0)
		if current := np.CurrentPositionMs(time.Now()); current != nil {
			positionMs = *current
		}
		nowPlayingByDevice[np.PlayerId] = &responses.ConnectNowPlaying{
			TrackId:    np.MediaFile.ID,
			Title:      np.MediaFile.Title,
			Artist:     np.MediaFile.Artist,
			State:      string(np.State),
			PositionMs: positionMs,
			DurationMs: int64(np.MediaFile.Duration * 1000),
		}
	}

	hostState := api.connectDevices.GetHost(username)
	if hostState != nil && api.connectDevices.IsOnline(username, hostState.DeviceId) {
		if current := nowPlayingByDevice[hostState.DeviceId]; current != nil && current.TrackId == hostState.TrackId {
			current.PositionMs = hostState.EstimatedPositionMs()
		}
	}

	onlineDevices := api.connectDevices.GetDevicesForUser(username)
	result := make([]responses.ConnectDevice, 0, len(onlineDevices))
	for _, device := range onlineDevices {
		name := device.ClientUniqueId
		if user.ID != "" {
			if nickname, nicknameErr := api.ds.UserProps(ctx).Get(user.ID, fmt.Sprintf("connect_device_nickname_%s", device.ClientUniqueId)); nicknameErr == nil && nickname != "" {
				name = nickname
			}
		}

		connectDevice := responses.ConnectDevice{
			Id:       device.ClientUniqueId,
			Name:     name,
			Client:   device.ClientUniqueId,
			IsOnline: true,
			LastSeen: &device.ConnectedAt,
		}
		if current := nowPlayingByDevice[device.ClientUniqueId]; current != nil {
			connectDevice.IsActive = true
			connectDevice.NowPlaying = current
		}
		result = append(result, connectDevice)
	}

	hostDeviceID := ""
	if hostState != nil {
		if api.connectDevices.IsOnline(username, hostState.DeviceId) {
			hostDeviceID = hostState.DeviceId
		} else {
			api.connectDevices.ClearHost(username)
		}
	}

	response := newResponse()
	response.ConnectDevices = &responses.ConnectDevices{
		Device:       result,
		HostDeviceId: hostDeviceID,
	}
	return response, nil
}

func (api *Router) SendConnectCommand(r *http.Request) (*responses.Subsonic, error) {
	if err := api.requireConnect(); err != nil {
		return nil, err
	}

	ctx := r.Context()
	params := req.Params(r)
	username, ok := request.UsernameFrom(ctx)
	if !ok || username == "" {
		return nil, newError(responses.ErrorGeneric, "authentication required")
	}

	deviceID, err := params.String("deviceId")
	if err != nil {
		return nil, newError(responses.ErrorMissingParameter, "missing required parameter: deviceId")
	}

	command, err := params.String("command")
	if err != nil {
		return nil, newError(responses.ErrorMissingParameter, "missing required parameter: command")
	}

	validCommands := map[string]struct{}{
		"play": {}, "pause": {}, "resume": {}, "stop": {}, "seek": {}, "setVolume": {},
		"next": {}, "prev": {}, "setQueue": {}, "startFromState": {}, "setPlayMode": {},
		"becomeFollower": {}, "becomeHost": {}, "exitFollower": {},
	}
	if _, ok := validCommands[command]; !ok {
		return nil, newError(responses.ErrorGeneric, "invalid command: %s", command)
	}

	if !api.connectDevices.IsOnline(username, deviceID) {
		return nil, newError(responses.ErrorGeneric, "target device is not online: %s", deviceID)
	}

	event := &events.ConnectCommand{
		ForUser:        username,
		TargetDeviceId: deviceID,
		Command:        command,
		PositionMs:     int64(params.IntOr("positionMs", 0)),
		TrackId:        params.StringOr("id", ""),
		SelectedId:     params.StringOr("selectedId", ""),
		StartPlaying:   params.BoolOr("startPlaying", false),
		HostDeviceId:   params.StringOr("hostDeviceId", ""),
		PlayMode:       params.StringOr("playMode", ""),
	}
	if volumeStr := params.StringOr("volume", ""); volumeStr != "" {
		volume := params.IntOr("volume", 0)
		event.Volume = &volume
	}
	if ids, idsErr := params.Strings("id"); idsErr == nil && len(ids) > 0 {
		event.TrackIds = ids
		if event.TrackId == "" {
			event.TrackId = ids[0]
		}
	}

	targetCtx := request.WithUsername(ctx, username)
	targetCtx = request.WithTargetClientUniqueId(targetCtx, deviceID)
	api.broker.SendMessage(targetCtx, event)

	return newResponse(), nil
}

func (api *Router) TransferPlayback(r *http.Request) (*responses.Subsonic, error) {
	if err := api.requireConnect(); err != nil {
		return nil, err
	}

	ctx := r.Context()
	params := req.Params(r)
	username, ok := request.UsernameFrom(ctx)
	if !ok || username == "" {
		return nil, newError(responses.ErrorGeneric, "authentication required")
	}

	targetDeviceID, err := params.String("deviceId")
	if err != nil {
		return nil, newError(responses.ErrorMissingParameter, "missing required parameter: deviceId")
	}
	if !api.connectDevices.IsOnline(username, targetDeviceID) {
		return nil, newError(responses.ErrorGeneric, "target device is not online: %s", targetDeviceID)
	}

	requestedTrackID := params.StringOr("id", "")
	requestedPositionMs := params.Int64Or("positionMs", -1)
	startPlayingPtr := params.BoolPtr("startPlaying")
	startPlaying := params.BoolOr("startPlaying", true)
	sourceDeviceID := ""
	trackID := ""
	positionMs := int64(0)
	isPlaying := false

	if hostState := api.connectDevices.GetHost(username); hostState != nil {
		sourceDeviceID = hostState.DeviceId
		trackID = hostState.TrackId
		positionMs = hostState.EstimatedPositionMs()
		isPlaying = hostState.Playing
	} else {
		nowPlaying, nowPlayingErr := api.scrobbler.GetNowPlaying(ctx)
		if nowPlayingErr != nil {
			return nil, nowPlayingErr
		}
		for _, np := range nowPlaying {
			if np.Username != username {
				continue
			}
			sourceDeviceID = np.PlayerId
			trackID = np.MediaFile.ID
			if current := np.CurrentPositionMs(time.Now()); current != nil {
				positionMs = *current
			}
			isPlaying = np.State == "playing"
			break
		}
	}
	if requestedTrackID != "" {
		trackID = requestedTrackID
	}
	if requestedPositionMs >= 0 {
		positionMs = requestedPositionMs
	}
	effectivePlaying := startPlaying && isPlaying
	if startPlayingPtr != nil {
		effectivePlaying = *startPlayingPtr
	}

	if sourceDeviceID != "" && sourceDeviceID != targetDeviceID && api.connectDevices.IsOnline(username, sourceDeviceID) {
		stopCtx := request.WithUsername(ctx, username)
		stopCtx = request.WithTargetClientUniqueId(stopCtx, sourceDeviceID)
		api.broker.SendMessage(stopCtx, &events.ConnectCommand{
			ForUser:        username,
			TargetDeviceId: sourceDeviceID,
			Command:        "stop",
		})
	}

	api.connectDevices.SetHost(username, connect.HostState{
		DeviceId:                 targetDeviceID,
		TrackId:                  trackID,
		PositionMs:               positionMs,
		Playing:                  effectivePlaying,
		IgnoreLowerPositionUntil: time.Now().Add(connectHostPreSeekGracePeriod),
	})

	targetCtx := request.WithUsername(ctx, username)
	targetCtx = request.WithTargetClientUniqueId(targetCtx, targetDeviceID)
	api.broker.SendMessage(targetCtx, &events.ConnectCommand{
		ForUser:        username,
		TargetDeviceId: targetDeviceID,
		Command:        "becomeHost",
		TrackId:        trackID,
		PositionMs:     positionMs,
		StartPlaying:   effectivePlaying,
	})

	for _, device := range api.connectDevices.GetDevicesForUser(username) {
		if device.ClientUniqueId == targetDeviceID {
			continue
		}
		followerCtx := request.WithUsername(ctx, username)
		followerCtx = request.WithTargetClientUniqueId(followerCtx, device.ClientUniqueId)
		api.broker.SendMessage(followerCtx, &events.ConnectCommand{
			ForUser:        username,
			TargetDeviceId: device.ClientUniqueId,
			Command:        "becomeFollower",
			HostDeviceId:   targetDeviceID,
			TrackId:        trackID,
			PositionMs:     positionMs,
			StartPlaying:   effectivePlaying,
		})
	}

	response := newResponse()
	response.ConnectTransfer = &responses.ConnectTransfer{
		SourceDevice: sourceDeviceID,
		TargetDevice: targetDeviceID,
		TrackId:      trackID,
		PositionMs:   positionMs,
		Playing:      effectivePlaying,
	}
	return response, nil
}

func (api *Router) SetDeviceNickname(r *http.Request) (*responses.Subsonic, error) {
	if err := api.requireConnect(); err != nil {
		return nil, err
	}

	ctx := r.Context()
	params := req.Params(r)
	user, ok := request.UserFrom(ctx)
	if !ok || user.ID == "" {
		return nil, newError(responses.ErrorGeneric, "authentication required")
	}

	deviceID, err := params.String("deviceId")
	if err != nil {
		return nil, newError(responses.ErrorMissingParameter, "missing required parameter: deviceId")
	}

	nicknamePtr := params.StringPtr("nickname")
	if nicknamePtr == nil {
		return nil, newError(responses.ErrorMissingParameter, "missing required parameter: nickname")
	}
	nickname := *nicknamePtr

	key := fmt.Sprintf("connect_device_nickname_%s", deviceID)
	if nickname == "" {
		if err := api.ds.UserProps(ctx).Delete(user.ID, key); err != nil {
			log.Warn(ctx, "Could not clear connect device nickname", "deviceId", deviceID, err)
		}
		return newResponse(), nil
	}

	if err := api.ds.UserProps(ctx).Put(user.ID, key, nickname); err != nil {
		return nil, newError(responses.ErrorGeneric, "failed to save nickname")
	}

	return newResponse(), nil
}
