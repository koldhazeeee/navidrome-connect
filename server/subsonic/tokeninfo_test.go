package subsonic

import (
	"errors"
	"net/http/httptest"

	"github.com/navidrome/navidrome/model"
	"github.com/navidrome/navidrome/model/request"
	"github.com/navidrome/navidrome/server/subsonic/responses"
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("TokenInfo", func() {
	var (
		router   *Router
		testUser model.User
	)

	BeforeEach(func() {
		router = &Router{}
		testUser = model.User{
			ID:       "user-1",
			UserName: "testuser",
		}
	})

	It("returns the username for the authenticated API key", func() {
		req := httptest.NewRequest("GET", "/rest/tokenInfo?apiKey=test-api-key", nil)
		req = req.WithContext(request.WithUser(GinkgoT().Context(), testUser))

		response, err := router.TokenInfo(req)

		Expect(err).ToNot(HaveOccurred())
		Expect(response).ToNot(BeNil())
		Expect(response.Status).To(Equal(responses.StatusOK))
		Expect(response.TokenInfo).ToNot(BeNil())
		Expect(response.TokenInfo.Username).To(Equal("testuser"))
	})

	It("rejects requests that are not authenticated via apiKey", func() {
		req := httptest.NewRequest("GET", "/rest/tokenInfo", nil)
		req = req.WithContext(request.WithUser(GinkgoT().Context(), testUser))

		response, err := router.TokenInfo(req)

		Expect(response).To(BeNil())
		Expect(err).To(HaveOccurred())

		var subErr subError
		ok := errors.As(err, &subErr)
		Expect(ok).To(BeTrue())
		Expect(subErr.code).To(Equal(responses.ErrorAuthNotSupported))
	})
})
