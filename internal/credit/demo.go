package credit

import (
	"context"
	"errors"
	"time"
)

type demoProvider struct {
	id    string
	rate  int64
	fee   int64
	delay time.Duration
}

func (p demoProvider) ID() string { return p.id }

func (p demoProvider) Quote(ctx context.Context, req Request) (Terms, error) {
	delay := p.delay
	if req.Scenario == "one_slow" && p.id == "Ponte" {
		delay = 650 * time.Millisecond
	}
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return Terms{}, ctx.Err()
	case <-timer.C:
		if req.Scenario == "all_unavailable" {
			return Terms{}, errors.New("simulated provider outage")
		}
		// The fictional providers all use the same provider-local identifier.
		return Terms{ExternalID: "standard", MonthlyRateBP: p.rate, FeeCents: p.fee}, nil
	}
}

func DemoProviders() []Provider {
	return []Provider{
		demoProvider{id: "Aurora", rate: 135, fee: 45_000, delay: 55 * time.Millisecond},
		demoProvider{id: "Ponte", rate: 180, delay: 85 * time.Millisecond},
		demoProvider{id: "Vale", rate: 205, fee: 9_000, delay: 115 * time.Millisecond},
	}
}
