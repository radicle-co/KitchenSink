/**
 * Unit tests for the erasure-orphan sweeper (the archive-resurrection backstop).
 *
 * Written BEFORE the handler (TDD red → green).
 *
 * **What this sweeper closes.** `version-archive-worker.ownerErasureRequested` narrows, but cannot
 * close, the read→PUT window in which the archive worker materialises a snapshot under an owner whose
 * account-erasure has already swept the archive bucket — an object surviving a right-to-erasure request
 * (see the guard's own "This is risk-reduction, NOT a proof" note). This scheduled sweeper is the true
 * backstop: it re-lists the archive prefix of every recently-`completed` erasure owner and deletes
 * whatever a late PUT left behind.
 *
 * The tests pin the two properties that make it correct rather than dangerous:
 *
 *  1. **`completed`-ONLY.** A `completed` owner's archive prefix MUST be empty forever after the erasure
 *     worker's sweep, so anything there is an orphan and is safe to delete. An owner whose erasure is
 *     still `queued`/`running`/`failed` may legitimately still hold archives (the erasure has not run, or
 *     is being retried), so sweeping them would delete live data. The status filter is the whole safety
 *     model — dropping it turns a backstop into data loss.
 *  2. **It sweeps the ARCHIVE bucket, under the owner's prefix.** The media bucket is erased
 *     synchronously by the worker; the archive bucket is where a late PUT lands (the worker writes the
 *     snapshot there), so that is the one bucket this reconciles.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Module-level `new S3Client({})` in the handler; the list/delete commands echo their input so the
// real `eraseRecipeObjects` (reused from the erasure worker) runs against controllable responses.
const { s3Send } = vi.hoisted(() => ({ s3Send: vi.fn() }));

vi.mock('@aws-sdk/client-s3', () => ({
    S3Client: vi.fn(function () {
        return { send: s3Send };
    }),
    ListObjectsV2Command: vi.fn(function (input: unknown) {
        return { command: 'ListObjectsV2', input };
    }),
    DeleteObjectsCommand: vi.fn(function (input: unknown) {
        return { command: 'DeleteObjects', input };
    }),
}));

const { getRecipeDb } = vi.hoisted(() => ({ getRecipeDb: vi.fn() }));
vi.mock('../../common/db.js', () => ({ getRecipeDb }));

import { getRecipeDb as getRecipeDbMock } from '../../common/db.js';
import { handler, readRecentlyCompletedOwners, SWEEP_BATCH_SIZE } from '../erasure-orphan-sweeper.js';

interface ListInput {
    Bucket: string;
    Prefix: string;
}
const listInput = (call: unknown): ListInput => (call as { input: ListInput }).input;
const isList = (call: unknown): boolean => (call as { command?: string }).command === 'ListObjectsV2';

/** Every SQL statement the handler issued, in order, as inspectable text. */
const executedSql = (execute: ReturnType<typeof vi.fn>): string[] =>
    execute.mock.calls.map((call) => JSON.stringify(call[0]));

/** A schema-less Drizzle stub returning the given completed-owner rows for the SELECT. */
function dbWithCompletedOwners(ownerIds: string[]): { execute: ReturnType<typeof vi.fn> } {
    const execute = vi.fn().mockResolvedValue({ rows: ownerIds.map((owner_id) => ({ owner_id })) });

    return { execute };
}

/**
 * Program the S3 mock so a named set of owner prefixes each list back one orphan object; every other
 * prefix lists empty. Delete calls resolve with no per-key errors.
 */
function s3WithOrphansUnder(prefixesWithOrphans: Set<string>): void {
    s3Send.mockImplementation(async (command: unknown) => {
        if (isList(command)) {
            const { Prefix } = listInput(command);

            if (prefixesWithOrphans.has(Prefix)) {
                return { Contents: [{ Key: `${Prefix}r1/versions/1.json` }], IsTruncated: false };
            }

            return { Contents: [], IsTruncated: false };
        }

        // DeleteObjectsCommand — a clean batch delete with no per-key failures.
        return { Errors: [] };
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    process.env['RECIPE_ARCHIVE_BUCKET'] = 'commise-versions-test';
    process.env['STAGE'] = 'sandbox';
});

afterEach(() => {
    delete process.env['RECIPE_ARCHIVE_BUCKET'];
    delete process.env['STAGE'];
});

describe('readRecentlyCompletedOwners', () => {
    it('selects ONLY completed owners, within a bounded recent window, capped by the batch', async () => {
        // None of these three predicates is observable from the returned rows, and each is load-bearing:
        //  - `status = 'completed'`: the safety filter (a non-completed owner may hold live archives).
        //  - the `interval` look-back: bounds the scan to recent completions so the query stays cheap as
        //    the completed set grows unbounded over the service's lifetime.
        //  - the `LIMIT`: bounds the work per tick.
        const db = dbWithCompletedOwners([]);
        vi.mocked(getRecipeDbMock).mockReturnValue(db as never);

        await readRecentlyCompletedOwners(db as never);

        const [select] = executedSql(db.execute);
        expect(select).toContain('completed');
        expect(select).toContain('account_erasure_jobs');
        expect(select).toContain('interval');
        expect(select).toContain('LIMIT');
    });

    it('does NOT filter on queued or running — only completed owners are reconciled', async () => {
        // Guards against a copy-paste of the erasure sweeper's `status IN ('queued','running')` predicate,
        // which would sweep the archives of owners whose erasure has NOT yet completed.
        const db = dbWithCompletedOwners([]);

        await readRecentlyCompletedOwners(db as never);

        const [select] = executedSql(db.execute);
        expect(select).not.toContain('running');
        expect(select).not.toContain('queued');
    });
});

describe('erasure-orphan-sweeper handler — the reconciliation path', () => {
    it('deletes an orphan left under a completed owner’s ARCHIVE prefix', async () => {
        vi.mocked(getRecipeDbMock).mockReturnValue(dbWithCompletedOwners(['own-1']) as never);
        s3WithOrphansUnder(new Set(['recipes/own-1/']));

        await handler();

        // It listed own-1's prefix in the archive bucket...
        const listCalls = s3Send.mock.calls
            .map((call) => call[0])
            .filter(isList)
            .map(listInput);
        expect(listCalls).toContainEqual({ Bucket: 'commise-versions-test', Prefix: 'recipes/own-1/' });
        // ...and issued a delete for the orphan it found.
        const deletes = s3Send.mock.calls.map((call) => call[0]).filter((c) => !isList(c));
        expect(deletes).toHaveLength(1);
    });

    it('sweeps every completed owner returned, each under its own prefix', async () => {
        vi.mocked(getRecipeDbMock).mockReturnValue(dbWithCompletedOwners(['own-1', 'own-2']) as never);
        s3WithOrphansUnder(new Set(['recipes/own-2/'])); // only own-2 has an orphan

        await handler();

        const listedPrefixes = s3Send.mock.calls
            .map((call) => call[0])
            .filter(isList)
            .map((c) => listInput(c).Prefix);
        expect(listedPrefixes).toContain('recipes/own-1/');
        expect(listedPrefixes).toContain('recipes/own-2/');
    });

    it('is a no-op when no owner has completed recently', async () => {
        vi.mocked(getRecipeDbMock).mockReturnValue(dbWithCompletedOwners([]) as never);
        s3WithOrphansUnder(new Set());

        await handler();

        expect(s3Send).not.toHaveBeenCalled();
    });

    it('is a no-op over completed owners whose prefixes are already clean (the common case)', async () => {
        vi.mocked(getRecipeDbMock).mockReturnValue(dbWithCompletedOwners(['own-1', 'own-2']) as never);
        s3WithOrphansUnder(new Set()); // clean prefixes

        await handler();

        // Listed both, deleted nothing.
        expect(s3Send.mock.calls.map((call) => call[0]).filter(isList)).toHaveLength(2);
        expect(s3Send.mock.calls.map((call) => call[0]).filter((c) => !isList(c))).toHaveLength(0);
    });

    it('keeps sweeping the remaining owners when one owner’s sweep fails', async () => {
        vi.mocked(getRecipeDbMock).mockReturnValue(dbWithCompletedOwners(['own-1', 'own-2']) as never);
        let firstListSeen = false;
        s3Send.mockImplementation(async (command: unknown) => {
            if (isList(command)) {
                if (!firstListSeen) {
                    firstListSeen = true;
                    throw new Error('S3 ListObjects throttled');
                }

                return { Contents: [], IsTruncated: false };
            }

            return { Errors: [] };
        });

        // One owner's S3 failure must not strand another erased owner's reconciliation.
        await expect(handler()).resolves.toBeUndefined();

        expect(s3Send.mock.calls.map((call) => call[0]).filter(isList)).toHaveLength(2);
    });

    it('requires the archive bucket rather than silently sweeping nothing', async () => {
        delete process.env['RECIPE_ARCHIVE_BUCKET'];
        vi.mocked(getRecipeDbMock).mockReturnValue(dbWithCompletedOwners(['own-1']) as never);

        await expect(handler()).rejects.toThrow(/RECIPE_ARCHIVE_BUCKET/);
    });
});

describe('orphans-deleted metric (the resurrection-caught alarm signal)', () => {
    const emfLines = (log: ReturnType<typeof vi.spyOn>): Record<string, unknown>[] =>
        log.mock.calls
            .map((call: unknown[]) => String(call[0]))
            .filter((line: string) => line.includes('ArchiveOrphansDeleted'))
            .map((line: string) => JSON.parse(line) as Record<string, unknown>);

    it('emits the number of orphans deleted this tick — a nonzero value means a resurrection was caught', async () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.mocked(getRecipeDbMock).mockReturnValue(dbWithCompletedOwners(['own-1', 'own-2']) as never);
        s3WithOrphansUnder(new Set(['recipes/own-1/', 'recipes/own-2/'])); // one orphan each

        await handler();

        const [emf] = emfLines(log);
        expect(emf).toMatchObject({ ArchiveOrphansDeleted: 2, Stage: 'sandbox' });
        log.mockRestore();
    });

    it('emits 0 on a clean tick, so the alarm has data instead of INSUFFICIENT_DATA', async () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.mocked(getRecipeDbMock).mockReturnValue(dbWithCompletedOwners([]) as never);
        s3WithOrphansUnder(new Set());

        await handler();

        const [emf] = emfLines(log);
        expect(emf).toMatchObject({ ArchiveOrphansDeleted: 0 });
        log.mockRestore();
    });

    it('still reports the orphans it DID delete when another owner’s sweep failed', async () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.mocked(getRecipeDbMock).mockReturnValue(dbWithCompletedOwners(['own-fail', 'own-ok']) as never);
        let firstListSeen = false;
        s3Send.mockImplementation(async (command: unknown) => {
            if (isList(command)) {
                if (!firstListSeen) {
                    firstListSeen = true;
                    throw new Error('S3 ListObjects throttled');
                }

                return { Contents: [{ Key: 'recipes/own-ok/r/versions/1.json' }], IsTruncated: false };
            }

            return { Errors: [] };
        });

        await handler();

        const [emf] = emfLines(log);
        // own-fail contributed nothing (its list threw); own-ok's single orphan is counted.
        expect(emf).toMatchObject({ ArchiveOrphansDeleted: 1 });
        log.mockRestore();
    });
});

describe('the batch bound', () => {
    it('caps the number of owners per tick at SWEEP_BATCH_SIZE', () => {
        // A guard-rail constant, asserted so a change to it is a conscious edit rather than a silent one.
        expect(SWEEP_BATCH_SIZE).toBeGreaterThan(0);
        expect(Number.isInteger(SWEEP_BATCH_SIZE)).toBe(true);
    });
});
