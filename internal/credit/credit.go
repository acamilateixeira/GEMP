package credit

import (
	"context"
	"errors"
	"math"
	"slices"
	"sort"
	"strings"
	"time"
)

type Request struct {
	PrincipalCents int64  `json:"principal_cents"`
	Months         int    `json:"months"`
	Scenario       string `json:"scenario"`
}

func (r Request) Valid() bool {
	return r.PrincipalCents >= 100_000 && r.PrincipalCents <= 10_000_000 &&
		slices.Contains([]int{6, 12, 24, 36}, r.Months) &&
		slices.Contains([]string{"", "normal", "one_slow", "all_unavailable"}, r.Scenario)
}

type Terms struct {
	ExternalID    string
	MonthlyRateBP int64
	FeeCents      int64
}

// Provider adapters must respect cancellation and deadlines.
type Provider interface {
	ID() string
	Quote(context.Context, Request) (Terms, error)
}

type Offer struct {
	ID               string `json:"id"`
	Provider         string `json:"provider"`
	MonthlyRateBP    int64  `json:"monthly_rate_bp"`
	FeeCents         int64  `json:"fee_cents"`
	InstallmentCents int64  `json:"installment_cents"`
	TotalCents       int64  `json:"total_cents"`
}

type Failure struct {
	Provider string `json:"provider"`
	Code     string `json:"code"`
}

type Result struct {
	Offers   []Offer   `json:"offers"`
	Failures []Failure `json:"failures"`
	Status   string    `json:"status"`
}

type outcome struct {
	offer   Offer
	failure Failure
}

func Compare(ctx context.Context, req Request, providers []Provider, timeout time.Duration) (Result, error) {
	results := make(chan outcome, len(providers))
	for _, provider := range providers {
		go func() {
			callCtx, cancel := context.WithTimeout(ctx, timeout)
			defer cancel()
			results <- quote(callCtx, provider, req)
		}()
	}

	result := Result{Offers: []Offer{}, Failures: []Failure{}, Status: "complete"}
	for range providers {
		select {
		case <-ctx.Done():
			return Result{}, ctx.Err()
		case response := <-results:
			if response.failure.Code != "" {
				result.Failures = append(result.Failures, response.failure)
			} else {
				result.Offers = append(result.Offers, response.offer)
			}
		}
	}
	if err := ctx.Err(); err != nil {
		return Result{}, err
	}
	sort.Slice(result.Offers, func(i, j int) bool {
		a, b := result.Offers[i], result.Offers[j]
		if a.TotalCents != b.TotalCents {
			return a.TotalCents < b.TotalCents
		}
		return a.ID < b.ID
	})
	slices.SortFunc(result.Failures, func(a, b Failure) int { return strings.Compare(a.Provider, b.Provider) })
	if len(result.Offers) == 0 {
		result.Status = "unavailable"
	} else if len(result.Failures) > 0 {
		result.Status = "partial"
	}
	return result, nil
}

func quote(ctx context.Context, provider Provider, req Request) outcome {
	terms, err := provider.Quote(ctx, req)
	id := provider.ID()
	if errors.Is(ctx.Err(), context.DeadlineExceeded) || errors.Is(err, context.DeadlineExceeded) {
		return outcome{failure: Failure{id, "timeout"}}
	}
	if err != nil {
		return outcome{failure: Failure{id, "unavailable"}}
	}
	if terms.ExternalID == "" || terms.MonthlyRateBP < 0 || terms.MonthlyRateBP > 10_000 ||
		terms.FeeCents < 0 || terms.FeeCents > req.PrincipalCents {
		return outcome{failure: Failure{id, "invalid_quote"}}
	}

	rate := float64(terms.MonthlyRateBP) / 10_000
	principal := float64(req.PrincipalCents)
	installment := principal / float64(req.Months)
	if rate > 0 {
		installment = principal * rate / (1 - math.Pow(1+rate, -float64(req.Months)))
	}
	cents := int64(math.Round(installment))
	return outcome{offer: Offer{
		ID: id + ":" + terms.ExternalID, Provider: id, MonthlyRateBP: terms.MonthlyRateBP,
		FeeCents: terms.FeeCents, InstallmentCents: cents, TotalCents: cents*int64(req.Months) + terms.FeeCents,
	}}
}
