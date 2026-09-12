/**
 * `EnqueueEmitter` refuses a seed-owned food itself, so no caller can queue one (KTD-12: the seed is a seeded item's one
 * writer, so a fetch could never land on it). The routes refuse first (`refetchPolicy.ts`, add-by-name's dedup); this
 * is the writer's own statement, for every caller, present or future.
 *
 * Over a pg client double that records each statement. What Postgres does with the guard is
 * `tests/e2e/foodsApi.e2e.test.ts`'s ("a seed-owned food is never queued").
 */
import type pg from 'pg';
import { describe, expect, it } from 'vitest';

import { EnqueueEmitter } from '../enqueue.emitter.js';
import { isSeedOwnedFoodNotQueueableError } from '../enqueue.errors.js';

/** One recorded statement. */
interface Statement {
    readonly text: string;
    readonly params: readonly unknown[];
}

/**
 * A pool whose one client records every statement and answers the seed-ownership guard with `seeded`.
 *
 * @param seeded - The ids the guard reports as seed-owned.
 * @returns The emitter over the pool, the statements, and whether the client was released.
 */
function makeEmitter(seeded: readonly string[]): {
    emitter: EnqueueEmitter;
    statements: Statement[];
    released: () => boolean;
} {
    const statements: Statement[] = [];
    let released = false;
    const client = {
        query: async (text: string, params: readonly unknown[] = []) => {
            statements.push({ text, params });

            if (text.includes('seed_owned')) {
                const ids = params[0] as readonly string[];

                return { rows: ids.filter((id) => seeded.includes(id)).map((id) => ({ id })), rowCount: 0 };
            }

            return { rows: [], rowCount: 1 };
        },
        release: () => {
            released = true;
        },
    };
    const pool = { connect: async () => client } as unknown as pg.Pool;

    return { emitter: new EnqueueEmitter(pool), statements, released: () => released };
}

/** Whether a statement writes the queue or its requesters. */
function writesTheQueue(statement: Statement): boolean {
    return /fetch_queue|fetch_requesters/u.test(statement.text);
}

describe('EnqueueEmitter refuses a seed-owned food (KTD-12)', () => {
    it('⛔ refuses one before any write, rolls back, and releases its client', async () => {
        const { emitter, statements, released } = makeEmitter(['F-seed']);

        await expect(
            emitter.publishFoodRequested({ id: 'F-seed', requestedBy: 'svc_x', reactivate: true }),
        ).rejects.toSatisfy(isSeedOwnedFoodNotQueueableError);

        expect(statements.some(writesTheQueue)).toBe(false);
        expect(statements.at(-1)?.text).toBe('ROLLBACK');
        expect(released()).toBe(true);
    });

    it('⛔ refuses a whole batch that names one, writing nothing for the others', async () => {
        const { emitter, statements } = makeEmitter(['F-seed']);

        await expect(
            emitter.publishFoodBatchRequested({ foods: [{ id: 'F-live' }, { id: 'F-seed' }], requestedBy: 'svc_x' }),
        ).rejects.toSatisfy(isSeedOwnedFoodNotQueueableError);

        expect(statements.some(writesTheQueue)).toBe(false);
    });

    it('asks once per publish, with every id, then writes (the positive control)', async () => {
        const { emitter, statements } = makeEmitter([]);

        await emitter.publishFoodBatchRequested({ foods: [{ id: 'F-a' }, { id: 'F-b' }], requestedBy: 'svc_x' });

        const guards = statements.filter((statement) => statement.text.includes('seed_owned'));

        expect(guards).toHaveLength(1);
        expect(guards[0]?.params).toStrictEqual([['F-a', 'F-b']]);
        expect(statements.some(writesTheQueue)).toBe(true);
        expect(statements.at(-1)?.text).toBe('COMMIT');
    });
});
