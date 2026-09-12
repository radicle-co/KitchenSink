/**
 * The CRF leg's LOCAL transport — asserted through the SHIPPED adapter, `createCrfInvokeEngine`.
 *
 * ⛔ THE ADAPTER IS NOT REIMPLEMENTED HERE. `crfInvoke.ts` owns the chunking to `MAX_LINES`, the
 * `engineResponseSchema` validation, the engine-version refusal and the per-line `failed` → absence mapping;
 * every one of those is a claim about the CRF leg that must hold locally too. So the local wiring replaces
 * only the TRANSPORT — the `Pick<LambdaClient, 'send'>` that adapter already takes injected — and these
 * tests drive the real adapter over it.
 *
 * ⚠️ The engine version is derived from `requirements.txt`, NOT from the interpreter that is about to answer.
 * Reading it from the answer's own source would make the adapter's version check agree with itself by
 * construction, which is the one thing it exists not to do.
 */
import { describe, expect, it } from 'vitest';

import { createCrfInvokeEngine } from '../../parsing/crfInvoke.js';
import { createLocalCrfLambdaClient, pinnedCrfEngineVersion, type LocalCrfEngineRunner } from '../localCrfEngine.js';

/** A runner that answers with whatever the test hands it, and records what it was asked. */
function runnerReturning(answer: unknown): { run: LocalCrfEngineRunner; requests: string[] } {
    const requests: string[] = [];

    const run: LocalCrfEngineRunner = async (request) => {
        requests.push(request);

        return { ok: true, payload: JSON.stringify(answer) };
    };

    return { run, requests };
}

// ⛔ The DECLARED value is the pinned form `name==version`, while the engine REPORTS a bare version — that
// asymmetry is the contract (`crfInvoke` normalizes the report up to the pin, so both CRF adapters key
// `ingredient_parse_cache` with one spelling). `parseEnginePin` rejects a bare string at construction, so a
// bare default here would fail every case in this file for a reason that has nothing to do with transport.
const engineFor = (run: LocalCrfEngineRunner, version = 'ingredient-parser-nlp==2.3.0') =>
    createCrfInvokeEngine({
        functionName: 'local-ingredient-parser',
        client: createLocalCrfLambdaClient(run),
        declaredEngineVersion: version,
        // This suite is about the local TRANSPORT, not the availability signal, so the emitter is a sink.
        // `crfInvoke`'s own suite owns the metric's behaviour; duplicating it here would assert it twice
        // and let one copy drift.
        stage: 'local',
        emit: () => {},
    });

describe('the local CRF transport', () => {
    it('hands the engine the SAME request body the deployed adapter sends', async () => {
        const { run, requests } = runnerReturning({ engine: 'crf', engineVersion: '2.3.0', results: [] });

        await engineFor(run).parse(['2 cups flour']);

        // ⛔ The wire body, byte-for-byte — `{"lines":[...]}`. A transport that re-shaped it would make the
        // local run exercise a contract the deployed Lambda never receives.
        expect(requests).toEqual([JSON.stringify({ lines: ['2 cups flour'] })]);
    });

    it('promotes a parsed row exactly as the deployed adapter does', async () => {
        const { run } = runnerReturning({
            engine: 'crf',
            engineVersion: '2.3.0',
            results: [
                {
                    status: 'parsed',
                    sentence: '2 cups flour, sifted',
                    measure: '2 cups',
                    names: ['flour'],
                    size: null,
                    preparation: 'sifted',
                    comment: null,
                },
            ],
        });

        const [answer] = await engineFor(run).parse(['2 cups flour, sifted']);

        expect(answer).toMatchObject({ raw: '2 cups flour, sifted', unit: 'cup' });
    });

    it('⛔ a runner FAILURE REJECTS — it is not a per-line `unavailable`', async () => {
        const run: LocalCrfEngineRunner = async () => ({ ok: false, reason: 'python3: command not found' });

        // ⚠️ REWRITTEN 2026-09-02 to prove the NEW behaviour. This case previously asserted
        // `[{unavailable:true}, {unavailable:true}]`. `crfInvoke` now REJECTS when an invocation produced no
        // engine answer at all, because the two facts it used to conflate are different: a per-line
        // `status: 'failed'` means the engine read the line and declined it (the leg WORKS), whereas no
        // answer at all means the leg is gone. Only the second must reach `onTierFailure`, which is the
        // pipeline's ONLY channel for it — an adapter that swallows is reported nowhere, which is exactly
        // how an undeployed CRF ran silently for weeks.
        //
        // ⛔ ADR-0026 §3 is NOT weakened: the pipeline still records this as ABSENCE for the comparator, and
        // absence is still never dissent. What changed is that the pipeline can now SEE it. The rejection is
        // also what makes the line transient rather than permanent, so an outage does not become a stored
        // fact about an ingredient.
        await expect(engineFor(run).parse(['2 cups flour', '1 egg'])).rejects.toThrow(/CRF|unavailable|engine/iu);
    });

    it('⛔ surfaces the failure through `FunctionError`, which is what the adapter reads', async () => {
        // The adapter distinguishes a failed invocation from a bad payload by `FunctionError`. A transport
        // that threw instead would escape the adapter's own containment and take the batch down.
        const client = createLocalCrfLambdaClient(async () => ({ ok: false, reason: 'boom' }));
        const response = (await client.send({ input: { Payload: Buffer.from('{}') } } as never)) as {
            FunctionError?: string;
        };

        expect(response.FunctionError).toBeDefined();
    });

    it('⛔ refuses an answer whose engine version differs from the pin', async () => {
        const { run } = runnerReturning({
            engine: 'crf',
            engineVersion: '9.9.9',
            results: [
                {
                    status: 'parsed',
                    sentence: 'x',
                    measure: '',
                    names: ['x'],
                    size: null,
                    preparation: null,
                    comment: null,
                },
            ],
        });

        // ⚠️ REWRITTEN 2026-09-02 alongside the case above, and for the same reason. A version skew is a
        // CONTRACT failure of the whole invocation, not a verdict about this line, so it rejects via the
        // same `abandon` path and publishes the same availability datapoint. This is the case that was
        // silently true in production: the stack declared `ingredient-parser-nlp==2.3.0` while the engine
        // reported `2.3.0`, compared with strict `!==`, so EVERY answer was discarded — and the docstring
        // claiming it would fail "loudly, in this function's logs" was itself the thing nobody heard.
        await expect(engineFor(run, 'ingredient-parser-nlp==2.3.0').parse(['x'])).rejects.toThrow(
            /version|contract|CRF/iu,
        );
    });

    describe('the pinned engine version', () => {
        it('is the FULL PIN, matching what the deployed stack injects', () => {
            // ⚠️ REWRITTEN 2026-09-02: this asserted the BARE version. `handler.py` still reports a bare
            // `2.3.0` via `importlib.metadata.version(...)`, but `declaredEngineVersion` is now the pinned
            // form on BOTH sides — the adapter parses its pin at construction and normalizes the engine's
            // report up to it, so the two CRF adapters key `ingredient_parse_cache` with one identity
            // instead of partitioning it. Local must hand the adapter the same spelling
            // `CRF_ENGINE_VERSION` gives the deployed leg, or the local run exercises a different path.
            expect(pinnedCrfEngineVersion()).toMatch(/^ingredient-parser-nlp==\d+\.\d+\.\d+$/u);
        });

        it('names the version requirements.txt actually pins', () => {
            expect(pinnedCrfEngineVersion({ requirements: 'ingredient-parser-nlp==4.5.6\n' })).toBe(
                'ingredient-parser-nlp==4.5.6',
            );
        });

        it('throws rather than guessing when the pin is gone', () => {
            expect(() => pinnedCrfEngineVersion({ requirements: 'ingredient-parser-nlp\n' })).toThrow(/pin/iu);
        });
    });
});
