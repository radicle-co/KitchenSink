/**
 * Analytics plan U6 — unit tests for the analytics retention sweeper (origin R10; AE5).
 *
 * Written BEFORE the handler (TDD red → green). What must hold:
 *
 *  1. **The cutoff is 6 months on `created_at`** — the SERVER clock (0043's rule: `occurred_at` is
 *     client-asserted on ingest-door rows and must never bound a delete).
 *  2. **The delete is BATCHED and BOUNDED per tick** — an id-scoped subquery with a LIMIT, looped until
 *     a short batch or the per-tick cap, so one tick can never hold a table lock across an unbounded
 *     delete. The next tick takes the rest.
 *  3. **Fold-before-delete needs no runtime check** — counts fold at INSERT (KTD1), so every row old
 *     enough to delete was folded months ago; the trigger-absence design means this DELETE fires
 *     nothing. That invariant is asserted against a real database in the integration tier; here the
 *     shape is pinned: a plain DELETE, no count-touching statement anywhere.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import {
    RETENTION_DELETE_BATCH,
    RETENTION_MAX_BATCHES_PER_TICK,
    RETENTION_MONTHS,
    sweepExpiredEvents,
} from '../retentionSweeper.js';

const dialect = new PgDialect();

const render = (statement: SQL): string => dialect.sqlToQuery(statement).sql.replace(/\s+/g, ' ').trim();

/** A fake db whose `execute` returns queued row batches (RETURNING ids), then empties. */
function fakeDb(batchSizes: readonly number[]): {
    db: NodePgDatabase<Record<string, never>>;
    statements: () => string[];
} {
    const captured: SQL[] = [];
    let call = 0;

    const execute = (statement: SQL): Promise<{ rows: { id: number }[] }> => {
        captured.push(statement);
        const size = batchSizes[call] ?? 0;
        call += 1;

        return Promise.resolve({ rows: Array.from({ length: size }, (_unused, index) => ({ id: index })) });
    };

    return {
        db: { execute } as unknown as NodePgDatabase<Record<string, never>>,
        statements: () => captured.map(render),
    };
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('sweepExpiredEvents (U6)', () => {
    it('deletes ONLY rows past the 6-month cutoff, keyed on created_at, id-scoped and LIMIT-bounded', async () => {
        const { db, statements } = fakeDb([3]);

        const deleted = await sweepExpiredEvents(db);

        expect(deleted).toBe(3);
        const first = statements()[0];

        if (first === undefined) {
            throw new Error('unreachable: one statement was issued');
        }

        expect(first).toMatch(/^delete from analytics_events/i);
        expect(first).toMatch(/created_at </i);
        // The cutoff interval travels as a bound parameter — the text pins the ::interval cast and the
        // constant pins the figure.
        expect(first).toMatch(/::interval/i);
        expect(first).toMatch(/limit/i);
        expect(first).toMatch(/returning/i);
        // The interval is the retention rule, stated once as a constant.
        expect(RETENTION_MONTHS).toBe(6);
    });

    it('loops while batches come back FULL, and stops on the first short batch', async () => {
        const full = RETENTION_DELETE_BATCH;
        const { db, statements } = fakeDb([full, full, 5]);

        const deleted = await sweepExpiredEvents(db);

        expect(deleted).toBe(full * 2 + 5);
        expect(statements()).toHaveLength(3);
    });

    it('respects the per-tick batch cap — the next tick takes the rest', async () => {
        const full = RETENTION_DELETE_BATCH;
        const { db, statements } = fakeDb(Array.from({ length: RETENTION_MAX_BATCHES_PER_TICK + 5 }, () => full));

        await sweepExpiredEvents(db);

        expect(statements()).toHaveLength(RETENTION_MAX_BATCHES_PER_TICK);
    });

    it('an empty table is ONE quiet statement — no retry, no error', async () => {
        const { db, statements } = fakeDb([0]);

        const deleted = await sweepExpiredEvents(db);

        expect(deleted).toBe(0);
        expect(statements()).toHaveLength(1);
    });

    it('never touches recipe_impact_signals — lifetime counts survive retention by construction', async () => {
        const { db, statements } = fakeDb([2, 0]);

        await sweepExpiredEvents(db);

        for (const statement of statements()) {
            expect(statement).not.toMatch(/recipe_impact_signals/i);
        }
    });
});
