/**
 * T130-test — unit tests for {@link PendingArchivesDal}, the FR-007b-i S3-archive outbox.
 *
 * Written BEFORE the DAL (TDD red → green). This table is an **outbox**, not a cache: the pending row
 * (plus the `recipe_versions` row it points at) IS the durable record of "this snapshot still owes S3 a
 * write". FR-007b-i turns on that durability — *"the full version payload MUST be persisted locally so
 * retries can replay the exact failed payload"*, and *"pending-archive records MUST only be deleted
 * after a successful S3 confirmation"*.
 *
 * Two invariants the shape encodes and these tests pin:
 *   1. **Enqueue is idempotent.** `UNIQUE(recipe_version_id)` means one pending row per version, so a
 *      re-run of retention (or a replayed save) can never fan out duplicate archive work.
 *   2. **Failures are recorded, not thrown.** A failed attempt increments `attempts` and stores
 *      `last_error`, leaving the row claimable by the sweeper (`idx_pending_archives_status_next`
 *      covers `status IN ('pending','failed')`) — the row is never silently dropped.
 *
 * The SQL itself is covered by the T133 LocalStack integration spec; this pins the DAL's logic over a
 * fake Drizzle client, mirroring the `recipes.dal.test.ts` harness.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

import { PendingArchivesDal } from '../pending-archives.dal.js';
import type { RecipeDrizzle } from '../../../database/client.js';

interface RecordedCall {
    method: string;
    args: unknown[];
}

interface FakeControl {
    db: RecipeDrizzle;
    calls: RecordedCall[];
    enqueue: (...results: unknown[]) => void;
}

const CHAIN_METHODS = [
    'values',
    'returning',
    'from',
    'where',
    'orderBy',
    'limit',
    'offset',
    'set',
    'onConflictDoNothing',
] as const;

function createFakeDb(): FakeControl {
    const calls: RecordedCall[] = [];
    const results: unknown[] = [];

    function makeChain(): Record<string, unknown> {
        const chain: Record<string, unknown> = {};

        for (const method of CHAIN_METHODS) {
            chain[method] = (...args: unknown[]): unknown => {
                calls.push({ method, args });

                return chain;
            };
        }

        chain['then'] = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown): unknown =>
            Promise.resolve(results.shift()).then(resolve, reject);

        return chain;
    }

    const db: Record<string, unknown> = {
        insert: (...args: unknown[]): unknown => {
            calls.push({ method: 'insert', args });

            return makeChain();
        },
        select: (...args: unknown[]): unknown => {
            calls.push({ method: 'select', args });

            return makeChain();
        },
        update: (...args: unknown[]): unknown => {
            calls.push({ method: 'update', args });

            return makeChain();
        },
        delete: (...args: unknown[]): unknown => {
            calls.push({ method: 'delete', args });

            return makeChain();
        },
    };

    return {
        db: db as unknown as RecipeDrizzle,
        calls,
        enqueue: (...r: unknown[]): void => {
            results.push(...r);
        },
    };
}

const dialect = new PgDialect();

function renderedWheres(control: FakeControl): string[] {
    return control.calls
        .filter((call) => call.method === 'where')
        .map((call) => dialect.sqlToQuery(call.args[0] as SQL).sql);
}

function payloadOf(control: FakeControl, method: 'values' | 'set'): Record<string, unknown> {
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

describe('PendingArchivesDal.markFailed', () => {
    let control: FakeControl;
    let dal: PendingArchivesDal;

    beforeEach(() => {
        control = createFakeDb();
        dal = new PendingArchivesDal(control.db);
    });

    it('increments attempts in SQL (not read-modify-write) and records the error', async () => {
        control.enqueue([{ id: 'pa-1' }]);

        await dal.markFailed(VERSION_ID, 'S3 timeout');

        const set = payloadOf(control, 'set');
        // An in-SQL increment keeps two concurrent workers from both writing attempts = n+1 off a stale
        // read and under-counting — the count drives the DLQ cutoff, so it has to be right.
        expect(set['attempts']).toBeDefined();
        expect(set['lastError']).toBe('S3 timeout');
        expect(set['status']).toBe('failed');
    });

    it('keeps the row claimable by the sweeper (status stays in the retry index)', async () => {
        control.enqueue([{ id: 'pa-1' }]);

        await dal.markFailed(VERSION_ID, 'boom');

        // `idx_pending_archives_status_next` covers status IN ('pending','failed') — a failed row must
        // land in that set or the sweeper will never pick it up again and the snapshot is stranded.
        expect(payloadOf(control, 'set')['status']).toBe('failed');
    });

    it('targets exactly the one version whose archive failed', async () => {
        control.enqueue([{ id: 'pa-1' }]);

        await dal.markFailed(VERSION_ID, 'boom');

        const [where] = renderedWheres(control);
        expect(where).toContain('"recipe_version_id" = $1');
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
