package e2e

import (
	"github.com/navidrome/navidrome/server/subsonic/responses"
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("System Endpoints", func() {
	BeforeEach(func() {
		setupTestDB()
	})

	Describe("ping", func() {
		It("returns a successful response", func() {
			resp := doReq("ping")

			Expect(resp.Status).To(Equal(responses.StatusOK))
		})
	})

	Describe("getLicense", func() {
		It("returns a valid license", func() {
			resp := doReq("getLicense")

			Expect(resp.Status).To(Equal(responses.StatusOK))
			Expect(resp.License).ToNot(BeNil())
			Expect(resp.License.Valid).To(BeTrue())
		})
	})

	Describe("getOpenSubsonicExtensions", func() {
		It("returns a list of supported extensions", func() {
			resp := doReq("getOpenSubsonicExtensions")

			Expect(resp.Status).To(Equal(responses.StatusOK))
			Expect(resp.OpenSubsonicExtensions).ToNot(BeNil())
			Expect(*resp.OpenSubsonicExtensions).ToNot(BeEmpty())
		})

		It("includes the transcodeOffset extension", func() {
			resp := doReq("getOpenSubsonicExtensions")

			extensions := *resp.OpenSubsonicExtensions
			var names []string
			for _, ext := range extensions {
				names = append(names, ext.Name)
			}
			Expect(names).To(ContainElement("transcodeOffset"))
		})

		It("includes the apiKeyAuthentication extension", func() {
			resp := doReq("getOpenSubsonicExtensions")

			extensions := *resp.OpenSubsonicExtensions
			var names []string
			for _, ext := range extensions {
				names = append(names, ext.Name)
			}
			Expect(names).To(ContainElement("apiKeyAuthentication"))
		})

		It("includes the formPost extension", func() {
			resp := doReq("getOpenSubsonicExtensions")

			extensions := *resp.OpenSubsonicExtensions
			var names []string
			for _, ext := range extensions {
				names = append(names, ext.Name)
			}
			Expect(names).To(ContainElement("formPost"))
		})

		It("includes the songLyrics extension", func() {
			resp := doReq("getOpenSubsonicExtensions")

			extensions := *resp.OpenSubsonicExtensions
			var names []string
			for _, ext := range extensions {
				names = append(names, ext.Name)
			}
			Expect(names).To(ContainElement("songLyrics"))
		})

		It("includes the playbackReport extension", func() {
			resp := doReq("getOpenSubsonicExtensions")

			extensions := *resp.OpenSubsonicExtensions
			var names []string
			for _, ext := range extensions {
				names = append(names, ext.Name)
			}
			Expect(names).To(ContainElement("playbackReport"))
		})
	})

	Describe("apiKey authentication", func() {
		It("allows standard endpoints to authenticate with apiKey", func() {
			resp := doReqWithAPIKey(adminUser.APIKey, "ping")

			Expect(resp.Status).To(Equal(responses.StatusOK))
		})
	})

	Describe("tokenInfo", func() {
		It("returns the username for the authenticated API key", func() {
			resp := doReqWithAPIKey(adminUser.APIKey, "tokenInfo")

			Expect(resp.Status).To(Equal(responses.StatusOK))
			Expect(resp.TokenInfo).ToNot(BeNil())
			Expect(resp.TokenInfo.Username).To(Equal(adminUser.UserName))
		})

		It("returns invalid API key for unknown keys", func() {
			resp := doReqWithAPIKey("invalid-api-key", "tokenInfo")

			Expect(resp.Status).To(Equal(responses.StatusFailed))
			Expect(resp.Error).ToNot(BeNil())
			Expect(resp.Error.Code).To(Equal(responses.ErrorInvalidAPIKey))
		})
	})
})
