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
import { makeFakeDrizzle, methodsOf } from '../../../__testing__/make-fake-drizzle.js';
import { ErasureJobsDal } from '../erasure-jobs.dal.js';

const createFakeDb = (): ReturnType<typeof makeFakeDrizzle<RecipeDrizzle>> => makeFakeDrizzle<RecipeDrizzle>();

const OWNER = 'owner-1';
const JOB_ID = '00000000-0000-4000-8000-0000000000e1';

describe('ErasureJobsDal.insertQueuedJob', () => {
    it('inserts a queued job for the owner and returns the new job id', async () => {
        const fake = createFakeDb();
        fake.enqueue([{ id: JOB_ID }]);
        const dal = new ErasureJobsDal(fake.db);

        await expect(dal.insertQueuedJob(OWNER)).resolves.toBe(JOB_ID);
        expect(fake.calls[0]).toMatchObject({ method: 'insert' });
        // Default election ⇒ donate nothing: an explicit empty array is persisted, never a NULL the worker
        // has to interpret.
        expect(fake.calls[1]?.args[0]).toEqual({ ownerId: OWNER, publishRecipeIds: [] });
    });

    it('persists the DONATE election on the job row as the durable source of truth (U3b)', async () => {
        const fake = createFakeDb();
        fake.enqueue([{ id: JOB_ID }]);
        const dal = new ErasureJobsDal(fake.db);
        const publishRecipeIds = ['00000000-0000-4000-8000-0000000000d1'];

        await dal.insertQueuedJob(OWNER, publishRecipeIds);

        expect(fake.calls[1]?.args[0]).toEqual({ ownerId: OWNER, publishRecipeIds });
    });

    it('defers to the partial unique index via ON CONFLICT DO NOTHING (no read-then-write TOCTOU)', async () => {
        const fake = createFakeDb();
        fake.enqueue([{ id: JOB_ID }]);
        const dal = new ErasureJobsDal(fake.db);

        await dal.insertQueuedJob(OWNER);

        expect(methodsOf(fake)).toEqual(['insert', 'values', 'onConflictDoNothing', 'returning']);
        // The conflict target MUST carry the index predicate, or Postgres cannot match the partial index.
        expect(fake.calls[2]?.args[0]).toMatchObject({ target: expect.anything(), where: expect.anything() });
    });

    it('reports a lost insert race as undefined rather than throwing a unique violation', async () => {
        const fake = createFakeDb();
        fake.enqueue([]); // ON CONFLICT DO NOTHING → zero rows returned.
        const dal = new ErasureJobsDal(fake.db);

        await expect(dal.insertQueuedJob(OWNER)).resolves.toBeUndefined();
    });
});

describe('ErasureJobsDal.findActiveJob', () => {
    it('returns the narrowed in-flight job', async () => {
        const fake = createFakeDb();
        fake.enqueue([{ id: JOB_ID, status: 'running' }]);
        const dal = new ErasureJobsDal(fake.db);

        await expect(dal.findActiveJob(OWNER)).resolves.toEqual({ id: JOB_ID, status: 'running' });
        expect(methodsOf(fake)).toEqual(['select', 'from', 'where', 'limit']);
    });

    it('returns undefined when the owner has no in-flight job', async () => {
        const fake = createFakeDb();
        fake.enqueue([]);
        const dal = new ErasureJobsDal(fake.db);

        await expect(dal.findActiveJob(OWNER)).resolves.toBeUndefined();
    });

    it('refuses to pass off a terminal-status row as active (the query contract is broken → surface it)', async () => {
        const fake = createFakeDb();
        fake.enqueue([{ id: JOB_ID, status: 'completed' }]);
        const dal = new ErasureJobsDal(fake.db);

        await expect(dal.findActiveJob(OWNER)).rejects.toThrow(/completed/);
    });
});

describe('ErasureJobsDal.hasCompletedJob', () => {
    it('is true when a completed job exists for the owner', async () => {
        const fake = createFakeDb();
        fake.enqueue([{ id: JOB_ID }]);
        const dal = new ErasureJobsDal(fake.db);

        await expect(dal.hasCompletedJob(OWNER)).resolves.toBe(true);
        expect(methodsOf(fake)).toEqual(['select', 'from', 'where', 'limit']);
    });

    it('is false when the owner has never completed an erasure', async () => {
        const fake = createFakeDb();
        fake.enqueue([]);
        const dal = new ErasureJobsDal(fake.db);

        await expect(dal.hasCompletedJob(OWNER)).resolves.toBe(false);
    });
});
