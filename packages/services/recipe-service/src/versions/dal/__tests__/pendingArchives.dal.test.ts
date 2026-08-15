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
import { makeFakeDrizzle, type FakeDrizzle } from '../../../__testing__/makeFakeDrizzle.js';

type FakeControl = FakeDrizzle<RecipeDrizzle>;

const createFakeDb = (): FakeControl => makeFakeDrizzle<RecipeDrizzle>();

function payloadOf(control: FakeControl, method: 'values'): Record<string, unknown> {
    return control.calls.find((call) => call.method === method)?.args[0] as Record<string, unknown>;
}

const VERSION_ID = '00000000-0000-4000-8000-0000000000v1';
const RECIPE_ID = '00000000-0000-4000-8000-0000000000r1';

describe('PendingArchivesDal.enqueue', () => {
    let control: FakeControl;
    let dal: PendingArchivesDal;

    beforeEach(() => {
        control = createFakeDb();
        dal = new PendingArchivesDal(control.db);
    });

    it('records the version as owing S3 a write, addressable by BOTH its id and its number', async () => {
        control.enqueue([{ id: 'pa-1' }]);

        await dal.enqueue({ recipeVersionId: VERSION_ID, recipeId: RECIPE_ID, versionNumber: 11 });

        const values = payloadOf(control, 'values');
        // versionNumber is carried on the row (not just derivable) because it is what the archive
        // object is KEYED by (ARCH-BE-3) — the worker needs it to build the key.
        expect(values).toMatchObject({ recipeVersionId: VERSION_ID, recipeId: RECIPE_ID, versionNumber: 11 });
    });

    it('is idempotent — a replayed retention pass cannot fan out duplicate archive work', async () => {
        control.enqueue([]);

        await dal.enqueue({ recipeVersionId: VERSION_ID, recipeId: RECIPE_ID, versionNumber: 11 });

        // UNIQUE(recipe_version_id) + ON CONFLICT DO NOTHING: enqueueing the same version twice leaves
        // exactly one row, so retention is safe to re-run and a duplicate SQS delivery is harmless.
        expect(control.calls.some((call) => call.method === 'onConflictDoNothing')).toBe(true);
    });

    it('leaves status/attempts to the schema defaults (pending, 0) rather than restating them', async () => {
        control.enqueue([{ id: 'pa-1' }]);

        await dal.enqueue({ recipeVersionId: VERSION_ID, recipeId: RECIPE_ID, versionNumber: 11 });

        const values = payloadOf(control, 'values');
        // One authoritative definition of the initial state — the migration's DEFAULTs. Restating them
        // here would be a second place to drift.
        expect(values['status']).toBeUndefined();
        expect(values['attempts']).toBeUndefined();
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
