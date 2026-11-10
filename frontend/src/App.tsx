import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { STATUS_CANCELED, postComparison, runsInBrowser, warmUp } from './api';
import { breakdown, cheapestId, filterOffers, parseAmountToCents, sortOffers, type FailureCode, type Offer, type Result, type SortKey } from './offers';

type Scenario = 'normal' | 'one_slow' | 'all_unavailable';
type Comparison = { principalCents: number; months: number; result: Result };
type Outcome = 'idle' | 'loading' | 'done' | 'canceled' | 'timeout' | 'invalid' | 'failed';

/** Prazo da comparação inteira no cliente. Cada provedor já tem 250 ms no Go; isto cobre rede e carga do WebAssembly. */
const CLIENT_DEADLINE_MS = 5_000;
const MIN_CENTS = 100_000;
const MAX_CENTS = 10_000_000;

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const percent = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 2 });
const money = (cents: number) => currency.format(cents / 100);
const failureLabel: Record<FailureCode, string> = {
    timeout: 'Tempo limite excedido',
    unavailable: 'Indisponível',
    invalid_quote: 'Oferta inválida',
};
const sortLabel: Record<SortKey, string> = {
    total: 'Menor custo total',
    installment: 'Menor parcela',
    rate: 'Menor taxa mensal',
    fee: 'Menor tarifa inicial',
};
const outcomeMessage: Partial<Record<Outcome, string>> = {
    canceled: 'Comparação cancelada. As consultas aos provedores foram interrompidas.',
    timeout: `A comparação passou de ${CLIENT_DEADLINE_MS / 1000} s e foi cancelada. Tente novamente.`,
    invalid: 'Os dados foram recusados pela API. Confira o valor e o prazo.',
    failed: 'A comparação não pôde ser carregada. Tente novamente.',
};

export default function App() {
    const [amount, setAmount] = useState('5000');
    const [months, setMonths] = useState(12);
    const [scenario, setScenario] = useState<Scenario>('normal');
    const [comparison, setComparison] = useState<Comparison | null>(null);
    const [outcome, setOutcome] = useState<Outcome>('idle');
    const [inputError, setInputError] = useState('');
    const controller = useRef<AbortController | null>(null);
    const loading = outcome === 'loading';

    useEffect(warmUp, []);
    // Sai da página no meio de uma comparação → cancela as consultas.
    useEffect(() => () => controller.current?.abort(), []);

    async function compare(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (loading) return;
        setInputError('');
        const principalCents = parseAmountToCents(amount);
        if (principalCents === null || principalCents < MIN_CENTS || principalCents > MAX_CENTS) {
            setInputError('Informe um valor de R$ 1.000 a R$ 100.000.');
            return;
        }

        const current = new AbortController();
        controller.current = current;
        let timedOut = false;
        const deadline = window.setTimeout(() => {
            timedOut = true;
            current.abort();
        }, CLIENT_DEADLINE_MS);

        setComparison(null);
        setOutcome('loading');
        try {
            const response = await postComparison({ principal_cents: principalCents, months, scenario }, current.signal);
            if (response.status === STATUS_CANCELED || current.signal.aborted) {
                setOutcome(timedOut ? 'timeout' : 'canceled');
                return;
            }
            if (response.status === 400) {
                setOutcome('invalid');
                return;
            }
            const result = response.body as Result;
            const ok = response.status >= 200 && response.status < 300;
            if (!ok && !(response.status === 503 && result.status === 'unavailable')) {
                setOutcome('failed');
                return;
            }
            setComparison({ principalCents, months, result });
            setOutcome('done');
        } catch {
            setOutcome(current.signal.aborted ? (timedOut ? 'timeout' : 'canceled') : 'failed');
        } finally {
            window.clearTimeout(deadline);
            if (controller.current === current) controller.current = null;
        }
    }

    const message = outcomeMessage[outcome];

    return (
        <>
            <header className="top">
                <div className="wrap top-inner">
                    <strong className="brand">GEMP</strong>
                    <span className="tag">{runsInBrowser ? 'Demo no navegador · Go em WebAssembly' : 'Ambiente de demonstração'}</span>
                </div>
            </header>
            <main className="wrap">
                <section className="intro">
                    <p className="eyebrow">LABORATÓRIO DE INTEGRAÇÃO</p>
                    <h1>Compare ofertas de crédito</h1>
                    <p>Veja quanto cada oferta fictícia custa no total e experimente o que acontece quando um provedor atrasa ou fica indisponível.</p>
                    {runsInBrowser && (
                        <p className="hint">Esta página não tem servidor. Ela roda o mesmo código Go da API, compilado para WebAssembly: as três consultas em paralelo, o prazo de 250 ms por provedor e o cancelamento acontecem no seu navegador.</p>
                    )}
                </section>
                <div className="grid">
                    <section className="panel" aria-labelledby="setup">
                        <p className="eyebrow">01 / SIMULAÇÃO</p>
                        <h2 id="setup">Defina o cenário</h2>
                        <form onSubmit={compare} noValidate>
                            <label htmlFor="amount">Valor solicitado (R$)</label>
                            <input
                                id="amount"
                                value={amount}
                                onChange={(event) => setAmount(event.target.value)}
                                inputMode="decimal"
                                autoComplete="off"
                                aria-describedby="amount-help"
                                aria-invalid={inputError !== ''}
                                aria-errormessage={inputError ? 'amount-error' : undefined}
                                required
                            />
                            <p id="amount-help" className="field-help">De R$ 1.000 a R$ 100.000. Aceita 5000, 5000,50 ou 5.000,50.</p>
                            {inputError && <p id="amount-error" className="notice error" role="alert">{inputError}</p>}
                            <label htmlFor="months">Prazo</label>
                            <select id="months" value={months} onChange={(event) => setMonths(Number(event.target.value))}>
                                {[6, 12, 24, 36].map((term) => <option key={term} value={term}>{term} meses</option>)}
                            </select>
                            <label htmlFor="scenario">Comportamento dos provedores</label>
                            <select id="scenario" value={scenario} onChange={(event) => setScenario(event.target.value as Scenario)}>
                                <option value="normal">Todos respondem</option>
                                <option value="one_slow">Um provedor excede o prazo</option>
                                <option value="all_unavailable">Todos indisponíveis</option>
                            </select>
                            <div className="actions">
                                <button type="submit" disabled={loading}>{loading ? 'Comparando…' : 'Comparar ofertas'}</button>
                                {loading && (
                                    <button type="button" className="secondary" onClick={() => controller.current?.abort()}>
                                        Cancelar
                                    </button>
                                )}
                            </div>
                        </form>
                        <p className="hint">Os provedores, as taxas e os valores são ilustrativos. A simulação usa apenas o valor e o prazo informados.</p>
                    </section>
                    <section className="panel results" aria-labelledby="result-title" aria-busy={loading}>
                        <p className="eyebrow">02 / COMPARAÇÃO</p>
                        <h2 id="result-title">Ofertas</h2>
                        <div aria-live="polite">
                            {comparison && <Offers comparison={comparison} />}
                            {!comparison && message && (
                                <p className={`notice ${outcome === 'canceled' ? '' : 'error'}`} role={outcome === 'canceled' ? 'status' : 'alert'}>{message}</p>
                            )}
                            {!comparison && !message && (
                                <p className="empty">{loading ? 'Consultando os provedores…' : 'Os resultados aparecem aqui após a simulação.'}</p>
                            )}
                        </div>
                    </section>
                </div>
                <footer>Simulação didática. O total é a soma das parcelas arredondadas e da tarifa inicial. Juros = parcelas × prazo − valor solicitado.</footer>
            </main>
        </>
    );
}

function Offers({ comparison: { principalCents, months, result } }: { comparison: Comparison }) {
    const [sort, setSort] = useState<SortKey>('total');
    const [noFee, setNoFee] = useState(false);
    const sortId = useId();
    const feeId = useId();
    const bestId = cheapestId(result.offers);
    const bestTotal = result.offers.find((offer) => offer.id === bestId)?.total_cents ?? 0;
    const visible = useMemo(() => sortOffers(filterOffers(result.offers, { noFee }), sort), [result.offers, noFee, sort]);

    return (
        <>
            {result.status === 'partial' && <p className="notice">Resultado parcial. As ofertas disponíveis continuam abaixo.</p>}
            {result.status === 'unavailable' && <p className="notice error">Nenhum provedor respondeu com uma oferta. Selecione outro cenário ou tente novamente.</p>}
            {result.failures.length > 0 && (
                <ul className="failures" aria-label="Provedores sem oferta">
                    {result.failures.map((failure) => <li key={failure.provider}>{failure.provider} · {failureLabel[failure.code]}</li>)}
                </ul>
            )}
            {result.offers.length > 0 && (
                <div className="toolbar">
                    <div>
                        <label htmlFor={sortId}>Ordenar por</label>
                        <select id={sortId} value={sort} onChange={(event) => setSort(event.target.value as SortKey)}>
                            {(Object.keys(sortLabel) as SortKey[]).map((key) => <option key={key} value={key}>{sortLabel[key]}</option>)}
                        </select>
                    </div>
                    <label className="check" htmlFor={feeId}>
                        <input id={feeId} type="checkbox" checked={noFee} onChange={(event) => setNoFee(event.target.checked)} />
                        Só sem tarifa inicial
                    </label>
                </div>
            )}
            {result.offers.length > 0 && (
                <p className="count">{visible.length} de {result.offers.length} {result.offers.length === 1 ? 'oferta' : 'ofertas'} · {sortLabel[sort].toLowerCase()}</p>
            )}
            {result.offers.length > 0 && visible.length === 0 && (
                <p className="empty">Nenhuma oferta sem tarifa inicial. Desmarque o filtro para ver as outras.</p>
            )}
            <ol className="offers">
                {visible.map((offer) => (
                    <OfferCard key={offer.id} offer={offer} cheapest={offer.id === bestId} principalCents={principalCents} months={months} bestTotal={bestTotal} />
                ))}
            </ol>
        </>
    );
}

function OfferCard({ offer, cheapest, principalCents, months, bestTotal }: { offer: Offer; cheapest: boolean; principalCents: number; months: number; bestTotal: number }) {
    const detail = breakdown(offer, principalCents, months, bestTotal);
    return (
        <li className="offer">
            <div className="offer-heading">
                <h3>{offer.provider}</h3>
                {cheapest && <span className="tag">Menor custo disponível</span>}
            </div>
            <strong className="total">{money(offer.total_cents)}</strong>
            <dl>
                <div><dt>{months} parcelas</dt><dd>{money(offer.installment_cents)}</dd></div>
                <div><dt>Taxa mensal</dt><dd>{percent.format(offer.monthly_rate_bp / 10000)}</dd></div>
                <div><dt>Tarifa inicial</dt><dd>{money(offer.fee_cents)}</dd></div>
            </dl>
            <details>
                <summary>Composição do custo</summary>
                <dl className="breakdown">
                    <div><dt>Valor solicitado</dt><dd>{money(principalCents)}</dd></div>
                    <div><dt>Juros</dt><dd>{money(detail.interestCents)}</dd></div>
                    <div><dt>Tarifa inicial</dt><dd>{money(detail.feeCents)}</dd></div>
                    <div><dt>Total pago</dt><dd>{money(detail.totalCents)}</dd></div>
                    <div><dt>Diferença para a mais barata</dt><dd>{detail.extraVsCheapestCents === 0 ? '—' : `+ ${money(detail.extraVsCheapestCents)}`}</dd></div>
                </dl>
                {!detail.consistent && <p className="notice error">O total recebido não bate com parcelas × prazo + tarifa.</p>}
            </details>
        </li>
    );
}
