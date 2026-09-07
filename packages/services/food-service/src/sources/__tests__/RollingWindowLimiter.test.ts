/**
 * Unit tests for `sourceCapsFromEnv` — the per-source cap derivation behind {@link RollingWindowLimiter}
 * (`FOOD_SOURCE_RATE_LIMIT_PER_HOUR`, FR-019).
 *
 * This is the ONE knob standing between the fan-out and USDA's real quota: the hard cap the window never
 * records past, and the soft 90% threshold the worker pauses at. It was read with a hand-rolled
 * `Number(raw ?? DEFAULT_SOURCE_CAPS.usda.hardCap)` plus a local integer check, restating the default
 * `EnvironmentSchema` already owns; it now resolves through the ONE validated reader.
 *
 * `tests/RollingWindowLimiter.integration.test.ts` and `tests/foodConsumer.integration.test.ts` prove the
 * derived caps actually gate real recording; these pin the derivation itself.
 *
 * @implements FR-019
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EnvironmentSchema } from '../../config/env.schema.js';
import type {
    CheckAndRecordInput,
    SourceCallChannel,
    SourceCallLogDao,
    WindowCheckResult,
} from '../../foods/dao/index.js';
import type { FoodSourceId } from '../foodSourceAdapter.js';
import { RollingWindowLimiter, sourceCapsFromEnv } from '../RollingWindowLimiter.js';

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

/**
 * F-W1 (plan U29) — the two-lane split that makes FR-019's reserved interactive headroom ENFORCED rather
 * than merely advisory.
 *
 * Before this, `tryRecord` charged EVERY caller against `hardCap` and the 90% reserve existed only because
 * the worker voluntarily consulted `isPaused` first — once, per drain cycle, not per call. A fan-out that
 * passed the pause check at 899 could then charge twenty `fetchByKeys` and land the window at 919, eating
 * the very headroom a waiting human's search depends on. The reserve is now the worker's own admission cap.
 *
 * ⛔ **The two lanes are NOT two budgets.** USDA rate-limits our egress IP, so both lanes spend the SAME
 * 1,000/hr. What differs is the ceiling each may push the SHARED count to: the worker stops at the 90%
 * threshold, the interactive lane may use the whole cap. That is what guarantees ≥10% for user-facing
 * search under arbitrary worker behaviour, while keeping the aggregate at or under USDA's real limit
 * (SC-002).
 *
 * These cases drive a call-log double that ACTUALLY IMPLEMENTS the windowed count-and-record — the cap
 * comparison and the insert both really happen — so an assertion here fails for the same reason the real
 * DAO would. A stub returning `{ allowed: true }` would prove only that the limiter forwards its arguments.
 */
describe('RollingWindowLimiter — interactive vs worker lanes (F-W1, FR-019)', () => {
    /**
     * An in-memory `source_call_log`: a real ledger with the real admission rule (count the source's rows
     * across BOTH lanes, insert iff strictly under the caller's cap), so what is asserted below is the
     * limiter's own arithmetic, not a canned answer.
     */
    function ledgerDao(seed: readonly SourceCallChannel[] = []): SourceCallLogDao & {
        readonly rows: SourceCallChannel[];
    } {
        const rows: SourceCallChannel[] = [...seed];

        const ledger = {
            rows,
            checkAndRecord: ({ channel, cap }: CheckAndRecordInput): Promise<WindowCheckResult> => {
                // The count is over the whole window — every lane's rows — because the quota is the key's.
                const allowed = rows.length < cap;

                if (allowed) {
                    rows.push(channel);
                }

                return Promise.resolve({ allowed, windowCount: rows.length });
            },
            countInWindow: (_source: FoodSourceId, channel?: SourceCallChannel): Promise<number> =>
                Promise.resolve(channel === undefined ? rows.length : rows.filter((row) => row === channel).length),
        };

        return ledger as unknown as SourceCallLogDao & { readonly rows: SourceCallChannel[] };
    }

    /** Caps small enough to read: hard 10, pause (and therefore the worker's ceiling) 9, reserve 1. */
    const caps = { usda: { hardCap: 10, pauseThreshold: 9 } } as const;

    it('charges the lane the caller names, so the ledger can attribute the window', async () => {
        const dao = ledgerDao();
        const limiter = new RollingWindowLimiter(dao, { caps });

        await limiter.tryRecord('usda', 'interactive');
        await limiter.tryRecord('usda', 'worker');

        expect(dao.rows).toEqual(['interactive', 'worker']);
    });

    it('lets the interactive lane spend the reserve the worker may NOT touch', async () => {
        // The window sits exactly at the 90% pause threshold, filled entirely by the drain.
        const dao = ledgerDao(Array.from({ length: 9 }, () => 'worker' as const));
        const limiter = new RollingWindowLimiter(dao, { caps });

        // ⛔ THE mutation this whole unit exists to catch: charging the drain's budget instead of the
        // interactive lane makes a waiting human's search fail here, with a tenth of the key unspent.
        await expect(limiter.tryRecord('usda', 'interactive')).resolves.toMatchObject({ allowed: true });
        expect(dao.rows.filter((row) => row === 'interactive')).toHaveLength(1);
    });

    it('stops the WORKER at the 90% threshold, so the reserve cannot be drained away', async () => {
        const dao = ledgerDao(Array.from({ length: 9 }, () => 'worker' as const));

        await expect(new RollingWindowLimiter(dao, { caps }).tryRecord('usda', 'worker')).resolves.toMatchObject({
            allowed: false,
        });
        expect(dao.rows).toHaveLength(9);
    });

    it('stops the INTERACTIVE lane at the hard cap — the reserve is a floor, never an exemption (SC-002)', async () => {
        const dao = ledgerDao(Array.from({ length: 10 }, () => 'interactive' as const));

        await expect(new RollingWindowLimiter(dao, { caps }).tryRecord('usda', 'interactive')).resolves.toMatchObject({
            allowed: false,
        });
        expect(dao.rows).toHaveLength(10);
    });

    it('counts the OTHER lane against the worker too — one shared quota, not two budgets', async () => {
        // Nine INTERACTIVE calls, not worker ones: the drain is still at its ceiling, because the count
        // that gates it is the window's, not its own lane's.
        const dao = ledgerDao(Array.from({ length: 9 }, () => 'interactive' as const));

        await expect(new RollingWindowLimiter(dao, { caps }).tryRecord('usda', 'worker')).resolves.toMatchObject({
            allowed: false,
        });
    });

    it('denies BOTH lanes while the 429 failsafe is active — a refusing source refuses everyone', async () => {
        const dao = ledgerDao();
        const limiter = new RollingWindowLimiter(dao, { caps, backoffMs: 60_000, now: () => 1_000 });

        limiter.markWindowFull('usda');

        await expect(limiter.tryRecord('usda', 'interactive')).resolves.toMatchObject({ allowed: false });
        await expect(limiter.tryRecord('usda', 'worker')).resolves.toMatchObject({ allowed: false });
        expect(dao.rows).toHaveLength(0);
    });
});
