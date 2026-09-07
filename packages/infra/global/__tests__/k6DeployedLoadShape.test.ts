/**
 * ⛔ THE DEPLOYED SHAPE MUST STAY UNDER THE SERVICE'S OWN PER-USER RATE LIMITS.
 *
 * ⚠️ MEASURED, run 34041143051 — the first authenticated deployed run. `searchLatency` reported
 * `http_req_failed 88.82%` with 434 of 3884 requests succeeding: the requests were fine, the RATE was not.
 * Fifty VUs at `sleep(1)` across a ten-user pool offers 300 req/min/user against a 60/min search limit, so
 * roughly four in five answers were 429 and every scenario failed on a limit rather than on a defect.
 *
 * The deleted runner-local jobs avoided this by cranking `RATE_LIMIT_*`, which
 * `recipe-service/tests/load/README.md` warns makes the result stop proving anything about the production
 * limits — and a deployed preview is not ours to reconfigure per run. So the shape goes under the limit
 * instead, exactly as `deployedOrigin.load.js` already does.
 *
 * ⛔ THE LIMITS ARE READ FROM THE SERVICE'S OWN SCHEMA, never restated here. A shape pinned against copied
 * numbers is a shape that silently drifts the day someone tunes a limit — and the failure mode is this run:
 * a red tier that looks like a service defect.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const read = (file: string): string => readFileSync(join(REPO_ROOT, file), 'utf8');

/**
 * The per-user, per-minute limits the recipe service defaults to.
 *
 * ⚠️ READ FROM `throttleDefaults.ts`, WHICH OWNS THEM. This used to parse `.default(120)` literals out of
 * `config.types.ts`, and it went blind the moment those literals became references to the shared record —
 * it matched nothing and reported zero limits. The non-vacuity assertion below is what caught that, which
 * is the whole reason it exists: a shape guard whose input silently becomes empty passes everything.
 */
function rateLimits(): Readonly<Record<string, number>> {
    const source = read('packages/services/recipe-service/src/common/throttle/throttleDefaults.ts');
    const limits: Record<string, number> = {};

    for (const m of source.matchAll(/RATE_LIMIT_(\w+):\s*(\d+),/gu)) {
        limits[m[1] ?? ''] = Number(m[2]);
    }

    return limits;
}

/** A numeric constant exported by the recipe load library. */
function constant(name: string): number {
    const source = read('packages/services/recipe-service/tests/load/lib/common.js');
    const match = new RegExp(`export const ${name} = ([^;]+);`, 'u').exec(source);

    if (!match) {
        throw new Error(`common.js exports no ${name} — this guard cannot read the shape`);
    }

    return Number(/(\d+)/u.exec(match[1] ?? '')?.[1]);
}

describe('the deployed k6 load shape', () => {
    const lib = (): string => read('packages/services/recipe-service/tests/load/lib/common.js');

    it('is not vacuous: the service declares limits and the library declares a pace', () => {
        expect(Object.keys(rateLimits()).length).toBeGreaterThan(0);
        expect(constant('DEPLOYED_PACE_SECONDS')).toBeGreaterThan(0);
    });

    it("⛔ treats the limiter's 429 as expected on a deployed stage, never as a service failure", () => {
        // The decisive invariant. A preview is not ours to reconfigure, so the run cannot avoid the limiter
        // by raising it and must not count its correct answer against the service. What still fails is what
        // a limiter cannot cause: a 5xx, a transport error, a malformed envelope.
        const source = lib();

        expect(source).toMatch(/setResponseCallback\(/u);
        expect(source).toMatch(/expectedStatuses\([^)]*429/u);
        expect(source, 'the allowance must be scoped to the deployed profile').toMatch(/LOAD_PROFILE !== 'substrate'/u);
    });

    it('⛔ pins the deployed peak to the pool size, so one VU backs one user', () => {
        // `UserThrottlerGuard` keys per USER. N VUs over a P-member pool concentrate N/P VUs on each user,
        // which is how 50 VUs offered 300 req/min/user against a 60/min search limit.
        expect(lib()).toMatch(/TOKEN_POOL\.length === 0 \? peak : TOKEN_POOL\.length/u);
    });

    it('⚠️ paces the deployed profile more slowly than the calibrated one', () => {
        expect(constant('DEPLOYED_PACE_SECONDS')).toBeGreaterThan(1);
    });
});
