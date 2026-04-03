package subsonic

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync"
	"time"

	"github.com/navidrome/navidrome/conf"
	"github.com/navidrome/navidrome/conf/configtest"
	coreconnect "github.com/navidrome/navidrome/core/connect"
	"github.com/navidrome/navidrome/core/scrobbler"
	"github.com/navidrome/navidrome/model"
	"github.com/navidrome/navidrome/model/request"
	"github.com/navidrome/navidrome/server/events"
	"github.com/navidrome/navidrome/server/subsonic/responses"
	"github.com/navidrome/navidrome/tests"
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	. "github.com/onsi/gomega/gstruct"
)

type connectBrokerMessage struct {
	ctx   context.Context
	event *events.ConnectCommand
}

type connectTestEventBroker struct {
	http.Handler
	mu           sync.Mutex
	events       []connectBrokerMessage
	onConnect    func(username, clientUniqueId string)
	onDisconnect func(username, clientUniqueId string)
}

func (b *connectTestEventBroker) SendMessage(ctx context.Context, event events.Event) {
	command, ok := event.(*events.ConnectCommand)
	if !ok {
		return
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	b.events = append(b.events, connectBrokerMessage{ctx: ctx, event: command})
}

func (b *connectTestEventBroker) SendBroadcastMessage(ctx context.Context, event events.Event) {
	b.SendMessage(ctx, event)
}

func (b *connectTestEventBroker) SetOnConnect(fn func(username, clientUniqueId string)) {
	b.onConnect = fn
}

func (b *connectTestEventBroker) SetOnDisconnect(fn func(username, clientUniqueId string)) {
	b.onDisconnect = fn
}

func (b *connectTestEventBroker) snapshot() []connectBrokerMessage {
	b.mu.Lock()
	defer b.mu.Unlock()
	return append([]connectBrokerMessage(nil), b.events...)
}

var _ events.Broker = (*connectTestEventBroker)(nil)

var _ = Describe("Connect endpoints", func() {
	var (
		api         *Router
		ds          *tests.MockDataStore
		playTracker *fakePlayTracker
		broker      *connectTestEventBroker
		devices     coreconnect.DeviceManager
		baseCtx     context.Context
	)

	BeforeEach(func() {
		DeferCleanup(configtest.SetupConfig())
		conf.Server.Connect.Enabled = true

		ds = &tests.MockDataStore{MockedUserProps: &tests.MockedUserPropsRepo{}}
		playTracker = &fakePlayTracker{}
		broker = &connectTestEventBroker{}
		devices = coreconnect.NewDeviceManager(broker)
		api = &Router{
			ds:             ds,
			scrobbler:      playTracker,
			broker:         broker,
			connectDevices: devices,
		}
		baseCtx = request.WithUsername(context.Background(), "alice")
		baseCtx = request.WithUser(baseCtx, model.User{ID: "user-1", UserName: "alice"})
	})

	It("lists online devices, ignores stale offline sessions, and keeps the active host", func() {
		Expect(ds.UserProps(baseCtx).Put("user-1", "connect_device_nickname_online-device", "Living Room")).To(Succeed())

		devices.OnDeviceConnected("alice", "online-device")
		devices.SetHost("alice", coreconnect.HostState{
			DeviceId:   "online-device",
			TrackId:    "track-online",
			PositionMs: 1000,
			Playing:    true,
		})

		offlinePosition := int64(15000)
		playTracker.NowPlayingInfos = []scrobbler.NowPlayingInfo{
			{
				Username:   "alice",
				PlayerId:   "offline-device",
				MediaFile:  model.MediaFile{ID: "track-offline", Title: "Offline Song", Artist: "Ghost Artist", Duration: 180},
				State:      scrobbler.PlaybackStatePaused,
				PositionMs: &offlinePosition,
			},
		}

		req := httptest.NewRequest("GET", "/rest/getConnectDevices.view", nil).WithContext(baseCtx)
		resp, err := api.GetConnectDevices(req)

		Expect(err).NotTo(HaveOccurred())
		Expect(resp.ConnectDevices).NotTo(BeNil())
		Expect(resp.ConnectDevices.HostDeviceId).To(Equal("online-device"))

		devicesByID := map[string]responses.ConnectDevice{}
		for _, device := range resp.ConnectDevices.Device {
			devicesByID[device.Id] = device
		}

		Expect(devicesByID).To(HaveLen(1))
		Expect(devicesByID["online-device"]).To(MatchFields(IgnoreExtras, Fields{
			"Id":       Equal("online-device"),
			"Name":     Equal("Living Room"),
			"IsOnline": BeTrue(),
		}))
		Expect(devicesByID).NotTo(HaveKey("offline-device"))
	})

	It("uses the live host estimate for the host device timer", func() {
		devices.OnDeviceConnected("alice", "online-device")
		devices.SetHost("alice", coreconnect.HostState{
			DeviceId:   "online-device",
			TrackId:    "track-online",
			PositionMs: 1000,
			Playing:    true,
		})

		stalePosition := int64(1000)
		playTracker.NowPlayingInfos = []scrobbler.NowPlayingInfo{
			{
				Username:   "alice",
				PlayerId:   "online-device",
				MediaFile:  model.MediaFile{ID: "track-online", Title: "Track", Artist: "Artist", Duration: 180},
				State:      scrobbler.PlaybackStatePaused,
				PositionMs: &stalePosition,
			},
		}

		req := httptest.NewRequest("GET", "/rest/getConnectDevices.view", nil).WithContext(baseCtx)
		firstResp, err := api.GetConnectDevices(req)

		Expect(err).NotTo(HaveOccurred())
		Expect(firstResp.ConnectDevices.Device).To(HaveLen(1))
		firstPosition := firstResp.ConnectDevices.Device[0].NowPlaying.PositionMs

		time.Sleep(25 * time.Millisecond)

		secondResp, err := api.GetConnectDevices(req)

		Expect(err).NotTo(HaveOccurred())
		Expect(secondResp.ConnectDevices.Device).To(HaveLen(1))
		secondPosition := secondResp.ConnectDevices.Device[0].NowPlaying.PositionMs
		Expect(secondPosition).To(BeNumerically(">", firstPosition))
	})

	It("does not overwrite the current track position with stale host state from a previous track", func() {
		devices.OnDeviceConnected("alice", "online-device")
		devices.SetHost("alice", coreconnect.HostState{
			DeviceId:   "online-device",
			TrackId:    "track-old",
			PositionMs: 5524,
			Playing:    true,
		})

		currentPosition := int64(0)
		playTracker.NowPlayingInfos = []scrobbler.NowPlayingInfo{
			{
				Username:   "alice",
				PlayerId:   "online-device",
				MediaFile:  model.MediaFile{ID: "track-new", Title: "Track", Artist: "Artist", Duration: 180},
				State:      scrobbler.PlaybackStatePlaying,
				PositionMs: &currentPosition,
			},
		}

		req := httptest.NewRequest("GET", "/rest/getConnectDevices.view", nil).WithContext(baseCtx)
		resp, err := api.GetConnectDevices(req)

		Expect(err).NotTo(HaveOccurred())
		Expect(resp.ConnectDevices.Device).To(HaveLen(1))
		Expect(resp.ConnectDevices.Device[0].NowPlaying).To(PointTo(MatchFields(IgnoreExtras, Fields{
			"TrackId":    Equal("track-new"),
			"PositionMs": Equal(int64(0)),
			"State":      Equal(string(scrobbler.PlaybackStatePlaying)),
		})))
	})

	It("saves and clears device nicknames", func() {
		req := httptest.NewRequest(
			"GET",
			"/rest/setDeviceNickname.view?deviceId=online-device&nickname=Bedroom",
			nil,
		).WithContext(baseCtx)

		resp, err := api.SetDeviceNickname(req)

		Expect(err).NotTo(HaveOccurred())
		Expect(resp).NotTo(BeNil())
		nickname, err := ds.UserProps(baseCtx).Get("user-1", "connect_device_nickname_online-device")
		Expect(err).NotTo(HaveOccurred())
		Expect(nickname).To(Equal("Bedroom"))

		req = httptest.NewRequest(
			"GET",
			"/rest/setDeviceNickname.view?deviceId=online-device&nickname=",
			nil,
		).WithContext(baseCtx)

		resp, err = api.SetDeviceNickname(req)

		Expect(err).NotTo(HaveOccurred())
		Expect(resp).NotTo(BeNil())
		_, err = ds.UserProps(baseCtx).Get("user-1", "connect_device_nickname_online-device")
		Expect(err).To(MatchError(model.ErrNotFound))
	})

	It("sends connect commands only to the requested device", func() {
		devices.OnDeviceConnected("alice", "target-device")

		req := httptest.NewRequest(
			"GET",
			"/rest/sendConnectCommand.view?deviceId=target-device&command=setQueue&id=song-1&id=song-2&selectedId=song-2",
			nil,
		).WithContext(baseCtx)

		resp, err := api.SendConnectCommand(req)

		Expect(err).NotTo(HaveOccurred())
		Expect(resp).NotTo(BeNil())
		Expect(broker.snapshot()).To(HaveLen(1))

		message := broker.snapshot()[0]
		targetClientUniqueId, ok := request.TargetClientUniqueIdFrom(message.ctx)
		Expect(ok).To(BeTrue())
		Expect(targetClientUniqueId).To(Equal("target-device"))
		Expect(message.event).To(PointTo(MatchFields(IgnoreExtras, Fields{
			"ForUser":        Equal("alice"),
			"TargetDeviceId": Equal("target-device"),
			"Command":        Equal("setQueue"),
			"TrackId":        Equal("song-1"),
			"TrackIds":       Equal([]string{"song-1", "song-2"}),
			"SelectedId":     Equal("song-2"),
		})))
	})

	It("broadcasts host volume changes to every follower without echoing back to the host", func() {
		devices.OnDeviceConnected("alice", "host-device")
		devices.OnDeviceConnected("alice", "follower-1")
		devices.OnDeviceConnected("alice", "follower-2")
		devices.SetHost("alice", coreconnect.HostState{
			DeviceId:   "host-device",
			TrackId:    "track-1",
			PositionMs: 12000,
			Playing:    true,
		})

		ctx := request.WithClientUniqueId(baseCtx, "host-device")
		req := httptest.NewRequest(
			"GET",
			"/rest/sendConnectCommand.view?deviceId=host-device&command=setVolume&volume=25",
			nil,
		).WithContext(ctx)

		resp, err := api.SendConnectCommand(req)

		Expect(err).NotTo(HaveOccurred())
		Expect(resp).NotTo(BeNil())
		Expect(broker.snapshot()).To(HaveLen(2))

		commandsByTarget := map[string]*events.ConnectCommand{}
		for _, message := range broker.snapshot() {
			targetClientUniqueId, ok := request.TargetClientUniqueIdFrom(message.ctx)
			Expect(ok).To(BeTrue())
			commandsByTarget[targetClientUniqueId] = message.event
		}

		Expect(commandsByTarget).NotTo(HaveKey("host-device"))
		Expect(commandsByTarget["follower-1"]).To(PointTo(MatchFields(IgnoreExtras, Fields{
			"ForUser":        Equal("alice"),
			"TargetDeviceId": Equal("follower-1"),
			"Command":        Equal("setVolume"),
			"Volume":         PointTo(Equal(25)),
		})))
		Expect(commandsByTarget["follower-2"]).To(PointTo(MatchFields(IgnoreExtras, Fields{
			"ForUser":        Equal("alice"),
			"TargetDeviceId": Equal("follower-2"),
			"Command":        Equal("setVolume"),
			"Volume":         PointTo(Equal(25)),
		})))
	})

	It("ignores self-targeted volume sync when the sender is not the active host", func() {
		devices.OnDeviceConnected("alice", "solo-device")

		ctx := request.WithClientUniqueId(baseCtx, "solo-device")
		req := httptest.NewRequest(
			"GET",
			"/rest/sendConnectCommand.view?deviceId=solo-device&command=setVolume&volume=25",
			nil,
		).WithContext(ctx)

		resp, err := api.SendConnectCommand(req)

		Expect(err).NotTo(HaveOccurred())
		Expect(resp).NotTo(BeNil())
		Expect(broker.snapshot()).To(BeEmpty())
	})

	It("transfers playback by promoting the target and updating all remaining devices", func() {
		devices.OnDeviceConnected("alice", "host-device")
		devices.OnDeviceConnected("alice", "target-device")
		devices.OnDeviceConnected("alice", "other-device")
		devices.SetHost("alice", coreconnect.HostState{
			DeviceId:   "host-device",
			TrackId:    "track-1",
			PositionMs: 12000,
			Playing:    true,
		})

		req := httptest.NewRequest(
			"GET",
			"/rest/transferPlayback.view?deviceId=target-device&startPlaying=true",
			nil,
		).WithContext(baseCtx)

		resp, err := api.TransferPlayback(req)

		Expect(err).NotTo(HaveOccurred())
		Expect(resp.ConnectTransfer).NotTo(BeNil())
		Expect(resp.ConnectTransfer.SourceDevice).To(Equal("host-device"))
		Expect(resp.ConnectTransfer.TargetDevice).To(Equal("target-device"))
		Expect(resp.ConnectTransfer.TrackId).To(Equal("track-1"))
		Expect(resp.ConnectTransfer.PositionMs).To(BeNumerically(">=", 12000))
		Expect(resp.ConnectTransfer.Playing).To(BeTrue())
		Expect(devices.GetHost("alice")).To(PointTo(MatchFields(IgnoreExtras, Fields{
			"DeviceId": Equal("target-device"),
			"TrackId":  Equal("track-1"),
			"Playing":  BeTrue(),
		})))

		messages := broker.snapshot()
		Expect(messages).To(HaveLen(4))

		commandsByTarget := map[string][]*events.ConnectCommand{}
		for _, message := range messages {
			targetClientUniqueId, ok := request.TargetClientUniqueIdFrom(message.ctx)
			Expect(ok).To(BeTrue())
			commandsByTarget[targetClientUniqueId] = append(commandsByTarget[targetClientUniqueId], message.event)
		}

		Expect(commandsByTarget["target-device"]).To(ContainElement(PointTo(MatchFields(IgnoreExtras, Fields{
			"Command":      Equal("becomeHost"),
			"TrackId":      Equal("track-1"),
			"StartPlaying": BeTrue(),
		}))))
		Expect(commandsByTarget["host-device"]).To(ContainElement(PointTo(MatchFields(IgnoreExtras, Fields{
			"Command": Equal("pause"),
		}))))
		Expect(commandsByTarget["host-device"]).To(ContainElement(PointTo(MatchFields(IgnoreExtras, Fields{
			"Command":      Equal("becomeFollower"),
			"HostDeviceId": Equal("target-device"),
			"TrackId":      Equal("track-1"),
			"StartPlaying": BeTrue(),
		}))))
		Expect(commandsByTarget["other-device"]).To(ContainElement(PointTo(MatchFields(IgnoreExtras, Fields{
			"Command":      Equal("becomeFollower"),
			"HostDeviceId": Equal("target-device"),
			"TrackId":      Equal("track-1"),
			"StartPlaying": BeTrue(),
		}))))
	})

	It("prefers an explicit transfer snapshot from the UI when one is provided", func() {
		devices.OnDeviceConnected("alice", "host-device")
		devices.OnDeviceConnected("alice", "target-device")
		devices.OnDeviceConnected("alice", "other-device")
		devices.SetHost("alice", coreconnect.HostState{
			DeviceId:   "host-device",
			TrackId:    "track-1",
			PositionMs: 12000,
			Playing:    false,
		})

		req := httptest.NewRequest(
			"GET",
			"/rest/transferPlayback.view?deviceId=target-device&id=track-live&positionMs=34567&startPlaying=true",
			nil,
		).WithContext(baseCtx)

		resp, err := api.TransferPlayback(req)

		Expect(err).NotTo(HaveOccurred())
		Expect(resp.ConnectTransfer).NotTo(BeNil())
		Expect(resp.ConnectTransfer.SourceDevice).To(Equal("host-device"))
		Expect(resp.ConnectTransfer.TargetDevice).To(Equal("target-device"))
		Expect(resp.ConnectTransfer.TrackId).To(Equal("track-live"))
		Expect(resp.ConnectTransfer.PositionMs).To(Equal(int64(34567)))
		Expect(resp.ConnectTransfer.Playing).To(BeTrue())
		Expect(devices.GetHost("alice")).To(PointTo(MatchFields(IgnoreExtras, Fields{
			"DeviceId":   Equal("target-device"),
			"TrackId":    Equal("track-live"),
			"PositionMs": Equal(int64(34567)),
			"Playing":    BeTrue(),
		})))

		messages := broker.snapshot()
		Expect(messages).To(HaveLen(4))

		commandsByTarget := map[string][]*events.ConnectCommand{}
		for _, message := range messages {
			targetClientUniqueId, ok := request.TargetClientUniqueIdFrom(message.ctx)
			Expect(ok).To(BeTrue())
			commandsByTarget[targetClientUniqueId] = append(commandsByTarget[targetClientUniqueId], message.event)
		}

		Expect(commandsByTarget["target-device"]).To(ContainElement(PointTo(MatchFields(IgnoreExtras, Fields{
			"Command":      Equal("becomeHost"),
			"TrackId":      Equal("track-live"),
			"PositionMs":   Equal(int64(34567)),
			"StartPlaying": BeTrue(),
		}))))
		Expect(commandsByTarget["host-device"]).To(ContainElement(PointTo(MatchFields(IgnoreExtras, Fields{
			"Command": Equal("pause"),
		}))))
		Expect(commandsByTarget["host-device"]).To(ContainElement(PointTo(MatchFields(IgnoreExtras, Fields{
			"Command":      Equal("becomeFollower"),
			"HostDeviceId": Equal("target-device"),
			"TrackId":      Equal("track-live"),
			"PositionMs":   Equal(int64(34567)),
			"StartPlaying": BeTrue(),
		}))))
		Expect(commandsByTarget["other-device"]).To(ContainElement(PointTo(MatchFields(IgnoreExtras, Fields{
			"Command":      Equal("becomeFollower"),
			"HostDeviceId": Equal("target-device"),
			"TrackId":      Equal("track-live"),
			"PositionMs":   Equal(int64(34567)),
			"StartPlaying": BeTrue(),
		}))))
	})
})
