package api

import (
	"context"
	"strings"
	"testing"

	"github.com/acamilateixeira/GEMP/internal/credit"
)

func TestCompareStatuses(t *testing.T) {
	for _, tc := range []struct {
		body string
		want int
	}{
		{`{"principal_cents":500000,"months":12}`, StatusOK},
		{`{"principal_cents":500000,"months":12,"scenario":"all_unavailable"}`, StatusUnavailable},
		{`{"principal_cents":500000,"months":15}`, StatusBadRequest},
		{`not json`, StatusBadRequest},
	} {
		status, _, ok := Compare(context.Background(), strings.NewReader(tc.body), credit.DemoProviders())
		if !ok || status != tc.want {
			t.Fatalf("%s: want %d, got %d (ok=%v)", tc.body, tc.want, status, ok)
		}
	}
}

func TestCompareReportsCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, _, ok := Compare(ctx, strings.NewReader(`{"principal_cents":500000,"months":12}`), credit.DemoProviders()); ok {
		t.Fatal("a canceled request must not produce a response")
	}
}
