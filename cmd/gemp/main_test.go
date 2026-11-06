package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/acamilateixeira/GEMP/internal/credit"
)

func TestComparisonAPI(t *testing.T) {
	h := handler(credit.DemoProviders(), http.NotFoundHandler())
	for _, tc := range []struct {
		name       string
		body       string
		wantCode   int
		wantStatus string
		wantOffers int
	}{
		{"normal", `{"principal_cents":500000,"months":12}`, 200, "complete", 3},
		{"slow provider", `{"principal_cents":500000,"months":12,"scenario":"one_slow"}`, 200, "partial", 2},
		{"outage", `{"principal_cents":500000,"months":12,"scenario":"all_unavailable"}`, 503, "unavailable", 0},
		{"invalid term", `{"principal_cents":500000,"months":15}`, 400, "", 0},
		{"unexpected field", `{"principal_cents":500000,"months":12,"extra":"value"}`, 400, "", 0},
		{"trailing data", `{"principal_cents":500000,"months":12}{}`, 400, "", 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			response := httptest.NewRecorder()
			h.ServeHTTP(response, httptest.NewRequest("POST", "/api/comparisons", strings.NewReader(tc.body)))
			if response.Code != tc.wantCode {
				t.Fatalf("want %d, got %d: %s", tc.wantCode, response.Code, response.Body)
			}
			if tc.wantStatus == "" {
				return
			}
			var body credit.Result
			if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
				t.Fatal(err)
			}
			if body.Status != tc.wantStatus || len(body.Offers) != tc.wantOffers {
				t.Fatalf("unexpected result: %+v", body)
			}
		})
	}
}
