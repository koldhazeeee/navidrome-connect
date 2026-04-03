package subsonic_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"

	"github.com/navidrome/navidrome/conf"
	"github.com/navidrome/navidrome/conf/configtest"
	"github.com/navidrome/navidrome/server/events"
	"github.com/navidrome/navidrome/server/subsonic"
	"github.com/navidrome/navidrome/server/subsonic/responses"
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

type opensubsonicTestBroker struct{}

func (b *opensubsonicTestBroker) ServeHTTP(http.ResponseWriter, *http.Request) {}
func (b *opensubsonicTestBroker) SendMessage(context.Context, events.Event)    {}
func (b *opensubsonicTestBroker) SendBroadcastMessage(context.Context, events.Event) {
}

var _ events.Broker = (*opensubsonicTestBroker)(nil)

var _ = Describe("GetOpenSubsonicExtensions", func() {
	var (
		router *subsonic.Router
		w      *httptest.ResponseRecorder
		r      *http.Request
	)

	BeforeEach(func() {
		DeferCleanup(configtest.SetupConfig())
		router = subsonic.New(nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil)
		w = httptest.NewRecorder()
		r = httptest.NewRequest("GET", "/getOpenSubsonicExtensions?f=json", nil)
	})

	It("should return the correct OpenSubsonicExtensions", func() {
		router.ServeHTTP(w, r)

		// Make sure the endpoint is public, by not passing any authentication
		Expect(w.Code).To(Equal(http.StatusOK))
		Expect(w.Header().Get("Content-Type")).To(Equal("application/json"))

		var response responses.JsonWrapper
		err := json.Unmarshal(w.Body.Bytes(), &response)
		Expect(err).NotTo(HaveOccurred())
		Expect(*response.Subsonic.OpenSubsonicExtensions).To(SatisfyAll(
			HaveLen(7),
			ContainElement(responses.OpenSubsonicExtension{Name: "apiKeyAuthentication", Versions: []int32{1}}),
			ContainElement(responses.OpenSubsonicExtension{Name: "transcodeOffset", Versions: []int32{1}}),
			ContainElement(responses.OpenSubsonicExtension{Name: "formPost", Versions: []int32{1}}),
			ContainElement(responses.OpenSubsonicExtension{Name: "songLyrics", Versions: []int32{1}}),
			ContainElement(responses.OpenSubsonicExtension{Name: "indexBasedQueue", Versions: []int32{1}}),
			ContainElement(responses.OpenSubsonicExtension{Name: "transcoding", Versions: []int32{1}}),
			ContainElement(responses.OpenSubsonicExtension{Name: "playbackReport", Versions: []int32{1}}),
		))
	})

	It("adds connectPlayback when connect is enabled and available", func() {
		conf.Server.Connect.Enabled = true
		router = subsonic.New(nil, nil, nil, nil, nil, nil, nil, &opensubsonicTestBroker{}, nil, nil, nil, nil, nil, nil, nil)

		router.ServeHTTP(w, r)

		var response responses.JsonWrapper
		err := json.Unmarshal(w.Body.Bytes(), &response)
		Expect(err).NotTo(HaveOccurred())
		Expect(*response.Subsonic.OpenSubsonicExtensions).To(SatisfyAll(
			HaveLen(8),
			ContainElement(responses.OpenSubsonicExtension{Name: "connectPlayback", Versions: []int32{1}}),
		))
	})
})
