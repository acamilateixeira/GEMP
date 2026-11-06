package credit

import (
	"context"
	"errors"
	"testing"
	"time"
)

type testProvider struct {
	id  string
	run func(context.Context, Request) (Terms, error)
}

func (p testProvider) ID() string { return p.id }
func (p testProvider) Quote(ctx context.Context, req Request) (Terms, error) {
	return p.run(ctx, req)
}

func TestCompareConcurrentProvidersAndRanksByTotalCost(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	started := make(chan struct{}, 2)
	release := make(chan struct{})
	provider := func(id string, rate, fee int64) Provider {
		return testProvider{id, func(ctx context.Context, _ Request) (Terms, error) {
			started <- struct{}{}
			select {
			case <-release:
				return Terms{ExternalID: "shared", MonthlyRateBP: rate, FeeCents: fee}, nil
			case <-ctx.Done():
				return Terms{}, ctx.Err()
			}
		}}
	}
	done := make(chan Result, 1)
	go func() {
		result, _ := Compare(ctx, Request{PrincipalCents: 600_000, Months: 6},
			[]Provider{provider("LowRate", 0, 60_000), provider("LowCost", 100, 0)}, 2*time.Second)
		done <- result
	}()

	for range 2 {
		select {
		case <-started:
		case <-ctx.Done():
			t.Fatal("both provider calls did not start")
		}
	}
	close(release)
	result := <-done
	if result.Status != "complete" || len(result.Offers) != 2 {
		t.Fatalf("unexpected result: %+v", result)
	}
	best, second := result.Offers[0], result.Offers[1]
	if best.ID != "LowCost:shared" || second.ID != "LowRate:shared" || best.TotalCents >= second.TotalCents {
		t.Fatalf("offers not ranked by total cost: %+v", result.Offers)
	}
	if second.InstallmentCents != 100_000 || second.TotalCents != 660_000 {
		t.Fatalf("unexpected zero-interest calculation: %+v", second)
	}
}

func TestComparePreservesOffersOnTimeoutAndInvalidQuote(t *testing.T) {
	valid := testProvider{"Good", func(_ context.Context, _ Request) (Terms, error) {
		return Terms{ExternalID: "standard", MonthlyRateBP: 100}, nil
	}}
	slow := testProvider{"Slow", func(ctx context.Context, _ Request) (Terms, error) {
		<-ctx.Done()
		return Terms{}, ctx.Err()
	}}
	invalid := testProvider{"Invalid", func(_ context.Context, _ Request) (Terms, error) {
		return Terms{ExternalID: "standard", MonthlyRateBP: -1}, nil
	}}
	result, err := Compare(context.Background(), Request{PrincipalCents: 500_000, Months: 12},
		[]Provider{valid, slow, invalid}, 50*time.Millisecond)
	if err != nil || result.Status != "partial" || len(result.Offers) != 1 ||
		len(result.Failures) != 2 || result.Failures[0].Code != "invalid_quote" || result.Failures[1].Code != "timeout" {
		t.Fatalf("unexpected result: %+v, %v", result, err)
	}
}

func TestComparePropagatesClientCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := Compare(ctx, Request{PrincipalCents: 500_000, Months: 12}, DemoProviders(), time.Second)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("want context.Canceled, got %v", err)
	}
}
