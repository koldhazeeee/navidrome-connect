package nativeapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"

	"github.com/navidrome/navidrome/core/auth"
	"github.com/navidrome/navidrome/model"
	"github.com/navidrome/navidrome/server"
	"github.com/navidrome/navidrome/tests"
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("User API key API", func() {
	var (
		ds         model.DataStore
		router     http.Handler
		user       model.User
		otherUser  model.User
		userToken  string
		otherToken string
	)

	BeforeEach(func() {
		ds = &tests.MockDataStore{}
		auth.Init(ds)
		nativeRouter := New(ds, nil, nil, nil, tests.NewMockLibraryService(), tests.NewMockUserService(), nil, nil, nil)
		router = server.JWTVerifier(nativeRouter)

		user = model.User{
			ID:          "user-1",
			UserName:    "regular",
			Name:        "Regular User",
			NewPassword: "userpass",
			NewAPIKey:   "regular-api-key",
		}
		otherUser = model.User{
			ID:          "user-2",
			UserName:    "other",
			Name:        "Other User",
			NewPassword: "otherpass",
			NewAPIKey:   "other-api-key",
		}

		Expect(ds.User(context.TODO()).Put(&user)).To(Succeed())
		Expect(ds.User(context.TODO()).Put(&otherUser)).To(Succeed())

		var err error
		userToken, err = auth.CreateToken(&user)
		Expect(err).ToNot(HaveOccurred())
		otherToken, err = auth.CreateToken(&otherUser)
		Expect(err).ToNot(HaveOccurred())
	})

	Describe("GET /api/user/{id}/apikey", func() {
		It("returns whether the authenticated user has an active API key without re-exposing it", func() {
			req := createAuthenticatedRequest("GET", "/user/"+user.ID+"/apikey", nil, userToken)
			w := httptest.NewRecorder()

			router.ServeHTTP(w, req)

			Expect(w.Code).To(Equal(http.StatusOK))

			var response userAPIKeyResponse
			err := json.Unmarshal(w.Body.Bytes(), &response)
			Expect(err).ToNot(HaveOccurred())
			Expect(response.Active).To(BeTrue())
			Expect(response.APIKey).To(BeEmpty())
		})

		It("rejects requests for another user's API key", func() {
			req := createAuthenticatedRequest("GET", "/user/"+otherUser.ID+"/apikey", nil, userToken)
			w := httptest.NewRecorder()

			router.ServeHTTP(w, req)

			Expect(w.Code).To(Equal(http.StatusForbidden))
		})
	})

	Describe("POST /api/user/{id}/apikey", func() {
		It("rotates the authenticated user's API key", func() {
			req := createAuthenticatedRequest("POST", "/user/"+user.ID+"/apikey", nil, userToken)
			w := httptest.NewRecorder()

			router.ServeHTTP(w, req)

			Expect(w.Code).To(Equal(http.StatusOK))

			var response userAPIKeyResponse
			err := json.Unmarshal(w.Body.Bytes(), &response)
			Expect(err).ToNot(HaveOccurred())
			Expect(response.Active).To(BeTrue())
			Expect(response.APIKey).ToNot(BeEmpty())
			Expect(response.APIKey).ToNot(Equal("regular-api-key"))

			_, err = ds.User(context.TODO()).FindByAPIKey("regular-api-key")
			Expect(err).To(MatchError(model.ErrNotFound))

			foundUser, err := ds.User(context.TODO()).FindByAPIKey(response.APIKey)
			Expect(err).ToNot(HaveOccurred())
			Expect(foundUser.ID).To(Equal(user.ID))
		})
	})

	Describe("DELETE /api/user/{id}/apikey", func() {
		It("revokes the authenticated user's API key", func() {
			req := createAuthenticatedRequest("DELETE", "/user/"+user.ID+"/apikey", nil, userToken)
			w := httptest.NewRecorder()

			router.ServeHTTP(w, req)

			Expect(w.Code).To(Equal(http.StatusOK))

			var response userAPIKeyResponse
			err := json.Unmarshal(w.Body.Bytes(), &response)
			Expect(err).ToNot(HaveOccurred())
			Expect(response.Active).To(BeFalse())
			Expect(response.APIKey).To(BeEmpty())

			apiKey, err := ds.User(context.TODO()).GetAPIKey(user.ID)
			Expect(err).ToNot(HaveOccurred())
			Expect(apiKey).To(BeEmpty())

			_, err = ds.User(context.TODO()).FindByAPIKey("regular-api-key")
			Expect(err).To(MatchError(model.ErrNotFound))
		})

		It("rejects requests for another user's API key", func() {
			req := createAuthenticatedRequest("DELETE", "/user/"+user.ID+"/apikey", nil, otherToken)
			w := httptest.NewRecorder()

			router.ServeHTTP(w, req)

			Expect(w.Code).To(Equal(http.StatusForbidden))
		})
	})
})
