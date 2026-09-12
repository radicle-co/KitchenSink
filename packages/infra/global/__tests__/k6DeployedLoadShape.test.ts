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
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const read = (file: string): string => readFileSync(join(REPO_ROOT, file), 'utf8');

/**
 * Deployed-capable recipe scenarios exempt from pacing through the library, each with the reason it paces itself.
 *
 * ⚠️ An entry here is a claim that the scenario's own cadence cannot exceed a per-user limit on a deployed stage.
 * `analyticsIngest`'s header records that its whole load is ONE user with the cap LIFTED — a substrate-only
 * premise, so on a deployed preview its 0.5s cadence is expected to meet the limiter. Kept rather than reshaped
 * because its header argues its own shape and nothing has measured it failing; it is the entry to re-argue first.
 */
const SELF_PACED: Readonly<Record<string, string>> = {
    'analyticsIngest.load.js': 'one dev-auth user with the per-user cap lifted — see the scenario header',
};

/** Every recipe load scenario that declares itself runnable against a deployed stage. */
function deployedRecipeScenarios(): readonly { readonly name: string; readonly source: string }[] {
    return execFileSync('git', ['ls-files', 'packages/services/recipe-service/tests/load/*.load.js'], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
    })
        .split('\n')
        .filter((file) => file !== '')
        .map((file) => ({ name: file.split('/').pop() ?? file, source: read(file) }))
        .filter(({ source }) => /@loadTier deployed-capable/u.test(source));
}

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

    it('⛔ every deployed-capable scenario paces through the library, never a literal sleep', () => {
        // The shape above holds only if every scenario actually USES the pace. `ingredientSuggestLatency`
        // slept a literal 0.3s — about 200 req/min/user against the per-user limit — so on the deployed tier
        // 861 of 2061 requests were 429s and exactly 1,200 succeeded on both runs: the budget, not a defect.
        // Nothing checked the scenarios, only the library's constants.
        const scenarios = deployedRecipeScenarios();

        expect(
            scenarios.length,
            'no deployed-capable scenarios found, so nothing below is checked',
        ).toBeGreaterThanOrEqual(5);

        const offenders = scenarios
            .filter(({ name }) => SELF_PACED[name] === undefined)
            .flatMap(({ name, source }) =>
                [...source.matchAll(/^\s*sleep\(([^)]*)\)/gmu)]
                    .map((match) => (match[1] ?? '').trim())
                    .filter((argument) => argument !== 'PACE_SECONDS' && !argument.startsWith('iterationPause('))
                    .map((argument) => `${name}: sleep(${argument})`),
            );

        expect(offenders).toEqual([]);
    });

    it('⛔ the library pause IS the deployed pace on a deployed stage', () => {
        // `iterationPause` exists so a scenario can keep its own cadence on the calibrated profile; on a
        // deployed one the per-user limit decides, whatever the scenario would prefer.
        expect(lib()).toMatch(/export function iterationPause\(substrateSeconds\)/u);
        expect(lib()).toMatch(/LOAD_PROFILE === 'substrate' \? substrateSeconds : DEPLOYED_PACE_SECONDS/u);
    });
});
