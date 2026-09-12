/**
 * T2 (CP-9) — unit tests for the shared {@link makeFakeDrizzle} test builder.
 *
 * These pin the contract the ~8 migrated DAL suites depend on: arbitrary chains record their calls in
 * order, `enqueue` feeds a FIFO queue that each awaited chain link shifts from, `execute` resolves a fixed
 * `{ rows: [] }` independent of that queue, and `transaction` enlists its callback against the SAME fake
 * (so calls made inside a transaction land in the same `calls` array as calls made outside one).
 */
import { describe, it, expect } from 'vitest';

import { makeFakeDrizzle, methodsOf } from '../makeFakeDrizzle.js';

describe('makeFakeDrizzle', () => {
    it('records an arbitrary chain of builder calls, in order, with their arguments', async () => {
        const fake = makeFakeDrizzle<{ insert: (t: string) => unknown }>();
        fake.enqueue([{ id: 'row-1' }]);

        const result = await (
            fake.db as unknown as {
                insert: (t: string) => {
                    values: (v: object) => { onConflictDoNothing: () => { returning: () => unknown } };
                };
            }
        )
            .insert('recipes')
            .values({ title: 'Soup' })
            .onConflictDoNothing()
            .returning();

        expect(result).toEqual([{ id: 'row-1' }]);
        expect(methodsOf(fake)).toEqual(['insert', 'values', 'onConflictDoNothing', 'returning']);
        expect(fake.calls[0]).toEqual({ method: 'insert', args: ['recipes'] });
        expect(fake.calls[1]).toEqual({ method: 'values', args: [{ title: 'Soup' }] });
    });

    it('shifts queued results off a FIFO queue as separate chains are awaited', async () => {
        const fake = makeFakeDrizzle<Record<string, (...args: unknown[]) => unknown>>();
        fake.enqueue([{ id: 'a' }], [{ id: 'b' }]);

        const first = await (fake.db['select'] as (...a: unknown[]) => Promise<unknown>)();
        const second = await (fake.db['select'] as (...a: unknown[]) => Promise<unknown>)();

        expect(first).toEqual([{ id: 'a' }]);
        expect(second).toEqual([{ id: 'b' }]);
    });

    it('resolves undefined (not a hang) when a chain is awaited with nothing queued', async () => {
        const fake = makeFakeDrizzle<Record<string, (...args: unknown[]) => unknown>>();

        const result = await (fake.db['select'] as (...a: unknown[]) => Promise<unknown>)();

        expect(result).toBeUndefined();
    });

    it('resolves execute() to a fixed { rows: [] } WITHOUT consuming the enqueue FIFO queue', async () => {
        const fake = makeFakeDrizzle<{
            execute: (sql: string) => Promise<{ rows: unknown[] }>;
            select: () => unknown;
        }>();
        fake.enqueue([{ id: 'untouched' }]);

        const executed = await fake.db.execute('SELECT 1');
        const selected = await (fake.db.select() as PromiseLike<unknown>);

        expect(executed).toEqual({ rows: [] });
        // The queued result was still there for the NEXT chain — execute() didn't shift it off.
        expect(selected).toEqual([{ id: 'untouched' }]);
        expect(methodsOf(fake)).toEqual(['execute', 'select']);
    });

    it('enlists transaction(callback) against the SAME fake, so tx calls share the outer calls array', async () => {
        interface TxDb {
            insert: (t: string) => { values: (v: object) => unknown };
            transaction: (cb: (tx: TxDb) => Promise<unknown>) => Promise<unknown>;
        }
        const fake = makeFakeDrizzle<TxDb>();
        fake.enqueue(undefined);

        await fake.db.transaction(async (tx) => {
            await Promise.resolve(tx.insert('recipes').values({ title: 'Soup' }));
        });

        expect(methodsOf(fake)).toEqual(['insert', 'values']);
    });

    it('does not entangle two independently-constructed fakes (used to prove tx pass-through)', () => {
        const fakeA = makeFakeDrizzle<Record<string, (...args: unknown[]) => unknown>>();
        const fakeB = makeFakeDrizzle<Record<string, (...args: unknown[]) => unknown>>();

        (fakeA.db['insert'] as (...a: unknown[]) => unknown)('recipes');

        expect(methodsOf(fakeA)).toEqual(['insert']);
        expect(methodsOf(fakeB)).toEqual([]);
    });
});
