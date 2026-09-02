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

const engineFor = (run: LocalCrfEngineRunner, version = '2.3.0') =>
    createCrfInvokeEngine({
        functionName: 'local-ingredient-parser',
        client: createLocalCrfLambdaClient(run),
        declaredEngineVersion: version,
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

    it('⛔ a runner FAILURE is absence for the whole chunk, never an invented parse', async () => {
        const run: LocalCrfEngineRunner = async () => ({ ok: false, reason: 'python3: command not found' });

        // ADR-0026 §3: an engine that could not answer is ABSENCE, and the pipeline reads that as
        // `single-engine`. A local run on a machine with no Python must degrade to that, not to a
        // `ParsedLine` with empty fields and not to a crash.
        expect(await engineFor(run).parse(['2 cups flour', '1 egg'])).toEqual([
            { unavailable: true },
            { unavailable: true },
        ]);
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

        expect(await engineFor(run, '2.3.0').parse(['x'])).toEqual([{ unavailable: true }]);
    });

    describe('the pinned engine version', () => {
        it('is the BARE version, read from requirements.txt', () => {
            // ⛔ `handler.py` reports `importlib.metadata.version("ingredient-parser-nlp")` — a bare
            // `2.3.0` — while `requirements.txt` pins `ingredient-parser-nlp==2.3.0`. The pin is the source
            // of truth for WHICH version; the bare form is what the engine reports. Deriving it here keeps
            // one number in one place and still lets the adapter's check fail on a machine with the wrong
            // engine installed.
            expect(pinnedCrfEngineVersion()).toMatch(/^\d+\.\d+\.\d+$/u);
        });

        it('names the version requirements.txt actually pins', () => {
            expect(pinnedCrfEngineVersion({ requirements: 'ingredient-parser-nlp==4.5.6\n' })).toBe('4.5.6');
        });

        it('throws rather than guessing when the pin is gone', () => {
            expect(() => pinnedCrfEngineVersion({ requirements: 'ingredient-parser-nlp\n' })).toThrow(/pin/iu);
        });
    });
});
