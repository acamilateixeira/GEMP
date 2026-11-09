export type ApiResponse = { status: number; body: unknown };

type GoRuntime = { importObject: WebAssembly.Imports; run(instance: WebAssembly.Instance): Promise<void> };
declare global {
    interface Window {
        Go?: new () => GoRuntime;
        gempCompare?: (body: string) => Promise<{ status: number; body: string }>;
    }
}

/**
 * Na demo publicada não há servidor: a página carrega o mesmo código Go da API,
 * compilado para WebAssembly (cmd/gemp-wasm). Localmente, a página chama a API Go.
 */
export const runsInBrowser = import.meta.env.VITE_GEMP_WASM === '1';

let runtime: Promise<void> | null = null;

function loadScript(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`could not load ${src}`));
        document.head.append(script);
    });
}

function startGo(): Promise<void> {
    runtime ??= (async () => {
        const base = import.meta.env.BASE_URL;
        await loadScript(`${base}wasm_exec.js`);
        if (!window.Go) throw new Error('Go runtime missing');
        const go = new window.Go();
        const ready = new Promise<void>((resolve) => window.addEventListener('gemp-ready', () => resolve(), { once: true }));
        const { instance } = await WebAssembly.instantiateStreaming(fetch(`${base}gemp.wasm`), go.importObject);
        void go.run(instance);
        await ready;
    })().catch((error: unknown) => {
        runtime = null; // permite tentar de novo
        throw error;
    });
    return runtime;
}

/** Pré-carrega o WebAssembly assim que a página abre, para a primeira comparação não esperar o download. */
export function warmUp(): void {
    if (runsInBrowser) void startGo().catch(() => undefined);
}

export async function postComparison(payload: object): Promise<ApiResponse> {
    if (runsInBrowser) {
        await startGo();
        if (!window.gempCompare) throw new Error('comparison not available');
        const response = await window.gempCompare(JSON.stringify(payload));
        return { status: response.status, body: JSON.parse(response.body) as unknown };
    }
    const response = await fetch('/api/comparisons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    return { status: response.status, body: (await response.json()) as unknown };
}
