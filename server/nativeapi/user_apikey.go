package nativeapi

import (
	"net/http"

	"github.com/deluan/rest"
	"github.com/go-chi/chi/v5"
	"github.com/navidrome/navidrome/model"
	"github.com/navidrome/navidrome/model/id"
	"github.com/navidrome/navidrome/model/request"
)

type userAPIKeyResponse struct {
	APIKey string `json:"apiKey,omitempty"`
	Active bool   `json:"active"`
}

func (api *Router) addUserAPIKeyRoute(r chi.Router) {
	r.Route("/user/{id}/apikey", func(r chi.Router) {
		r.Get("/", getUserAPIKey(api.ds))
		r.Post("/", regenerateUserAPIKey(api.ds))
		r.Delete("/", revokeUserAPIKey(api.ds))
	})
}

func getUserAPIKey(ds model.DataStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, err := authorizeOwnAPIKeyRequest(r)
		if err != nil {
			http.Error(w, err.Error(), http.StatusForbidden)
			return
		}
		apiKey, err := ds.User(r.Context()).GetAPIKey(userID)
		if err != nil {
			respondUserAPIKeyError(w, err)
			return
		}
		_ = rest.RespondWithJSON(w, http.StatusOK, userAPIKeyResponse{
			Active: apiKey != "",
		})
	}
}

func regenerateUserAPIKey(ds model.DataStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, err := authorizeOwnAPIKeyRequest(r)
		if err != nil {
			http.Error(w, err.Error(), http.StatusForbidden)
			return
		}
		apiKey := id.NewRandom()
		if err := ds.User(r.Context()).SetAPIKey(userID, apiKey); err != nil {
			respondUserAPIKeyError(w, err)
			return
		}
		_ = rest.RespondWithJSON(w, http.StatusOK, userAPIKeyResponse{
			APIKey: apiKey,
			Active: true,
		})
	}
}

func revokeUserAPIKey(ds model.DataStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, err := authorizeOwnAPIKeyRequest(r)
		if err != nil {
			http.Error(w, err.Error(), http.StatusForbidden)
			return
		}
		if err := ds.User(r.Context()).SetAPIKey(userID, ""); err != nil {
			respondUserAPIKeyError(w, err)
			return
		}
		_ = rest.RespondWithJSON(w, http.StatusOK, userAPIKeyResponse{Active: false})
	}
}

func authorizeOwnAPIKeyRequest(r *http.Request) (string, error) {
	authenticatedUser, ok := request.UserFrom(r.Context())
	if !ok {
		return "", model.ErrNotAuthorized
	}
	requestUserID := chi.URLParam(r, "id")
	if requestUserID == "" || requestUserID != authenticatedUser.ID {
		return "", model.ErrNotAuthorized
	}
	return requestUserID, nil
}

func respondUserAPIKeyError(w http.ResponseWriter, err error) {
	switch err {
	case model.ErrNotFound:
		http.Error(w, "User not found", http.StatusNotFound)
	default:
		http.Error(w, "Internal server error", http.StatusInternalServerError)
	}
}
