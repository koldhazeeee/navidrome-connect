package responses

import "time"

type ConnectDevice struct {
	Id         string             `xml:"id,attr"                   json:"id"`
	Name       string             `xml:"name,attr"                 json:"name"`
	Client     string             `xml:"client,attr"               json:"client"`
	IsOnline   bool               `xml:"isOnline,attr"             json:"isOnline"`
	IsActive   bool               `xml:"isActive,attr"             json:"isActive"`
	LastSeen   *time.Time         `xml:"lastSeen,attr,omitempty"   json:"lastSeen,omitempty"`
	NowPlaying *ConnectNowPlaying `xml:"nowPlaying,omitempty"      json:"nowPlaying,omitempty"`
}

type ConnectNowPlaying struct {
	TrackId    string `xml:"trackId,attr"    json:"trackId"`
	Title      string `xml:"title,attr"      json:"title"`
	Artist     string `xml:"artist,attr"     json:"artist"`
	State      string `xml:"state,attr"      json:"state"`
	PositionMs int64  `xml:"positionMs,attr" json:"positionMs"`
	DurationMs int64  `xml:"durationMs,attr" json:"durationMs"`
}

type ConnectDevices struct {
	Device       []ConnectDevice `xml:"device,omitempty"                 json:"device,omitempty"`
	HostDeviceId string          `xml:"hostDeviceId,attr,omitempty"      json:"hostDeviceId,omitempty"`
}

type ConnectTransfer struct {
	SourceDevice string `xml:"sourceDevice,attr"           json:"sourceDevice"`
	TargetDevice string `xml:"targetDevice,attr"           json:"targetDevice"`
	TrackId      string `xml:"trackId,attr,omitempty"      json:"trackId,omitempty"`
	PositionMs   int64  `xml:"positionMs,attr"             json:"positionMs"`
	Playing      bool   `xml:"playing,attr"                json:"playing"`
}
