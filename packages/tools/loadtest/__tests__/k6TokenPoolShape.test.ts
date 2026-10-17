/**
 * ⛔ THE POOL MUST PRODUCE THE SHAPE THE SCENARIOS READ — asserted by DERIVING what they read.
 *
 * Three `deployed-capable` scenarios open a Clerk token pool at INIT: food's `authFlood` and identity's
 * `sessionHotPath` and `authRejection`. Wiring them into CI without producing that file makes them die on
 * `GoError: stat …/clerk-tokens.json: no such file or directory` — which this repo has already paid for
 * once, and `identity/tests/load/lib/common.js` documents at length: four scripts died at init that way,
 * and the regression survived review because NO CI JOB RAN THE TIER.
 *
 * ⚠️ FOUND BY RUNNING k6, not by reading. `k6 inspect` on the wired set reported those three failing to
 * initialise while every other one resolved its options — the credential file my provisioner writes has a
 * different name, a different directory and a different SHAPE from the one they open.
 *
 * So the required keys are read out of the scenarios' own `TOKENS.<key>` accesses rather than restated
 * here. A scenario that starts reading `TOKENS.somethingNew` fails this guard on the day it lands, instead
 * of on the next deployed run.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { buildFoodTokenPool, buildIdentityTokenPool, deployedCapableScripts } from '@kitchensink/loadtest';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const read = (file: string): string => readFileSync(join(REPO_ROOT, file), 'utf8');

/** Every `TOKENS.<key>` an identity scenario reads, and every `TOKENS.reject.<key>`. */
function identityKeysRead(): { readonly top: readonly string[]; readonly reject: readonly string[] } {
    const sources = deployedCapableScripts()
        .filter((script) => script.includes('/identity/'))
        .map(read)
        .join('\n');

    return {
        top: [...new Set([...sources.matchAll(/TOKENS\.(\w+)/gu)].map((m) => m[1] ?? ''))].filter(
            (key) => key !== 'reject',
        ),
        reject: [...new Set([...sources.matchAll(/TOKENS\.reject\.(\w+)/gu)].map((m) => m[1] ?? ''))],
    };
}

const CREDENTIALS = ['tok-a', 'tok-b', 'tok-c'];
const REJECTS = { badSignature: 'bad', expired: 'exp', wrongAzp: 'azp', malformed: 'nope' };

describe('the k6 Clerk token pool', () => {
    it('is not vacuous: identity scenarios really do read a token pool', () => {
        const { top, reject } = identityKeysRead();

        expect(top.length + reject.length, 'no TOKENS.<key> access found — this guard has gone blind').toBeGreaterThan(
            0,
        );
    });

    it('⛔ supplies every top-level key the identity scenarios read', () => {
        // Read through `Object.entries` rather than an index cast: the pool's type is deliberately closed,
        // and casting it open to satisfy a test would hide the very drift this guard exists to catch.
        const supplied = new Map<string, unknown>(Object.entries(buildIdentityTokenPool(CREDENTIALS, REJECTS)));

        for (const key of identityKeysRead().top) {
            expect(supplied.has(key), `identity scenarios read TOKENS.${key}, which the pool does not supply`).toBe(
                true,
            );
        }
    });

    it('⛔ supplies every rejection token the identity scenarios read', () => {
        const supplied = new Map<string, unknown>(Object.entries(buildIdentityTokenPool(CREDENTIALS, REJECTS).reject));

        for (const key of identityKeysRead().reject) {
            expect(supplied.has(key), `authRejection reads TOKENS.reject.${key}, which the pool does not supply`).toBe(
                true,
            );
        }
    });

    it("⛔ supplies food's non-empty `users` array, which its loader validates at init", () => {
        // `loadTokens()` throws "holds no tokens — re-mint it" on an empty array, so an empty pool is a
        // failure the scenario reports rather than a run that measures an unauthenticated path.
        const pool = buildFoodTokenPool(CREDENTIALS);

        expect(Array.isArray(pool.users)).toBe(true);
        expect(pool.users.length).toBe(CREDENTIALS.length);
    });

    it('⚠️ refuses to build a pool from no credentials, rather than emitting an empty one', () => {
        expect(() => buildFoodTokenPool([])).toThrow(/no credentials/iu);
        expect(() => buildIdentityTokenPool([], REJECTS)).toThrow(/no credentials/iu);
    });
});
