package subsonic

import (
	"context"
	"time"

	"github.com/navidrome/navidrome/conf"
	"github.com/navidrome/navidrome/conf/configtest"
	coreconnect "github.com/navidrome/navidrome/core/connect"
	"github.com/navidrome/navidrome/core/scrobbler"
	"github.com/navidrome/navidrome/model"
	"github.com/navidrome/navidrome/model/request"
	"github.com/navidrome/navidrome/tests"
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	. "github.com/onsi/gomega/gstruct"
)

var _ = Describe("PlaybackReportController", func() {
	var router *Router
	var playTracker *fakePlayTracker

	BeforeEach(func() {
		playTracker = &fakePlayTracker{}
		router = New(&tests.MockDataStore{}, nil, nil, nil, nil, nil, nil, nil, nil, playTracker, nil, nil, nil, nil, nil)
	})

	Describe("ReportPlayback", func() {
		It("does not broadcast a pre-seek zero-position report from a newly transferred host", func() {
			DeferCleanup(configtest.SetupConfig())
			conf.Server.Connect.Enabled = true

			broker := &fakeEventBroker{}
			router = New(&tests.MockDataStore{}, nil, nil, nil, nil, nil, nil, broker, nil, playTracker, nil, nil, nil, nil, nil)
			router.connectDevices.OnDeviceConnected("admin", "new-host")
			router.connectDevices.SetHost("admin", coreconnect.HostState{
				DeviceId:                 "new-host",
				TrackId:                  "song-1",
				PositionMs:               28628,
				Playing:                  true,
				IgnoreLowerPositionUntil: time.Now().Add(connectHostPreSeekGracePeriod),
			})

			ctx := request.WithUsername(context.Background(), "admin")
			ctx = request.WithPlayer(ctx, model.Player{ID: "new-host"})
			ctx = request.WithClientUniqueId(ctx, "new-host")
			req := newGetRequest(
				"mediaId=song-1",
				"mediaType=song",
				"positionMs=0",
				"state=playing",
			).WithContext(ctx)

			_, err := router.ReportPlayback(req)

			Expect(err).ToNot(HaveOccurred())
			Expect(playTracker.Reports).To(HaveLen(1))
			Expect(broker.Events).To(BeEmpty())
			Expect(router.connectDevices.GetHost("admin")).To(PointTo(MatchFields(IgnoreExtras, Fields{
				"DeviceId":   Equal("new-host"),
				"TrackId":    Equal("song-1"),
				"PositionMs": Equal(int64(28628)),
				"Playing":    BeTrue(),
			})))
		})

		It("accepts backward seeks on the current track from the active host", func() {
			DeferCleanup(configtest.SetupConfig())
			conf.Server.Connect.Enabled = true

			broker := &fakeEventBroker{}
			router = New(&tests.MockDataStore{}, nil, nil, nil, nil, nil, nil, broker, nil, playTracker, nil, nil, nil, nil, nil)
			router.connectDevices.OnDeviceConnected("admin", "host-device")
			router.connectDevices.SetHost("admin", coreconnect.HostState{
				DeviceId:   "host-device",
				TrackId:    "song-1",
				PositionMs: 147000,
				Playing:    true,
			})

			ctx := request.WithUsername(context.Background(), "admin")
			ctx = request.WithPlayer(ctx, model.Player{ID: "host-device"})
			ctx = request.WithClientUniqueId(ctx, "host-device")
			req := newGetRequest(
				"mediaId=song-1",
				"mediaType=song",
				"positionMs=30000",
				"state=playing",
			).WithContext(ctx)

			_, err := router.ReportPlayback(req)

			Expect(err).ToNot(HaveOccurred())
			Expect(playTracker.Reports).To(HaveLen(1))
			Expect(broker.Events).To(HaveLen(1))
			Expect(router.connectDevices.GetHost("admin")).To(PointTo(MatchFields(IgnoreExtras, Fields{
				"DeviceId":   Equal("host-device"),
				"TrackId":    Equal("song-1"),
				"PositionMs": Equal(int64(30000)),
				"Playing":    BeTrue(),
			})))
		})

		It("updates the connect host immediately when the next track starts at zero position", func() {
			DeferCleanup(configtest.SetupConfig())
			conf.Server.Connect.Enabled = true

			broker := &fakeEventBroker{}
			router = New(&tests.MockDataStore{}, nil, nil, nil, nil, nil, nil, broker, nil, playTracker, nil, nil, nil, nil, nil)
			router.connectDevices.OnDeviceConnected("admin", "host-device")
			router.connectDevices.SetHost("admin", coreconnect.HostState{
				DeviceId:   "host-device",
				TrackId:    "song-1",
				PositionMs: 5524,
				Playing:    true,
			})

			ctx := request.WithUsername(context.Background(), "admin")
			ctx = request.WithPlayer(ctx, model.Player{ID: "host-device"})
			ctx = request.WithClientUniqueId(ctx, "host-device")
			req := newGetRequest(
				"mediaId=song-2",
				"mediaType=song",
				"positionMs=0",
				"state=playing",
			).WithContext(ctx)

			_, err := router.ReportPlayback(req)

			Expect(err).ToNot(HaveOccurred())
			Expect(playTracker.Reports).To(HaveLen(1))
			Expect(broker.Events).To(HaveLen(1))
			Expect(router.connectDevices.GetHost("admin")).To(PointTo(MatchFields(IgnoreExtras, Fields{
				"DeviceId":   Equal("host-device"),
				"TrackId":    Equal("song-2"),
				"PositionMs": Equal(int64(0)),
				"Playing":    BeTrue(),
			})))
		})

		It("forwards playback reports with defaults", func() {
			ctx := request.WithPlayer(context.Background(), model.Player{ID: "player-1"})
			ctx = request.WithClient(ctx, "test-client")
			req := newGetRequest("mediaId=12", "mediaType=song", "positionMs=1234", "state=playing")
			req = req.WithContext(ctx)

			_, err := router.ReportPlayback(req)

			Expect(err).ToNot(HaveOccurred())
			Expect(playTracker.Reports).To(HaveLen(1))
			report := playTracker.Reports[0]
			Expect(report.TrackID).To(Equal("12"))
			Expect(report.PlayerID).To(Equal("player-1"))
			Expect(report.PlayerName).To(Equal("test-client"))
			Expect(report.PositionMs).To(Equal(int64(1234)))
			Expect(report.State).To(Equal(scrobbler.PlaybackStatePlaying))
			Expect(report.PlaybackRate).To(Equal(1.0))
			Expect(report.IgnoreScrobble).To(BeFalse())
		})

		It("prefers the client unique id when available", func() {
			ctx := request.WithPlayer(context.Background(), model.Player{ID: "player-1"})
			ctx = request.WithClient(ctx, "test-client")
			ctx = request.WithClientUniqueId(ctx, "session-1")
			req := newGetRequest("mediaId=12", "mediaType=song", "positionMs=1234", "state=playing")
			req = req.WithContext(ctx)

			_, err := router.ReportPlayback(req)

			Expect(err).ToNot(HaveOccurred())
			Expect(playTracker.Reports).To(HaveLen(1))
			Expect(playTracker.Reports[0].PlayerID).To(Equal("session-1"))
		})

		It("rejects unsupported media types", func() {
			req := newGetRequest("mediaId=12", "mediaType=podcast", "positionMs=1234", "state=playing")

			_, err := router.ReportPlayback(req)

			Expect(err).To(HaveOccurred())
			Expect(playTracker.Reports).To(BeEmpty())
		})

		It("rejects invalid states", func() {
			req := newGetRequest("mediaId=12", "mediaType=song", "positionMs=1234", "state=buffering")

			_, err := router.ReportPlayback(req)

			Expect(err).To(HaveOccurred())
			Expect(playTracker.Reports).To(BeEmpty())
		})

		It("requires positionMs", func() {
			req := newGetRequest("mediaId=12", "mediaType=song", "state=playing")

			_, err := router.ReportPlayback(req)

			Expect(err).To(HaveOccurred())
			Expect(playTracker.Reports).To(BeEmpty())
		})
	})

	Describe("GetNowPlaying", func() {
		It("includes playback timeline fields when available", func() {
			positionMs := int64(120000)
			playbackRate := 1.0
			playTracker.NowPlayingInfos = []scrobbler.NowPlayingInfo{
				{
					MediaFile: model.MediaFile{
						ID:       "12",
						Title:    "Song",
						Album:    "Album",
						AlbumID:  "album-1",
						Artist:   "Artist",
						ArtistID: "artist-1",
						Duration: 180,
					},
					Username:     "user",
					PlayerName:   "test-client",
					Start:        time.Now(),
					State:        scrobbler.PlaybackStatePlaying,
					PositionMs:   &positionMs,
					PlaybackRate: &playbackRate,
				},
			}

			resp, err := router.GetNowPlaying(newGetRequest())

			Expect(err).ToNot(HaveOccurred())
			Expect(resp.NowPlaying).ToNot(BeNil())
			Expect(resp.NowPlaying.Entry).To(HaveLen(1))
			entry := resp.NowPlaying.Entry[0]
			Expect(entry.State).To(Equal("playing"))
			Expect(entry.PositionMs).ToNot(BeNil())
			Expect(*entry.PositionMs).To(BeNumerically("~", positionMs, 250))
			Expect(entry.PlaybackRate).ToNot(BeNil())
			Expect(*entry.PlaybackRate).To(Equal(1.0))
		})
	})
})
