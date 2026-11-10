// Testes das regras da lista de ofertas. Rodam com o test runner do Node
// (node --test), sem dependências: o Node 22 remove os tipos do TypeScript.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { breakdown, cheapestId, filterOffers, parseAmountToCents, sortOffers, type Offer } from '../../frontend/src/offers.ts';

// Valores que o servidor devolve para R$ 5.000 em 12 meses com os provedores da demo
// (conferidos com credit.Compare e credit.DemoProviders).
const offers: Offer[] = [
    { id: 'Ponte:standard', provider: 'Ponte', monthly_rate_bp: 180, fee_cents: 0, installment_cents: 46_701, total_cents: 560_412 },
    { id: 'Aurora:standard', provider: 'Aurora', monthly_rate_bp: 135, fee_cents: 45_000, installment_cents: 45_413, total_cents: 589_956 },
    { id: 'Vale:standard', provider: 'Vale', monthly_rate_bp: 205, fee_cents: 9_000, installment_cents: 47_425, total_cents: 578_100 },
];

test('ordena por cada critério sem alterar a lista recebida', () => {
    const ids = (key: Parameters<typeof sortOffers>[1]) => sortOffers(offers, key).map((offer) => offer.provider);
    assert.deepEqual(ids('total'), ['Ponte', 'Vale', 'Aurora']);
    assert.deepEqual(ids('installment'), ['Aurora', 'Ponte', 'Vale']);
    assert.deepEqual(ids('rate'), ['Aurora', 'Ponte', 'Vale']);
    assert.deepEqual(ids('fee'), ['Ponte', 'Vale', 'Aurora']);
    assert.equal(offers[0].provider, 'Ponte');
});

test('empate desempata pelo custo total e depois pelo id, como o servidor', () => {
    const tied = [
        { ...offers[0], id: 'B', fee_cents: 0, total_cents: 600_000 },
        { ...offers[0], id: 'A', fee_cents: 0, total_cents: 600_000 },
        { ...offers[0], id: 'C', fee_cents: 0, total_cents: 550_000 },
    ];
    assert.deepEqual(sortOffers(tied, 'fee').map((offer) => offer.id), ['C', 'A', 'B']);
});

test('filtro sem tarifa inicial e menor custo independente do filtro', () => {
    assert.deepEqual(filterOffers(offers, { noFee: true }).map((offer) => offer.provider), ['Ponte']);
    assert.equal(filterOffers(offers, { noFee: false }).length, 3);
    assert.equal(cheapestId(offers), 'Ponte:standard');
    assert.equal(cheapestId([]), null);
});

test('composição do custo em centavos inteiros', () => {
    const vale = breakdown(offers[2], 500_000, 12, 560_412);
    assert.deepEqual(vale, {
        installmentsCents: 569_100,
        interestCents: 69_100,
        feeCents: 9_000,
        totalCents: 578_100,
        extraVsCheapestCents: 17_688,
        consistent: true,
    });
    assert.equal(breakdown({ ...offers[2], total_cents: 578_101 }, 500_000, 12, 560_412).consistent, false);
});

test('converte valores digitados em centavos sem ponto flutuante', () => {
    assert.equal(parseAmountToCents('5000'), 500_000);
    assert.equal(parseAmountToCents('5000.5'), 500_050);
    assert.equal(parseAmountToCents('5.000,50'), 500_050);
    assert.equal(parseAmountToCents('1.000'), 100_000);
    assert.equal(parseAmountToCents(' 0,29 '), 29); // 0.29 * 100 = 28.999999999999996 em float
    assert.equal(parseAmountToCents('12,345'), null);
    assert.equal(parseAmountToCents('-10'), null);
    assert.equal(parseAmountToCents('abc'), null);
});
