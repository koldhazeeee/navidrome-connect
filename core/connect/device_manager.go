package connect

import (
	"context"
	"sync"
	"time"

	"github.com/navidrome/navidrome/log"
	"github.com/navidrome/navidrome/model/request"
	"github.com/navidrome/navidrome/server/events"
)

// DeviceInfo represents an online device connected through the SSE event stream.
type DeviceInfo struct {
	ClientUniqueId string
	Username       string
	ConnectedAt    time.Time
}

// HostState tracks the device currently acting as the host for a user.
type HostState struct {
	DeviceId                 string
	TrackId                  string
	PositionMs               int64
	Playing                  bool
	SetAt                    time.Time
	IgnoreLowerPositionUntil time.Time
}

func (h *HostState) EstimatedPositionMs() int64 {
	if h == nil {
		return 0
	}
	if !h.Playing {
		return h.PositionMs
	}
	return h.PositionMs + time.Since(h.SetAt).Milliseconds()
}

type DeviceManager interface {
	OnDeviceConnected(username, clientUniqueId string)
	OnDeviceDisconnected(username, clientUniqueId string)
	GetDevicesForUser(username string) []DeviceInfo
	IsOnline(username, clientUniqueId string) bool
	SetHost(username string, state HostState)
	SetHostIfNone(username string, state HostState) bool
	GetHost(username string) *HostState
	ClearHost(username string)
}

type lifecycleBroker interface {
	SetOnConnect(func(username, clientUniqueId string))
	SetOnDisconnect(func(username, clientUniqueId string))
}

type deviceManager struct {
	mu      sync.RWMutex
	devices map[string]map[string]DeviceInfo
	hosts   map[string]*HostState
	broker  events.Broker
}

func NewDeviceManager(broker events.Broker) DeviceManager {
	dm := &deviceManager{
		devices: make(map[string]map[string]DeviceInfo),
		hosts:   make(map[string]*HostState),
		broker:  broker,
	}
	if lifecycle, ok := broker.(lifecycleBroker); ok {
		lifecycle.SetOnConnect(dm.OnDeviceConnected)
		lifecycle.SetOnDisconnect(dm.OnDeviceDisconnected)
	}
	return dm
}

func (dm *deviceManager) OnDeviceConnected(username, clientUniqueId string) {
	if username == "" || clientUniqueId == "" {
		return
	}

	dm.mu.Lock()
	if _, ok := dm.devices[username]; !ok {
		dm.devices[username] = make(map[string]DeviceInfo)
	}
	dm.devices[username][clientUniqueId] = DeviceInfo{
		ClientUniqueId: clientUniqueId,
		Username:       username,
		ConnectedAt:    time.Now(),
	}
	hostState := dm.hosts[username]
	dm.mu.Unlock()

	if hostState == nil || hostState.DeviceId == clientUniqueId || dm.broker == nil {
		return
	}

	go func() {
		time.Sleep(200 * time.Millisecond)
		ctx := request.WithUsername(context.Background(), username)
		ctx = request.WithTargetClientUniqueId(ctx, clientUniqueId)
		dm.broker.SendMessage(ctx, &events.ConnectCommand{
			ForUser:        username,
			TargetDeviceId: clientUniqueId,
			Command:        "becomeFollower",
			HostDeviceId:   hostState.DeviceId,
			TrackId:        hostState.TrackId,
			PositionMs:     hostState.EstimatedPositionMs(),
			StartPlaying:   hostState.Playing,
		})
	}()
}

func (dm *deviceManager) OnDeviceDisconnected(username, clientUniqueId string) {
	if username == "" || clientUniqueId == "" {
		return
	}

	dm.mu.Lock()
	if userDevices, ok := dm.devices[username]; ok {
		delete(userDevices, clientUniqueId)
		if len(userDevices) == 0 {
			delete(dm.devices, username)
		}
	}

	wasHost := false
	remainingDevices := make([]string, 0)
	if hostState, ok := dm.hosts[username]; ok && hostState.DeviceId == clientUniqueId {
		delete(dm.hosts, username)
		wasHost = true
		if userDevices, ok := dm.devices[username]; ok {
			for id := range userDevices {
				remainingDevices = append(remainingDevices, id)
			}
		}
	}
	dm.mu.Unlock()

	if !wasHost || len(remainingDevices) == 0 || dm.broker == nil {
		return
	}

	go func() {
		for _, deviceID := range remainingDevices {
			ctx := request.WithUsername(context.Background(), username)
			ctx = request.WithTargetClientUniqueId(ctx, deviceID)
			dm.broker.SendMessage(ctx, &events.ConnectCommand{
				ForUser:        username,
				TargetDeviceId: deviceID,
				Command:        "exitFollower",
			})
		}
	}()
}

func (dm *deviceManager) GetDevicesForUser(username string) []DeviceInfo {
	dm.mu.RLock()
	defer dm.mu.RUnlock()

	userDevices, ok := dm.devices[username]
	if !ok {
		return nil
	}

	result := make([]DeviceInfo, 0, len(userDevices))
	for _, device := range userDevices {
		result = append(result, device)
	}
	return result
}

func (dm *deviceManager) IsOnline(username, clientUniqueId string) bool {
	dm.mu.RLock()
	defer dm.mu.RUnlock()

	if userDevices, ok := dm.devices[username]; ok {
		_, exists := userDevices[clientUniqueId]
		return exists
	}
	return false
}

func (dm *deviceManager) SetHost(username string, state HostState) {
	dm.mu.Lock()
	defer dm.mu.Unlock()

	if userDevices, ok := dm.devices[username]; ok {
		if _, exists := userDevices[state.DeviceId]; !exists {
			log.Warn("Ignoring connect host update for offline device", "username", username, "deviceId", state.DeviceId)
			return
		}
	}
	state.SetAt = time.Now()
	dm.hosts[username] = &state
}

func (dm *deviceManager) SetHostIfNone(username string, state HostState) bool {
	dm.mu.Lock()
	defer dm.mu.Unlock()

	if dm.hosts[username] != nil {
		return false
	}
	state.SetAt = time.Now()
	dm.hosts[username] = &state
	return true
}

func (dm *deviceManager) GetHost(username string) *HostState {
	dm.mu.RLock()
	defer dm.mu.RUnlock()
	return dm.hosts[username]
}

func (dm *deviceManager) ClearHost(username string) {
	dm.mu.Lock()
	defer dm.mu.Unlock()
	delete(dm.hosts, username)
}
