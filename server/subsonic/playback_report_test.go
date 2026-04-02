package subsonic

import (
	"context"
	"time"

	"github.com/navidrome/navidrome/core/scrobbler"
	"github.com/navidrome/navidrome/model"
	"github.com/navidrome/navidrome/model/request"
	"github.com/navidrome/navidrome/tests"
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("PlaybackReportController", func() {
	var router *Router
	var playTracker *fakePlayTracker

	BeforeEach(func() {
		playTracker = &fakePlayTracker{}
		router = New(&tests.MockDataStore{}, nil, nil, nil, nil, nil, nil, nil, nil, playTracker, nil, nil, nil, nil, nil)
	})

	Describe("ReportPlayback", func() {
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
