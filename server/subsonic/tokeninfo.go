package subsonic

import (
	"net/http"

	"github.com/navidrome/navidrome/model/request"
	"github.com/navidrome/navidrome/server/subsonic/responses"
	"github.com/navidrome/navidrome/utils/req"
)

func (api *Router) TokenInfo(r *http.Request) (*responses.Subsonic, error) {
	apiKey, _ := req.Params(r).String("apiKey")
	if apiKey == "" {
		return nil, newError(responses.ErrorAuthNotSupported)
	}

	user, ok := request.UserFrom(r.Context())
	if !ok {
		return nil, newError(responses.ErrorGeneric, "Internal error")
	}

	response := newResponse()
	response.TokenInfo = &responses.TokenInfo{Username: user.UserName}
	return response, nil
}
