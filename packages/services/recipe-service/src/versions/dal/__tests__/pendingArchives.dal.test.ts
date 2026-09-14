/**
 * T130-test — unit tests for {@link PendingArchivesDal}, the FR-007b-i S3-archive outbox.
 *
 * Written BEFORE the DAL (TDD red → green). This table is an **outbox**, not a cache: the pending row
 * (plus the `recipe_versions` row it points at) IS the durable record of "this snapshot still owes S3 a
 * write". FR-007b-i turns on that durability — *"the full version payload MUST be persisted locally so
 * retries can replay the exact failed payload"*, and *"pending-archive records MUST only be deleted
 * after a successful S3 confirmation"*.
 *
 * The invariant the shape encodes and these tests pin:
 *   - **Enqueue is idempotent.** `UNIQUE(recipe_version_id)` means one pending row per version, so a
 *     re-run of retention (or a replayed save) can never fan out duplicate archive work.
 *
 * There is deliberately no failure-recording method on this DAL: the shipped archive worker relies on
 * SQS redelivery + the DLQ for retries (the outbox row is the source of truth, the message derived — see
 * `versionArchiveWorker.ts` in recipe-workers), so a failed archive throws and is re-driven by SQS
 * rather than mutating an `attempts`/`last_error` column here.
 *
 * The SQL itself is covered by the T133 LocalStack integration spec; this pins the DAL's logic over a
 * fake Drizzle client, mirroring the `recipes.dal.test.ts` harness.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { PendingArchivesDal } from '../pendingArchives.dal.js';
import type { RecipeDrizzle } from '../../../database/client.js';
import type { RecipeTx } from '../../../database/unitOfWork.js';
import { makeFakeDrizzle, type FakeDrizzle } from '../../../__testing__/makeFakeDrizzle.js';

type FakeControl = FakeDrizzle<RecipeDrizzle>;

const createFakeDb = (): FakeControl => makeFakeDrizzle<RecipeDrizzle>();

/** The rows handed to `.values(...)` — always an ARRAY now that the write is batched. */
function rowsOf(control: FakeControl): readonly Record<string, unknown>[] {
    return control.calls.find((call) => call.method === 'values')?.args[0] as readonly Record<string, unknown>[];
}

const VERSION_ID = '00000000-0000-4000-8000-0000000000v1';
const RECIPE_ID = '00000000-0000-4000-8000-0000000000r1';

/**
 * ⚠️ REWRITTEN for `enqueueMany` (owner ruling 2026-09-06). These tests previously drove `enqueue`, one
 * row per call, over the DAL's injected client. Two things changed and both are behavioural:
 *
 *   - the write is BATCHED, because `enforceRetention` re-derives every over-retention version on every
 *     save, so a backlog meant N round-trips — and those now happen while the save holds the `recipes`
 *     row lock; and
 *   - the writer is a REQUIRED parameter, because the outbox row records a debt the `recipe_versions`
 *     row incurs and must commit with it. That is the Outbox contract, and it was breached: the version
 *     committed, then a separate statement recorded the debt.
 *
 * The idempotency and schema-default assertions carry over unchanged — those properties did not move.
 */
describe('PendingArchivesDal.enqueueMany', () => {
    let control: FakeControl;
    let dal: PendingArchivesDal;

    beforeEach(() => {
        control = createFakeDb();
        dal = new PendingArchivesDal(control.db);
    });

    /** The DAL's own client, cast to a tx handle — for the cases not about which writer is used. */
    const asTx = (fake: FakeControl): RecipeTx => fake.db as unknown as RecipeTx;

    it('records each version as owing S3 a write, addressable by BOTH its id and its number', async () => {
        control.enqueue([{ id: 'pa-1' }]);

        await dal.enqueueMany([{ recipeVersionId: VERSION_ID, recipeId: RECIPE_ID, versionNumber: 11 }], asTx(control));

        // versionNumber is carried on the row (not just derivable) because it is what the archive
        // object is KEYED by (ARCH-BE-3) — the worker needs it to build the key.
        expect(rowsOf(control)[0]).toMatchObject({
            recipeVersionId: VERSION_ID,
            recipeId: RECIPE_ID,
            versionNumber: 11,
        });
    });

    it('⛔ writes a backlog in ONE statement, not one per version', async () => {
        control.enqueue([{ id: 'pa-1' }, { id: 'pa-2' }, { id: 'pa-3' }]);

        await dal.enqueueMany(
            [11, 12, 13].map((versionNumber) => ({
                recipeVersionId: `${VERSION_ID}${versionNumber}`,
                recipeId: RECIPE_ID,
                versionNumber,
            })),
            asTx(control),
        );

        expect(control.calls.filter((call) => call.method === 'insert')).toHaveLength(1);
        expect(rowsOf(control)).toHaveLength(3);
    });

    it('⛔ issues NO statement for an empty overflow — drizzle throws on `.values([])`', async () => {
        // Not an edge case: `enforceRetention` calls this on EVERY save, and the overflow is empty for
        // every recipe with ten versions or fewer. Without the guard the COMMON path is the broken one.
        await expect(dal.enqueueMany([], asTx(control))).resolves.toStrictEqual([]);
        expect(control.calls.filter((call) => call.method === 'insert')).toHaveLength(0);
    });

    it('⛔ writes through the SUPPLIED transaction, never the injected client', async () => {
        // ⚠️ TWO DISTINCT FAKES, deliberately. With one shared fake this assertion cannot fail — a DAL
        // that ignored the parameter and used `this.db` would record the call in the same place and look
        // identical. The defect this test exists for is invisible to a single-fake harness.
        const injected = createFakeDb();
        const tx = createFakeDb();

        tx.enqueue([{ id: 'pa-1' }]);

        await new PendingArchivesDal(injected.db).enqueueMany(
            [{ recipeVersionId: VERSION_ID, recipeId: RECIPE_ID, versionNumber: 11 }],
            asTx(tx),
        );

        expect(tx.calls.filter((call) => call.method === 'insert')).toHaveLength(1);
        expect(injected.calls, 'the injected client was used instead of the caller’s transaction').toStrictEqual([]);
    });

    it('is idempotent — a replayed retention pass cannot fan out duplicate archive work', async () => {
        control.enqueue([]);

        await dal.enqueueMany([{ recipeVersionId: VERSION_ID, recipeId: RECIPE_ID, versionNumber: 11 }], asTx(control));

        // UNIQUE(recipe_version_id) + ON CONFLICT DO NOTHING: enqueueing the same version twice leaves
        // exactly one row, so retention is safe to re-run and a duplicate SQS delivery is harmless.
        expect(control.calls.some((call) => call.method === 'onConflictDoNothing')).toBe(true);
    });

    it('leaves status/attempts to the schema defaults (pending, 0) rather than restating them', async () => {
        control.enqueue([{ id: 'pa-1' }]);

        await dal.enqueueMany([{ recipeVersionId: VERSION_ID, recipeId: RECIPE_ID, versionNumber: 11 }], asTx(control));

        // One authoritative definition of the initial state — the migration's DEFAULTs. Restating them
        // here would be a second place to drift.
        expect(rowsOf(control)[0]?.['status']).toBeUndefined();
        expect(rowsOf(control)[0]?.['attempts']).toBeUndefined();
    });
});

describe('PendingArchivesDal.countPending', () => {
    it('counts the outstanding backlog the FR-007b-i alarm is defined on', async () => {
        const control = createFakeDb();
        const dal = new PendingArchivesDal(control.db);
        control.enqueue([{ count: 7 }]);

        // FR-007b-i: the backlog must stay under 100; T138 alarms on it. The count is the signal.
        expect(await dal.countPending()).toBe(7);
    });

    it('reports an empty backlog as 0, never undefined', async () => {
        const control = createFakeDb();
        const dal = new PendingArchivesDal(control.db);
        control.enqueue([]);

        expect(await dal.countPending()).toBe(0);
    });
});
