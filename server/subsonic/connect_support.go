package subsonic

import (
	"context"

	"github.com/navidrome/navidrome/conf"
	"github.com/navidrome/navidrome/core/connect"
	"github.com/navidrome/navidrome/log"
	"github.com/navidrome/navidrome/server/events"
	"github.com/navidrome/navidrome/server/subsonic/responses"
)

func newConnectDeviceManager(broker events.Broker) (deviceManager connect.DeviceManager) {
	if !conf.Server.Connect.Enabled || broker == nil {
		return nil
	}
	defer func() {
		if recovered := recover(); recovered != nil {
			log.Error("Disabling connect playback after initialization failure", "panic", recovered)
			deviceManager = nil
		}
	}()
	return connect.NewDeviceManager(broker)
}

func (api *Router) connectAvailable() bool {
	return conf.Server.Connect.Enabled && api.connectDevices != nil && api.broker != nil
}

func (api *Router) withConnectSupport(ctx context.Context, fn func(connect.DeviceManager)) {
	if !api.connectAvailable() {
		return
	}
	defer func() {
		if recovered := recover(); recovered != nil {
			log.Error(ctx, "Connect playback integration failed", "panic", recovered)
		}
	}()
	fn(api.connectDevices)
}

func (api *Router) requireConnect() error {
	if api.connectAvailable() {
		return nil
	}
	return newError(responses.ErrorGeneric, "connect playback is unavailable")
}
