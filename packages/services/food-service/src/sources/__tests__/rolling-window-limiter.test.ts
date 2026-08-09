/**
 * Unit tests for `sourceCapsFromEnv` — the per-source cap derivation behind {@link RollingWindowLimiter}
 * (`FOOD_SOURCE_RATE_LIMIT_PER_HOUR`, FR-019).
 *
 * This is the ONE knob standing between the fan-out and USDA's real quota: the hard cap the window never
 * records past, and the soft 90% threshold the worker pauses at. It was read with a hand-rolled
 * `Number(raw ?? DEFAULT_SOURCE_CAPS.usda.hardCap)` plus a local integer check, restating the default
 * `EnvironmentSchema` already owns; it now resolves through the ONE validated reader.
 *
 * `tests/rolling-window-limiter.integration.test.ts` and `tests/food-consumer.integration.test.ts` prove the
 * derived caps actually gate real recording; these pin the derivation itself.
 *
 * @implements FR-019
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EnvironmentSchema } from '../../config/env.schema.js';
import type { SourceCallLogDao } from '../../foods/dao/index.js';
import { RollingWindowLimiter, sourceCapsFromEnv } from '../rolling-window-limiter.js';

/** The `FOOD_SOURCE_RATE_LIMIT_PER_HOUR` default the boot-time schema applies — never a restated literal. */
const SCHEMA_DEFAULT_CAP = EnvironmentSchema.parse({
    STAGE: 'test',
    DATABASE_URL: 'postgresql://food_app:pw@localhost:5432/kitchensink_food',
    USDA_API_KEY: 'test-usda-key',
}).FOOD_SOURCE_RATE_LIMIT_PER_HOUR;

describe('sourceCapsFromEnv', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('falls back to the schema default cap when FOOD_SOURCE_RATE_LIMIT_PER_HOUR is unset', () => {
        vi.stubEnv('FOOD_SOURCE_RATE_LIMIT_PER_HOUR', undefined);

        expect(sourceCapsFromEnv().usda.hardCap).toBe(SCHEMA_DEFAULT_CAP);
    });

    it('derives BOTH the hard cap and the 90% pause threshold from the configured value', () => {
        vi.stubEnv('FOOD_SOURCE_RATE_LIMIT_PER_HOUR', '200');

        // The pause threshold must track the configured cap, not stay pinned to 90% of the default —
        // otherwise a preview that lowers the cap to observe the stall would pause at a value ABOVE it.
        expect(sourceCapsFromEnv().usda).toEqual({ hardCap: 200, pauseThreshold: 180 });
    });

    it('floors a fractional pause threshold so the soft pause never sits above the hard cap', () => {
        vi.stubEnv('FOOD_SOURCE_RATE_LIMIT_PER_HOUR', '15');

        expect(sourceCapsFromEnv().usda).toEqual({ hardCap: 15, pauseThreshold: 13 });
    });

    it.each(['lots', '', '0', '-1', '2.5', 'NaN', 'Infinity'])(
        'throws on the malformed cap %o rather than yielding NaN (which would never pause)',
        (value) => {
            vi.stubEnv('FOOD_SOURCE_RATE_LIMIT_PER_HOUR', value);

            expect(() => sourceCapsFromEnv()).toThrow(/FOOD_SOURCE_RATE_LIMIT_PER_HOUR/);
        },
    );
});

/**
 * The limiter resolves the configured caps ITSELF when a caller passes none. Before that, every composition
 * root had to remember `{ caps: sourceCapsFromEnv() }` — and the change-refresh task did not, so on a stage
 * whose operator had lowered the cap it kept charging USDA's SHARED quota at the built-in 1,000/hr and
 * pausing at 900. A forgotten argument must not be able to raise a rate limit.
 */
describe('RollingWindowLimiter — caps default to the configured value', () => {
    /** A call-log double reporting a fixed trailing-window count (the only seam `isPaused` uses). */
    function daoReporting(windowCount: number): SourceCallLogDao {
        return { countInWindow: (): Promise<number> => Promise.resolve(windowCount) } as unknown as SourceCallLogDao;
    }

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('honours FOOD_SOURCE_RATE_LIMIT_PER_HOUR when constructed with NO caps', () => {
        vi.stubEnv('FOOD_SOURCE_RATE_LIMIT_PER_HOUR', '15');

        expect(new RollingWindowLimiter(daoReporting(0)).capsFor('usda')).toEqual({
            hardCap: 15,
            pauseThreshold: 13,
        });
    });

    it('pauses at the CONFIGURED 90% mark — 13 recorded calls pause a cap of 15 but not the default', async () => {
        vi.stubEnv('FOOD_SOURCE_RATE_LIMIT_PER_HOUR', '15');
        await expect(new RollingWindowLimiter(daoReporting(13)).isPaused('usda')).resolves.toBe(true);

        // The same 13 calls are nowhere near the default cap's threshold — only the environment differs.
        vi.stubEnv('FOOD_SOURCE_RATE_LIMIT_PER_HOUR', undefined);
        await expect(new RollingWindowLimiter(daoReporting(13)).isPaused('usda')).resolves.toBe(false);
    });

    it('still lets an explicit caps override win (small caps for tests)', () => {
        vi.stubEnv('FOOD_SOURCE_RATE_LIMIT_PER_HOUR', '15');

        expect(
            new RollingWindowLimiter(daoReporting(0), { caps: { usda: { hardCap: 3, pauseThreshold: 2 } } }).capsFor(
                'usda',
            ),
        ).toEqual({ hardCap: 3, pauseThreshold: 2 });
    });

    it('refuses to construct at all on a malformed cap, rather than falling back to a built-in one', () => {
        vi.stubEnv('FOOD_SOURCE_RATE_LIMIT_PER_HOUR', 'lots');

        expect(() => new RollingWindowLimiter(daoReporting(0))).toThrow(/FOOD_SOURCE_RATE_LIMIT_PER_HOUR/);
    });
});
