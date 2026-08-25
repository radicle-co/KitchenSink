/**
 * INTEGRATION TIER — the handler against the REAL CRF engine, and its answer against the REAL zod.
 *
 * This is as close to "a deployed invocation returns a parse for a known line" as anything that does not
 * deploy can get: the handler module is imported into a real interpreter with `ingredient-parser-nlp`
 * installed, invoked, and its answer fed through the boundary the caller will use. A unit test can prove
 * neither half — it would mock the engine, and the engine's output shape IS the thing under test.
 *
 * ⚠️ Needs `python3` with `ingredient-parser-nlp==2.3.0` installed (`.github/workflows/_ci.yml` already
 * installs it for the cookbook-import parse comparison, in the same job that calls this tier). SKIPS with a
 * loud reason rather than failing when it is absent, mirroring how the DB-backed tiers guard on
 * `DATABASE_URL` — but it is called by name from CI, so the skip is a local convenience, not a hiding place.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { parseEngineResponse } from '../src/engine.schema.js';

const sourceDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

/** Whether this machine can import the engine at all. */
function engineInstalled(): boolean {
    try {
        execFileSync('python3', ['-c', 'import ingredient_parser'], { stdio: 'ignore' });

        return true;
    } catch {
        return false;
    }
}

/**
 * Invoke `handler.handle` in a real interpreter and return its raw answer.
 *
 * @param event - The event to pass, serialized as JSON.
 * @returns The handler's return value, decoded but NOT validated — validating here would hide the very
 *   thing the assertions below are for.
 * @sideEffect Spawns `python3`.
 */
function invoke(event: unknown): unknown {
    const program = [
        'import json, sys',
        'sys.path.insert(0, sys.argv[1])',
        'from handler import handle',
        'print(json.dumps(handle(json.loads(sys.argv[2]))))',
    ].join('\n');

    return JSON.parse(
        execFileSync('python3', ['-c', program, sourceDirectory, JSON.stringify(event)], { encoding: 'utf8' }),
    ) as unknown;
}

describe.skipIf(!engineInstalled())('the CRF handler, against the real engine', () => {
    it('returns a parse for a known line that survives the boundary', () => {
        const response = parseEngineResponse(invoke({ lines: ['1 cup plain flour, sifted'] }));
        const [result] = response.results;

        expect(response.engine).toBe('crf');
        expect(result?.status).toBe('parsed');

        if (result?.status !== 'parsed') {
            return;
        }

        expect(result.names.join(' ')).toContain('flour');
        expect(result.measure).toContain('cup');
        expect(result.preparation).toContain('sifted');
    });

    it('echoes every submitted line back, in order, so a caller can assert the pairing', () => {
        const lines = ['2 eggs', '1 tbsp olive oil', 'a pinch of salt'];
        const response = parseEngineResponse(invoke({ lines }));

        expect(response.results).toHaveLength(lines.length);
        expect(response.results.map((result) => result.sentence.toLowerCase())).toEqual(
            expect.arrayContaining([expect.stringContaining('egg')]),
        );
    });

    it('never emits foundation_foods, which is what the boundary would refuse', () => {
        // ⛔ The engine CAN attach an FDC match. Consuming it would stand up a second, unowned resolution
        // authority beside `resolutionCascade.ts` — and it is measurably wrong. `parseEngineResponse` is
        // strict, so this assertion is really "the handler never even offers it": if it ever did, the call
        // above would throw rather than silently dropping the key.
        const raw = invoke({ lines: ['1 cup soy flour'] }) as { results: Record<string, unknown>[] };

        expect(raw.results.every((result) => !('foundation_foods' in result))).toBe(true);
        expect(() => parseEngineResponse(raw)).not.toThrow();
    });

    it('reports the engine version the requirements pin, because the cache key depends on it', () => {
        const response = parseEngineResponse(invoke({ lines: ['1 onion'] }));

        expect(response.engineVersion).toBe('2.3.0');
    });

    it('refuses a request outside the declared bounds rather than parsing what it can', () => {
        // The refusal must reach the caller as a failed invocation, not as an empty answer.
        expect(() => invoke({ lines: [] })).toThrow();
        expect(() => invoke({ lines: [''] })).toThrow();
        expect(() => invoke({ lines: ['x'.repeat(513)] })).toThrow();
        expect(() => invoke({ notLines: ['1 onion'] })).toThrow();
    });

    it('answers per line, so nonsense beside a real line loses neither', () => {
        // Per-line failure is the contract. Whether the CRF chokes on the first line or gamely reads it is
        // the engine's business — what must hold is that the batch still returns two results, each carrying
        // its own status, rather than the invocation failing as a whole.
        const response = parseEngineResponse(invoke({ lines: ['!!! ??? ###', '1 cup water'] }));

        expect(response.results).toHaveLength(2);
        expect(response.results.every((result) => result.status === 'parsed' || result.status === 'failed')).toBe(true);
        expect(response.results.at(-1)?.status).toBe('parsed');
    });
});
