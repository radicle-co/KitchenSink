/**
 * Integration guarantee for the enqueue backpressure + near-ceiling flood-shed (T-052/T-144,
 * FR-046/FR-043b) over REAL Postgres. {@link AdmissionService} gates NEW enqueues ONLY:
 *
 * - At the hard `fetch_queue` depth ceiling → fail closed with `503` (`FetchUnavailableError`) + a
 *   jittered `Retry-After` (recovery never retries in lockstep). NEVER a per-`sub` `429`.
 * - Near the ceiling → a flooding `sub` (pending count over the demote threshold) is shed FIRST with
 *   `503` while a lighter `sub` is still admitted. Reads / `PATCH`-resolves never pass through admission
 *   and are therefore never shed (structural — the service only calls `admit` on a fresh enqueue).
 *
 * The cross-process per-source circuit-breaker signal of FR-046 (open breaker → `503`) is a documented
 * follow-up (see {@link AdmissionService}) — the durable depth + flood-shed signals are covered here.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type pg from 'pg';

import { AdmissionService } from '../src/foods/admission.service.js';
import { FetchQueueDao } from '../src/foods/dao/fetchQueue.dao.js';
import { FetchRequestersDao } from '../src/foods/dao/fetchRequesters.dao.js';
import { FoodDao } from '../src/foods/dao/food.dao.js';
import { isFetchUnavailableError } from '../src/foods/foods.errors.js';
import { DATABASE_URL, makeDb, makePool, resetSchema, type TestDb } from './support/db.js';

describe.skipIf(!DATABASE_URL)('AdmissionService backpressure + flood-shed (integration, FR-046/FR-043b)', () => {
    let pool: pg.Pool;
    let db: TestDb;
    let foodDao: FoodDao;
    let queue: FetchQueueDao;
    let requesters: FetchRequestersDao;
    let admission: AdmissionService;

    beforeAll(() => {
        // Small ceiling/threshold so the fixtures stay tiny; read at AdmissionService construction.
        process.env['FOOD_MAX_QUEUE_DEPTH'] = '10';
        process.env['FOOD_DEMOTE_THRESHOLD'] = '3';
        pool = makePool();
        db = makeDb(pool);
        foodDao = new FoodDao(db);
        queue = new FetchQueueDao(db);
        requesters = new FetchRequestersDao(db);
        admission = new AdmissionService(db);
    });

    afterAll(async () => {
        await pool?.end();
    });

    beforeEach(async () => {
        await resetSchema(pool);
    });

    /** Create a PENDING food + pending queue row attributed to `requesterId`. */
    async function seedPending(name: string, requesterId: string): Promise<string> {
        const { id } = await foodDao.createByName({ normalizedName: name, displayName: name });
        await requesters.add({ foodId: id, requesterId });
        await queue.enqueue(id);

        return id;
    }

    it('fails closed with 503 + jittered Retry-After at the depth ceiling (never a 429)', async () => {
        for (let i = 0; i < 10; i += 1) {
            await seedPending(`ceiling ${i}`, 'someone');
        }

        const error = await admission.admit('anyone').then(
            () => undefined,
            (caught: unknown) => caught,
        );

        expect(isFetchUnavailableError(error)).toBe(true);

        if (isFetchUnavailableError(error)) {
            expect(error.retryAfterSeconds).toBeGreaterThan(0); // jittered, positive
            expect(error.name).not.toContain('429');
        }
    });

    it('near the ceiling sheds a flooding sub`s NEW enqueue with 503 while a lighter sub is admitted', async () => {
        // Depth 9 (>= 90% of 10) engages near-ceiling shedding. The flooder owns 4 pending (> threshold 3).
        for (let i = 0; i < 4; i += 1) {
            await seedPending(`flooder ${i}`, 'flooder');
        }

        for (let i = 0; i < 5; i += 1) {
            await seedPending(`other ${i}`, `light_${i}`);
        }

        // The flooder's NEW enqueue is shed first.
        const shed = await admission.admit('flooder').then(
            () => undefined,
            (caught: unknown) => caught,
        );
        expect(isFetchUnavailableError(shed)).toBe(true);

        // A lighter sub (1 pending) is still admitted near the ceiling — not shed.
        await expect(admission.admit('light_0')).resolves.toBeUndefined();
    });

    it('admits freely well below the ceiling regardless of sub', async () => {
        await seedPending('lonely', 'flooder');

        await expect(admission.admit('flooder')).resolves.toBeUndefined();
    });

    /**
     * T-199(c) — the ceiling is CONFIGURED, and it is the ONLY thing standing between a flood of enqueues and
     * an unbounded `fetch_queue`. `AdmissionService` read `FOOD_MAX_QUEUE_DEPTH` with a bare
     * `Number(process.env[...] ?? 10_000)`, so a malformed value became `NaN`; every `depth >= NaN` and
     * `depth >= NaN * 0.9` comparison was `false`, and BOTH the hard `503` backstop and the near-ceiling
     * flood-shed silently stopped firing (measured: `admit` resolved at a reported depth of 9,007,199,254,740,991).
     * The API's boot-time `EnvironmentSchema` check happened to reject such a value first, but a safety control
     * must fail closed on its own — every composition root outside the Nest injector, THIS SUITE INCLUDED, got
     * the `NaN`. The unit suite pins the fail-fast; these cases pin the OBSERVABLE consequence over real
     * Postgres — the same rows, counted by the same SQL, admitted or shed purely because the knob was retuned.
     */
    describe('configured queue-depth ceiling (T-199c, FR-046/FR-043b)', () => {
        afterEach(() => {
            vi.unstubAllEnvs();
        });

        it('honours FOOD_MAX_QUEUE_DEPTH from the environment — a tuned ceiling flips the verdict', async () => {
            for (let i = 0; i < 5; i += 1) {
                await seedPending(`row ${i}`, `light_${i}`);
            }

            // Ceiling 5 with 5 active rows: at capacity, so a NEW enqueue fails closed — even for a sub
            // holding a single pending row, because the hard ceiling is not a per-`sub` quota (D-FAIRNESS).
            vi.stubEnv('FOOD_MAX_QUEUE_DEPTH', '5');
            const shed = await new AdmissionService(db).admit('light_0').then(
                () => undefined,
                (caught: unknown) => caught,
            );
            expect(isFetchUnavailableError(shed)).toBe(true);

            // Same five rows, ceiling raised to 50: comfortably below both the ceiling and its 90% mark, so
            // the identical enqueue is admitted. The ONLY difference is the environment.
            vi.stubEnv('FOOD_MAX_QUEUE_DEPTH', '50');
            await expect(new AdmissionService(db).admit('light_0')).resolves.toBeUndefined();
        });

        it('scales the near-ceiling flood-shed with the configured ceiling, not with a fixed row count', async () => {
            // A flooder owning 4 pending rows (> threshold 3) plus 5 light rows → depth 9.
            for (let i = 0; i < 4; i += 1) {
                await seedPending(`flood ${i}`, 'flooder');
            }

            for (let i = 0; i < 5; i += 1) {
                await seedPending(`calm ${i}`, `calm_${i}`);
            }

            // Ceiling 10 → depth 9 is at 90%, the shed engages and the flooder is rejected.
            vi.stubEnv('FOOD_MAX_QUEUE_DEPTH', '10');
            const shed = await new AdmissionService(db).admit('flooder').then(
                () => undefined,
                (caught: unknown) => caught,
            );
            expect(isFetchUnavailableError(shed)).toBe(true);

            // Ceiling 100 → the same depth 9 is nowhere near 90, so the same flooder is admitted. A shed
            // that engaged on an absolute row count (or on a dead `NaN` ceiling) could not tell these apart.
            vi.stubEnv('FOOD_MAX_QUEUE_DEPTH', '100');
            await expect(new AdmissionService(db).admit('flooder')).resolves.toBeUndefined();
        });
    });
});
