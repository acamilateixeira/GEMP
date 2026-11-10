// Regras da lista de ofertas, sem React, para serem testadas isoladamente
// (tests/frontend/offers.test.ts). Todos os valores em centavos inteiros.

export type Offer = {
    id: string;
    provider: string;
    monthly_rate_bp: number;
    fee_cents: number;
    installment_cents: number;
    total_cents: number;
};
export type FailureCode = 'timeout' | 'unavailable' | 'invalid_quote';
export type Result = {
    status: 'complete' | 'partial' | 'unavailable';
    offers: Offer[];
    failures: { provider: string; code: FailureCode }[];
};

export type SortKey = 'total' | 'installment' | 'rate' | 'fee';

const byKey: Record<SortKey, (offer: Offer) => number> = {
    total: (offer) => offer.total_cents,
    installment: (offer) => offer.installment_cents,
    rate: (offer) => offer.monthly_rate_bp,
    fee: (offer) => offer.fee_cents,
};

/** Ordena sem alterar a lista original. Empates caem no custo total e depois no id, como no servidor. */
export function sortOffers(offers: readonly Offer[], key: SortKey): Offer[] {
    const value = byKey[key];
    return [...offers].sort((a, b) => value(a) - value(b) || a.total_cents - b.total_cents || a.id.localeCompare(b.id));
}

export function filterOffers(offers: readonly Offer[], filters: { noFee: boolean }): Offer[] {
    return filters.noFee ? offers.filter((offer) => offer.fee_cents === 0) : [...offers];
}

/** Menor custo total entre todas as ofertas recebidas, independentemente de filtro e ordenação. */
export function cheapestId(offers: readonly Offer[]): string | null {
    return sortOffers(offers, 'total')[0]?.id ?? null;
}

export type Breakdown = {
    installmentsCents: number;
    interestCents: number;
    feeCents: number;
    totalCents: number;
    extraVsCheapestCents: number;
    /** O total do servidor bate com parcelas × prazo + tarifa? Falso indica contrato quebrado. */
    consistent: boolean;
};

export function breakdown(offer: Offer, principalCents: number, months: number, cheapestTotalCents: number): Breakdown {
    const installmentsCents = offer.installment_cents * months;
    return {
        installmentsCents,
        interestCents: installmentsCents - principalCents,
        feeCents: offer.fee_cents,
        totalCents: offer.total_cents,
        extraVsCheapestCents: offer.total_cents - cheapestTotalCents,
        consistent: installmentsCents + offer.fee_cents === offer.total_cents,
    };
}

/** Converte "5.000,50" ou "5000.50" em centavos inteiros sem passar por ponto flutuante. */
export function parseAmountToCents(input: string): number | null {
    const normalized = input.trim().replace(/\s/g, '');
    const match = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:[,.](\d{1,2}))?$/.exec(normalized);
    if (!match) return null;
    const reais = Number(match[1].replace(/\./g, ''));
    const cents = Number((match[2] ?? '').padEnd(2, '0'));
    const total = reais * 100 + cents;
    return Number.isSafeInteger(total) ? total : null;
}
