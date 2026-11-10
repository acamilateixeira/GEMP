// Runs the WebAssembly build in Node and checks the same cases as the HTTP tests.
// Usage: node scripts/wasm-smoke.cjs path/to/wasm_exec.js path/to/gemp.wasm
const fs = require('node:fs');
const [execPath, wasmPath] = process.argv.slice(2);
globalThis.dispatchEvent = () => true;
globalThis.Event = class { constructor(type) { this.type = type; } };
require(require('node:path').resolve(execPath));

const cases = [
    ['normal', '{"principal_cents":500000,"months":12}', 200, 'complete', 3],
    ['slow provider', '{"principal_cents":500000,"months":12,"scenario":"one_slow"}', 200, 'partial', 2],
    ['outage', '{"principal_cents":500000,"months":12,"scenario":"all_unavailable"}', 503, 'unavailable', 0],
    ['invalid term', '{"principal_cents":500000,"months":15}', 400, undefined, 0],
];

(async () => {
    const go = new Go();
    const { instance } = await WebAssembly.instantiate(fs.readFileSync(wasmPath), go.importObject);
    void go.run(instance);
    let failed = 0;
    for (const [name, body, code, status, offers] of cases) {
        const response = await globalThis.gempCompare(body);
        const result = JSON.parse(response.body);
        const ok = response.status === code && result.status === status && (result.offers ?? []).length === offers;
        console.log(`${ok ? '✓' : '✗'} ${name}: HTTP ${response.status}, ${result.status ?? result.error}, ${(result.offers ?? []).length} offers`);
        if (!ok) failed++;
    }

    // Cancelamento: o AbortSignal cancela o mesmo context.Context que os provedores recebem.
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20); // antes do provedor mais rápido (55 ms)
    const started = Date.now();
    const canceled = await globalThis.gempCompare('{"principal_cents":500000,"months":12}', controller.signal);
    const elapsed = Date.now() - started;
    const cancelOk = canceled.status === 499 && JSON.parse(canceled.body).error === 'canceled' && elapsed < 55;
    console.log(`${cancelOk ? '✓' : '✗'} canceled: HTTP ${canceled.status} after ${elapsed} ms`);
    if (!cancelOk) failed++;

    const preAborted = await globalThis.gempCompare('{"principal_cents":500000,"months":12}', AbortSignal.abort());
    const preOk = preAborted.status === 499;
    console.log(`${preOk ? '✓' : '✗'} already aborted: HTTP ${preAborted.status}`);
    if (!preOk) failed++;

    process.exit(failed ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });
