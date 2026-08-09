/**
 * Unit tests for the CDK app's synth-time environment contract (`infra/lib/synth-env.ts`).
 *
 * `infra/bin/app.ts` read all three of these with a bare `Number(process.env[...] ?? DEFAULT)`, and a
 * synth-time `NaN` is the worst place in this system for one: it does not fail, it lands in a CloudFormation
 * template. `JSON.stringify(NaN)` is `null`, so a typo'd `FOOD_DESIRED_COUNT` deploys a service with no
 * meaningful desired count instead of refusing to synth — and `Number('')` is `0`, so an unset CI variable
 * interpolated into the env (`FOOD_DESIRED_COUNT: ${{ vars.… }}`) would silently deploy ZERO API tasks,
 * which is an outage behind a green deploy.
 *
 * `'0'` must stay VALID: `.github/workflows/sandbox-deploy.yml` deploys per-PR previews in two passes and
 * relies on pass 1 provisioning at scale zero (the per-PR database does not exist yet, so booting tasks
 * would crash-loop and trip the ECS deployment circuit breaker). That contract had no test until now.
 *
 * These settings live HERE rather than in `src/config/env.schema.ts` because they are consumed ONLY by the
 * CDK app: neither is ever placed in a container's environment, so neither is part of the running service's
 * env contract. `FOOD_UNRESOLVED_TTL_DAYS` is the reverse — it IS a runtime setting (`config/env.schema.ts`
 * owns its rule and default), so it is read here as an OPTIONAL pass-through: absent means "do not stamp it
 * into the task definition", which keeps the template diff-free and lets the app apply its own default.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { synthEnv } from '../lib/synth-env.js';

describe('synthEnv — Fargate task counts', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('defaults to two API tasks and one worker task when neither variable is set', () => {
        vi.stubEnv('FOOD_DESIRED_COUNT', undefined);
        vi.stubEnv('FOOD_WORKER_DESIRED_COUNT', undefined);

        expect(synthEnv()).toMatchObject({ desiredCount: 2, workerDesiredCount: 1 });
    });

    it('honours the configured counts (env vars arrive as strings)', () => {
        vi.stubEnv('FOOD_DESIRED_COUNT', '1');
        vi.stubEnv('FOOD_WORKER_DESIRED_COUNT', '3');

        expect(synthEnv()).toMatchObject({ desiredCount: 1, workerDesiredCount: 3 });
    });

    it('accepts ZERO for both counts — the per-PR "provision at scale zero" first pass depends on it', () => {
        vi.stubEnv('FOOD_DESIRED_COUNT', '0');
        vi.stubEnv('FOOD_WORKER_DESIRED_COUNT', '0');

        expect(synthEnv()).toMatchObject({ desiredCount: 0, workerDesiredCount: 0 });
    });

    it.each(['two', '', '-1', '1.5', 'NaN', 'Infinity'])(
        'refuses to synth on the malformed FOOD_DESIRED_COUNT %o rather than emitting it into a template',
        (value) => {
            vi.stubEnv('FOOD_DESIRED_COUNT', value);

            expect(() => synthEnv()).toThrow(/FOOD_DESIRED_COUNT/);
        },
    );

    it.each(['one', '', '-1', '1.5', 'NaN', 'Infinity'])(
        'refuses to synth on the malformed FOOD_WORKER_DESIRED_COUNT %o',
        (value) => {
            vi.stubEnv('FOOD_WORKER_DESIRED_COUNT', value);

            expect(() => synthEnv()).toThrow(/FOOD_WORKER_DESIRED_COUNT/);
        },
    );
});

describe('synthEnv — the change-refresh TTL pass-through', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('is undefined when unset, so the task definition carries no FOOD_UNRESOLVED_TTL_DAYS at all', () => {
        vi.stubEnv('FOOD_UNRESOLVED_TTL_DAYS', undefined);

        expect(synthEnv().unresolvedTtlDays).toBeUndefined();
    });

    it('passes a configured TTL through for the change-refresh task', () => {
        vi.stubEnv('FOOD_UNRESOLVED_TTL_DAYS', '60');

        expect(synthEnv().unresolvedTtlDays).toBe(60);
    });

    it.each(['thirty', '', '0', '-1', '2.5', 'NaN', 'Infinity'])(
        'refuses to synth on the malformed TTL %o rather than deploying a task that dies on its first run',
        (value) => {
            vi.stubEnv('FOOD_UNRESOLVED_TTL_DAYS', value);

            expect(() => synthEnv()).toThrow(/FOOD_UNRESOLVED_TTL_DAYS/);
        },
    );
});
