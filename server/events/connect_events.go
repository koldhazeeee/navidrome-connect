package events

// ConnectCommand is sent to a specific device to execute a playback control action.
type ConnectCommand struct {
	baseEvent
	ForUser        string   `json:"forUser"`
	TargetDeviceId string   `json:"targetDeviceId"`
	Command        string   `json:"command"`
	PositionMs     int64    `json:"positionMs"`
	Volume         *int     `json:"volume,omitempty"`
	TrackId        string   `json:"trackId,omitempty"`
	TrackIds       []string `json:"trackIds,omitempty"`
	SelectedId     string   `json:"selectedId,omitempty"`
	StartPlaying   bool     `json:"startPlaying,omitempty"`
	HostDeviceId   string   `json:"hostDeviceId,omitempty"`
	PlayMode       string   `json:"playMode,omitempty"`
}

// ConnectStateChanged is broadcast to a user's other devices after playback changes.
type ConnectStateChanged struct {
	baseEvent
	ForUser    string  `json:"forUser"`
	DeviceId   string  `json:"deviceId"`
	TrackId    string  `json:"trackId,omitempty"`
	Title      string  `json:"title,omitempty"`
	Artist     string  `json:"artist,omitempty"`
	State      string  `json:"state,omitempty"`
	PositionMs int64   `json:"positionMs"`
	DurationMs int64   `json:"durationMs,omitempty"`
	Volume     float32 `json:"volume,omitempty"`
	PlayMode   string  `json:"playMode,omitempty"`
}
