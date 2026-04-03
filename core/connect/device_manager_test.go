package connect

import (
	"context"
	"net/http"
	"sync"

	"github.com/navidrome/navidrome/model/request"
	"github.com/navidrome/navidrome/server/events"
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

type recordedConnectMessage struct {
	ctx   context.Context
	event *events.ConnectCommand
}

type connectTestBroker struct {
	mu           sync.Mutex
	messages     []recordedConnectMessage
	onConnect    func(username, clientUniqueId string)
	onDisconnect func(username, clientUniqueId string)
}

func (b *connectTestBroker) ServeHTTP(http.ResponseWriter, *http.Request) {}

func (b *connectTestBroker) SendMessage(ctx context.Context, event events.Event) {
	command, ok := event.(*events.ConnectCommand)
	if !ok {
		return
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	b.messages = append(b.messages, recordedConnectMessage{ctx: ctx, event: command})
}

func (b *connectTestBroker) SendBroadcastMessage(ctx context.Context, event events.Event) {
	b.SendMessage(ctx, event)
}

func (b *connectTestBroker) SetOnConnect(fn func(username, clientUniqueId string)) {
	b.onConnect = fn
}

func (b *connectTestBroker) SetOnDisconnect(fn func(username, clientUniqueId string)) {
	b.onDisconnect = fn
}

func (b *connectTestBroker) snapshot() []recordedConnectMessage {
	b.mu.Lock()
	defer b.mu.Unlock()
	return append([]recordedConnectMessage(nil), b.messages...)
}

var _ events.Broker = (*connectTestBroker)(nil)
var _ lifecycleBroker = (*connectTestBroker)(nil)

var _ = Describe("DeviceManager", func() {
	var (
		broker  *connectTestBroker
		manager DeviceManager
	)

	BeforeEach(func() {
		broker = &connectTestBroker{}
		manager = NewDeviceManager(broker)
	})

	It("sends a targeted becomeFollower command when a host already exists", func() {
		manager.OnDeviceConnected("alice", "host-device")
		manager.SetHost("alice", HostState{
			DeviceId:   "host-device",
			TrackId:    "track-1",
			PositionMs: 1200,
			Playing:    true,
		})

		manager.OnDeviceConnected("alice", "follower-device")

		Eventually(broker.snapshot).Should(HaveLen(1))
		message := broker.snapshot()[0]
		targetClientUniqueId, ok := request.TargetClientUniqueIdFrom(message.ctx)
		Expect(ok).To(BeTrue())
		Expect(targetClientUniqueId).To(Equal("follower-device"))
		Expect(message.event.Command).To(Equal("becomeFollower"))
		Expect(message.event.HostDeviceId).To(Equal("host-device"))
		Expect(message.event.TrackId).To(Equal("track-1"))
		Expect(message.event.StartPlaying).To(BeTrue())
		Expect(message.event.PositionMs).To(BeNumerically(">=", 1200))
	})

	It("clears the host and tells remaining devices to exit follower mode when the host disconnects", func() {
		manager.OnDeviceConnected("alice", "host-device")
		manager.OnDeviceConnected("alice", "follower-device")
		manager.SetHost("alice", HostState{
			DeviceId:   "host-device",
			TrackId:    "track-1",
			PositionMs: 2400,
			Playing:    true,
		})

		manager.OnDeviceDisconnected("alice", "host-device")

		Eventually(broker.snapshot).Should(HaveLen(1))
		message := broker.snapshot()[0]
		targetClientUniqueId, ok := request.TargetClientUniqueIdFrom(message.ctx)
		Expect(ok).To(BeTrue())
		Expect(targetClientUniqueId).To(Equal("follower-device"))
		Expect(message.event.Command).To(Equal("exitFollower"))
		Expect(manager.GetHost("alice")).To(BeNil())
	})
})
