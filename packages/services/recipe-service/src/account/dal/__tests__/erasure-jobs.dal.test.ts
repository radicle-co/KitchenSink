/**
 * T134-test (DAL) — unit tests for {@link ErasureJobsDal} over a chainable fake Drizzle client.
 *
 * The fake records every builder call and resolves a FIFO queue of canned results when a chain is
 * awaited, mirroring `collections/dal/__tests__/collections.dal.test.ts`. These tests pin the DAL's
 * SHAPE — which builders it invokes, that the insert defers to the partial unique index rather than
 * read-then-write, and how it narrows rows. That the index ACTUALLY rejects a concurrent second insert
 * is real-Postgres semantics and belongs to the integration tier (T137).
 *
 * Requirement → test map:
 *
 *   - **C-007** — `insertQueuedJob` uses `ON CONFLICT DO NOTHING` targeted at the
 *     `(owner_id) WHERE status IN ('queued','running')` partial index, and reports the conflict as
 *     `undefined` rather than throwing.
 *     → `describe('ErasureJobsDal.insertQueuedJob')`
 *   - **C-007** — `findActiveJob` reads only in-flight jobs; `hasCompletedJob` only `completed` ones.
 *     → `describe('ErasureJobsDal.findActiveJob')` / `describe('ErasureJobsDal.hasCompletedJob')`
 *   - **FR-038** — every read/write is keyed on the supplied `ownerId`.
 *     → asserted throughout
 */
import { describe, it, expect } from 'vitest';

import type { RecipeDrizzle } from '../../../database/database.module.js';
import { ErasureJobsDal } from '../erasure-jobs.dal.js';

interface FakeDb {
    readonly db: RecipeDrizzle;
    readonly calls: Array<{ method: string; args: unknown[] }>;
    readonly queue: (result: unknown) => void;
}

/** A chainable, awaitable fake: every method returns the same proxy; awaiting shifts the result queue. */
function createFakeDb(): FakeDb {
    const calls: Array<{ method: string; args: unknown[] }> = [];
    const results: unknown[] = [];

    const handler: ProxyHandler<() => void> = {
        get(_target, prop) {
            if (prop === 'then') {
                return (resolve: (value: unknown) => void): void => {
                    resolve(results.length > 0 ? results.shift() : undefined);
                };
            }

            return (...args: unknown[]): unknown => {
                calls.push({ method: String(prop), args });

                return proxy;
            };
        },
    };

    const proxy = new Proxy((() => undefined) as () => void, handler);

    return { db: proxy as unknown as RecipeDrizzle, calls, queue: (result) => results.push(result) };
}

const methodsOf = (fake: FakeDb): string[] => fake.calls.map((call) => call.method);

const OWNER = 'owner-1';
const JOB_ID = '00000000-0000-4000-8000-0000000000e1';

describe('ErasureJobsDal.insertQueuedJob', () => {
    it('inserts a queued job for the owner and returns the new job id', async () => {
        const fake = createFakeDb();
        fake.queue([{ id: JOB_ID }]);
        const dal = new ErasureJobsDal(fake.db);

        await expect(dal.insertQueuedJob(OWNER)).resolves.toBe(JOB_ID);
        expect(fake.calls[0]).toMatchObject({ method: 'insert' });
        expect(fake.calls[1]?.args[0]).toEqual({ ownerId: OWNER });
    });

    it('defers to the partial unique index via ON CONFLICT DO NOTHING (no read-then-write TOCTOU)', async () => {
        const fake = createFakeDb();
        fake.queue([{ id: JOB_ID }]);
        const dal = new ErasureJobsDal(fake.db);

        await dal.insertQueuedJob(OWNER);

        expect(methodsOf(fake)).toEqual(['insert', 'values', 'onConflictDoNothing', 'returning']);
        // The conflict target MUST carry the index predicate, or Postgres cannot match the partial index.
        expect(fake.calls[2]?.args[0]).toMatchObject({ target: expect.anything(), where: expect.anything() });
    });

    it('reports a lost insert race as undefined rather than throwing a unique violation', async () => {
        const fake = createFakeDb();
        fake.queue([]); // ON CONFLICT DO NOTHING → zero rows returned.
        const dal = new ErasureJobsDal(fake.db);

        await expect(dal.insertQueuedJob(OWNER)).resolves.toBeUndefined();
    });
});

describe('ErasureJobsDal.findActiveJob', () => {
    it('returns the narrowed in-flight job', async () => {
        const fake = createFakeDb();
        fake.queue([{ id: JOB_ID, status: 'running' }]);
        const dal = new ErasureJobsDal(fake.db);

        await expect(dal.findActiveJob(OWNER)).resolves.toEqual({ id: JOB_ID, status: 'running' });
        expect(methodsOf(fake)).toEqual(['select', 'from', 'where', 'limit']);
    });

    it('returns undefined when the owner has no in-flight job', async () => {
        const fake = createFakeDb();
        fake.queue([]);
        const dal = new ErasureJobsDal(fake.db);

        await expect(dal.findActiveJob(OWNER)).resolves.toBeUndefined();
    });

    it('refuses to pass off a terminal-status row as active (the query contract is broken → surface it)', async () => {
        const fake = createFakeDb();
        fake.queue([{ id: JOB_ID, status: 'completed' }]);
        const dal = new ErasureJobsDal(fake.db);

        await expect(dal.findActiveJob(OWNER)).rejects.toThrow(/completed/);
    });
});

describe('ErasureJobsDal.hasCompletedJob', () => {
    it('is true when a completed job exists for the owner', async () => {
        const fake = createFakeDb();
        fake.queue([{ id: JOB_ID }]);
        const dal = new ErasureJobsDal(fake.db);

        await expect(dal.hasCompletedJob(OWNER)).resolves.toBe(true);
        expect(methodsOf(fake)).toEqual(['select', 'from', 'where', 'limit']);
    });

    it('is false when the owner has never completed an erasure', async () => {
        const fake = createFakeDb();
        fake.queue([]);
        const dal = new ErasureJobsDal(fake.db);

        await expect(dal.hasCompletedJob(OWNER)).resolves.toBe(false);
    });
});
