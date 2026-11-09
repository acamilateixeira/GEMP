// Package api holds the comparison endpoint logic without net/http, so the
// HTTP server and the WebAssembly demo run exactly the same rules.
package api

import (
	"context"
	"encoding/json"
	"io"
	"time"

	"github.com/acamilateixeira/GEMP/internal/credit"
)

// HTTP status codes used by the endpoint. Kept here to avoid importing net/http
// into the WebAssembly build.
const (
	StatusOK          = 200
	StatusBadRequest  = 400
	StatusUnavailable = 503
)

// ProviderTimeout is the deadline for each provider call.
const ProviderTimeout = 250 * time.Millisecond

// Compare decodes a request body, validates it and runs the comparison.
// It returns ok=false when the caller canceled, in which case nothing should be written.
func Compare(ctx context.Context, body io.Reader, providers []credit.Provider) (status int, payload any, ok bool) {
	var input credit.Request
	decoder := json.NewDecoder(body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil || decoder.Decode(new(any)) != io.EOF || !input.Valid() {
		return StatusBadRequest, map[string]string{"error": "invalid_request"}, true
	}
	result, err := credit.Compare(ctx, input, providers, ProviderTimeout)
	if err != nil {
		return 0, nil, false
	}
	if result.Status == "unavailable" {
		return StatusUnavailable, result, true
	}
	return StatusOK, result, true
}
