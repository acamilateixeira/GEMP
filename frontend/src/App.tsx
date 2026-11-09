import { useEffect, useState, type FormEvent } from 'react';
import { postComparison, runsInBrowser, warmUp } from './api';

type Scenario = 'normal' | 'one_slow' | 'all_unavailable';
type Offer = {
    id: string;
    provider: string;
    monthly_rate_bp: number;
    fee_cents: number;
    installment_cents: number;
    total_cents: number;
};
type FailureCode = 'timeout' | 'unavailable' | 'invalid_quote';
type Result = {
    status: 'complete' | 'partial' | 'unavailable';
    offers: Offer[];
    failures: { provider: string; code: FailureCode }[];
};
type Comparison = { months: number; result: Result };

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const percent = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 2 });
const money = (cents: number) => currency.format(cents / 100);
const failureLabel: Record<FailureCode, string> = {
    timeout: 'Tempo limite excedido',
    unavailable: 'Indisponível',
    invalid_quote: 'Oferta inválida',
};

export default function App() {
    const [amount, setAmount] = useState('5000');
    const [months, setMonths] = useState(12);
    const [scenario, setScenario] = useState<Scenario>('normal');
    const [comparison, setComparison] = useState<Comparison | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    useEffect(warmUp, []);

    async function compare(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (loading) return;
        setComparison(null);
        setError('');
        const principal = Number(amount);
        if (!Number.isFinite(principal) || principal < 1000 || principal > 100000) {
            setError('Informe um valor de R$ 1.000 a R$ 100.000.');
            return;
        }
        setLoading(true);
        try {
            const response = await postComparison({ principal_cents: Math.round(principal * 100), months, scenario });
            const result = response.body as Result;
            const ok = response.status >= 200 && response.status < 300;
            if (!ok && !(response.status === 503 && result.status === 'unavailable')) {
                throw new Error('comparison request failed');
            }
            setComparison({ months, result });
        } catch {
            setError('A comparação não pôde ser carregada. Tente novamente.');
        } finally {
            setLoading(false);
        }
    }

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
                        <p className="hint">Esta página não tem servidor. Ela roda o mesmo código Go da API, compilado para WebAssembly: as três consultas em paralelo e o prazo de 250 ms por provedor acontecem no seu navegador.</p>
                    )}
                </section>
                <div className="grid">
                    <section className="panel" aria-labelledby="setup">
                        <p className="eyebrow">01 / SIMULAÇÃO</p>
                        <h2 id="setup">Defina o cenário</h2>
                        <form onSubmit={compare}>
                            <label htmlFor="amount">Valor solicitado (R$)</label>
                            <input id="amount" value={amount} onChange={(event) => setAmount(event.target.value)} type="number" min="1000" max="100000" step="0.01" required />
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
                            <button type="submit" disabled={loading}>{loading ? 'Comparando…' : 'Comparar ofertas'}</button>
                            {error && <p className="notice error" role="alert">{error}</p>}
                        </form>
                        <p className="hint">Os provedores, as taxas e os valores são ilustrativos. A simulação usa apenas o valor e o prazo informados.</p>
                    </section>
                    <section className="panel results" aria-labelledby="result-title" aria-busy={loading}>
                        <p className="eyebrow">02 / COMPARAÇÃO</p>
                        <h2 id="result-title">Ofertas por custo total</h2>
                        <div aria-live="polite">
                            {comparison ? <Offers comparison={comparison} /> : (
                                <p className="empty">{loading ? 'Consultando os provedores…' : 'Os resultados aparecem aqui após a simulação.'}</p>
                            )}
                        </div>
                    </section>
                </div>
                <footer>Simulação didática. O total é a soma das parcelas arredondadas e da tarifa inicial.</footer>
            </main>
        </>
    );
}

function Offers({ comparison: { months, result } }: { comparison: Comparison }) {
    return (
        <>
            {result.status === 'partial' && <p className="notice">Resultado parcial. As ofertas disponíveis continuam abaixo.</p>}
            {result.status === 'unavailable' && <p className="notice error">Nenhum provedor respondeu com uma oferta. Selecione outro cenário ou tente novamente.</p>}
            {result.failures.length > 0 && (
                <ul className="failures">
                    {result.failures.map((failure) => <li key={failure.provider}>{failure.provider} · {failureLabel[failure.code]}</li>)}
                </ul>
            )}
            <ol className="offers">
                {result.offers.map((offer, index) => (
                    <li className="offer" key={offer.id}>
                        <div className="offer-heading">
                            <h3>{offer.provider}</h3>
                            {index === 0 && <span className="tag">Menor custo disponível</span>}
                        </div>
                        <strong className="total">{money(offer.total_cents)}</strong>
                        <dl>
                            <div><dt>{months} parcelas</dt><dd>{money(offer.installment_cents)}</dd></div>
                            <div><dt>Taxa mensal</dt><dd>{percent.format(offer.monthly_rate_bp / 10000)}</dd></div>
                            <div><dt>Tarifa inicial</dt><dd>{money(offer.fee_cents)}</dd></div>
                        </dl>
                    </li>
                ))}
            </ol>
        </>
    );
}
