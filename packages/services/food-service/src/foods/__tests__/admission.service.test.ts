/**
 * Unit tests for {@link AdmissionService} — the FR-046 hard queue-depth ceiling and the FR-043b
 * near-ceiling flood-shed (T-199c).
 *
 * These assert the OBSERVABLE decision (`admit` resolves vs. throws `FetchUnavailableError`) as a function
 * of the CONFIGURED ceiling, not that the constructor merely stored a number. That distinction is the whole
 * point: `FOOD_MAX_QUEUE_DEPTH` was read with a bare `Number(process.env[...] ?? DEFAULT)`, so a malformed
 * value (`lots`) became `NaN`, every `depth >= NaN` comparison was `false`, and BOTH guards — the hard
 * ceiling and the near-ceiling shed — silently stopped firing: measured, `admit` RESOLVED at a reported depth
 * of 9,007,199,254,740,991 rows, with no error and no log. A happy-path test over the default would have
 * passed throughout.
 *
 * The NestJS API was shielded from that by luck of layering, not by design — `AppConfigModule`'s
 * `EnvironmentSchema` check rejects the value during module scanning, so the API fails to boot. The guard is
 * a SAFETY control, though, and it must not depend on another module's validation happening to run first:
 * every non-Nest composition root (this suite, the integration suite, the Fargate worker and the lambdas —
 * none of which validate the environment at all) got the `NaN`. `AdmissionService` now fails closed itself.
 *
 * Postgres is faked at the ONE seam the service uses (`db.execute`), keyed off the rendered SQL rather than
 * call order so a swapped query fails loudly instead of passing. The same guarantees are re-asserted over
 * real Postgres in `tests/admission.integration.test.ts`.
 *
 * @implements FR-046 FR-043b
 */
import { sql, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FoodDrizzle } from '../../database/database.module.js';
import { AdmissionService } from '../admission.service.js';
import { isFetchUnavailableError } from '../foods.errors.js';

/** Renders a Drizzle `SQL` fragment to text + params, exactly as the pg driver would. */
const dialect = new PgDialect();

/** The queue state the fake answers `AdmissionService`'s two counting queries from. */
interface QueueState {
    /** Active (`pending` + `in_flight`) row count in `fetch_queue`. */
    readonly depth: number;
    /** Pending rows attributed to each requester, by requester id (absent → 0). */
    readonly pendingByRequester?: Readonly<Record<string, number>>;
}

/**
 * A fake {@link FoodDrizzle} that answers only the two aggregate reads `admit` performs, dispatching on the
 * rendered SQL (the requester query is the one that joins `fetch_requesters`). An unrecognised query throws
 * so a future read cannot be silently answered with a stale count.
 *
 * @param state - The queue contents to report.
 * @returns The fake client plus the rendered SQL of every query it received, in order.
 */
function makeDb(state: QueueState): { db: FoodDrizzle; queries: string[] } {
    const queries: string[] = [];

    const execute = (query: SQL): Promise<{ rows: { n: number }[] }> => {
        const { sql: text, params } = dialect.sqlToQuery(query);
        queries.push(text);

        if (text.includes('fetch_requesters')) {
            const requesterId = String(params[0]);

            return Promise.resolve({ rows: [{ n: state.pendingByRequester?.[requesterId] ?? 0 }] });
        }

        if (text.includes('fetch_queue')) {
            return Promise.resolve({ rows: [{ n: state.depth }] });
        }

        return Promise.reject(new Error(`unexpected query in AdmissionService: ${text}`));
    };

    return { db: { execute } as unknown as FoodDrizzle, queries };
}

/** Run `admit` and return the rejection reason, or `undefined` when it was admitted. */
async function admissionFailure(service: AdmissionService, requesterId: string): Promise<unknown> {
    return service.admit(requesterId).then(
        () => undefined,
        (caught: unknown) => caught,
    );
}

describe('AdmissionService — hard queue-depth ceiling (FR-046)', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('fails closed with 503 + a positive jittered Retry-After AT the configured ceiling', async () => {
        vi.stubEnv('FOOD_MAX_QUEUE_DEPTH', '10');
        const { db } = makeDb({ depth: 10 });

        const failure = await admissionFailure(new AdmissionService(db), 'anyone');

        expect(isFetchUnavailableError(failure)).toBe(true);

        if (isFetchUnavailableError(failure)) {
            expect(failure.retryAfterSeconds).toBeGreaterThan(0);
            expect(failure.message).toContain('capacity');
        }
    });

    it('admits one row BELOW the configured ceiling — the boundary is `>=`, not `>`', async () => {
        // Depth 9 of a ceiling of 10 also sits at 90%, so the near-ceiling shed runs; this requester is
        // light (0 pending), which isolates the hard-ceiling boundary from the shed.
        vi.stubEnv('FOOD_MAX_QUEUE_DEPTH', '10');
        const { db } = makeDb({ depth: 9 });

        await expect(new AdmissionService(db).admit('anyone')).resolves.toBeUndefined();
    });

    it('moves the ceiling when the operator tunes FOOD_MAX_QUEUE_DEPTH — same depth, opposite verdict', async () => {
        // The ONLY difference between these two admissions is the environment. A ceiling that ignored the
        // variable (or degraded it to `NaN`) would answer identically both times.
        const shedState: QueueState = { depth: 10, pendingByRequester: { anyone: 0 } };

        vi.stubEnv('FOOD_MAX_QUEUE_DEPTH', '10');
        expect(
            isFetchUnavailableError(await admissionFailure(new AdmissionService(makeDb(shedState).db), 'anyone')),
        ).toBe(true);

        vi.stubEnv('FOOD_MAX_QUEUE_DEPTH', '100');
        await expect(new AdmissionService(makeDb(shedState).db).admit('anyone')).resolves.toBeUndefined();
    });

    it('defaults to a 10,000-row ceiling when FOOD_MAX_QUEUE_DEPTH is unset', async () => {
        vi.stubEnv('FOOD_MAX_QUEUE_DEPTH', undefined);

        const atCeiling = await admissionFailure(new AdmissionService(makeDb({ depth: 10_000 }).db), 'anyone');
        expect(isFetchUnavailableError(atCeiling)).toBe(true);

        // Well below the ceiling nobody is shed and the requester query is never even reached.
        const { db, queries } = makeDb({ depth: 8_999 });
        await expect(new AdmissionService(db).admit('anyone')).resolves.toBeUndefined();
        expect(queries).toHaveLength(1);
    });

    /**
     * The defect this suite exists for. `Number('lots')` is `NaN`, and EVERY comparison against `NaN` is
     * `false` — so a malformed ceiling did not fail loudly, it removed the ceiling. Failing at construction
     * is the only honest behaviour: the process that cannot know its own limit must not serve.
     */
    it.each(['lots', '', '0', '-1', '2.5', 'NaN', 'Infinity'])(
        'throws at construction on the malformed ceiling %o rather than degrading to an absent ceiling',
        (value) => {
            vi.stubEnv('FOOD_MAX_QUEUE_DEPTH', value);
            const { db } = makeDb({ depth: Number.MAX_SAFE_INTEGER });

            expect(() => new AdmissionService(db)).toThrow(/FOOD_MAX_QUEUE_DEPTH/);
        },
    );
});

describe('AdmissionService — near-ceiling flood-shed (FR-043b)', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('sheds a flooding requester at 90% of the CONFIGURED ceiling while a lighter one is admitted', async () => {
        vi.stubEnv('FOOD_MAX_QUEUE_DEPTH', '100');
        vi.stubEnv('FOOD_DEMOTE_THRESHOLD', '3');
        const state: QueueState = { depth: 90, pendingByRequester: { flooder: 4, light: 1 } };

        expect(isFetchUnavailableError(await admissionFailure(new AdmissionService(makeDb(state).db), 'flooder'))).toBe(
            true,
        );
        await expect(new AdmissionService(makeDb(state).db).admit('light')).resolves.toBeUndefined();
    });

    it('does NOT shed just below the near-ceiling fraction — the flooder is admitted at 89% of 100', async () => {
        vi.stubEnv('FOOD_MAX_QUEUE_DEPTH', '100');
        vi.stubEnv('FOOD_DEMOTE_THRESHOLD', '3');
        const { db, queries } = makeDb({ depth: 89, pendingByRequester: { flooder: 400 } });

        await expect(new AdmissionService(db).admit('flooder')).resolves.toBeUndefined();
        // Short-circuited before the requester read — the fraction, not the flooder, decided.
        expect(queries).toHaveLength(1);
    });

    it('scales the shed threshold with the ceiling — 90 rows sheds under a ceiling of 100, not of 1,000', async () => {
        const state: QueueState = { depth: 90, pendingByRequester: { flooder: 400 } };
        vi.stubEnv('FOOD_DEMOTE_THRESHOLD', '3');

        vi.stubEnv('FOOD_MAX_QUEUE_DEPTH', '100');
        expect(isFetchUnavailableError(await admissionFailure(new AdmissionService(makeDb(state).db), 'flooder'))).toBe(
            true,
        );

        vi.stubEnv('FOOD_MAX_QUEUE_DEPTH', '1000');
        await expect(new AdmissionService(makeDb(state).db).admit('flooder')).resolves.toBeUndefined();
    });

    /**
     * The shed's OTHER number, and the mutation lens caught this gap: restoring the original
     * `Number(process.env['FOOD_DEMOTE_THRESHOLD'] ?? 50)` here survived the whole suite, because every
     * threshold case above uses a VALID value. A malformed one is the same defect as the ceiling's —
     * `pending > NaN` is `false`, so the flood-shed silently stops shedding while the service keeps
     * reporting a healthy queue.
     */
    it.each(['fifty', '', '0', '-1', '2.5', 'NaN', 'Infinity'])(
        'throws at construction on the malformed threshold %o rather than disabling the shed',
        (value) => {
            vi.stubEnv('FOOD_MAX_QUEUE_DEPTH', '100');
            vi.stubEnv('FOOD_DEMOTE_THRESHOLD', value);
            const { db } = makeDb({ depth: 95, pendingByRequester: { flooder: 10_000 } });

            expect(() => new AdmissionService(db)).toThrow(/FOOD_DEMOTE_THRESHOLD/);
        },
    );

    it('sheds strictly ABOVE the demote threshold — a requester holding exactly `threshold` is admitted', async () => {
        vi.stubEnv('FOOD_MAX_QUEUE_DEPTH', '100');
        vi.stubEnv('FOOD_DEMOTE_THRESHOLD', '4');
        const state: QueueState = { depth: 95, pendingByRequester: { edge: 4 } };

        await expect(new AdmissionService(makeDb(state).db).admit('edge')).resolves.toBeUndefined();

        vi.stubEnv('FOOD_DEMOTE_THRESHOLD', '3');
        expect(isFetchUnavailableError(await admissionFailure(new AdmissionService(makeDb(state).db), 'edge'))).toBe(
            true,
        );
    });
});

describe('AdmissionService — the queries it issues', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('counts BOTH pending and in_flight rows as depth, and only pending rows as requester demand', async () => {
        vi.stubEnv('FOOD_MAX_QUEUE_DEPTH', '100');
        vi.stubEnv('FOOD_DEMOTE_THRESHOLD', '3');
        const { db, queries } = makeDb({ depth: 95, pendingByRequester: { flooder: 400 } });

        await admissionFailure(new AdmissionService(db), 'flooder');

        expect(queries).toHaveLength(2);
        // Depth is the cross-process signal the worker also sees: in_flight rows still occupy the queue.
        expect(queries[0]).toContain("status IN ('pending', 'in_flight')");
        // Shed demand is pending-only — an in_flight row is already being drained, not waiting.
        expect(queries[1]).toContain("q.status = 'pending'");
        expect(queries[1]).not.toContain('in_flight');
    });

    it('never reads a requester when the hard ceiling already rejected the enqueue', async () => {
        vi.stubEnv('FOOD_MAX_QUEUE_DEPTH', '10');
        const { db, queries } = makeDb({ depth: 10 });

        await admissionFailure(new AdmissionService(db), 'anyone');

        expect(queries).toHaveLength(1);
    });
});

/** Guards the fake itself: a silently-mis-shaped stub would make every assertion above meaningless. */
describe('the AdmissionService test double', () => {
    it('answers the real service`s queries and nothing else', async () => {
        const { db } = makeDb({ depth: 3 });

        await expect(
            (db as unknown as { execute: (q: SQL) => Promise<unknown> }).execute(sql`SELECT 1`),
        ).rejects.toThrow(/unexpected query/);
    });
});
