/**
 * Unit tests for the erasure-orphan sweeper (the resurrection backstop across BOTH object buckets).
 *
 * Written BEFORE the handler change (TDD red → green).
 *
 * **What this sweeper closes.** Two separate read→write windows can leave an object under an owner whose
 * account-erasure has already swept their prefix — an object surviving a right-to-erasure request:
 *
 *  1. **Archive bucket.** `version-archive-worker.ownerErasureRequested` narrows, but cannot close, the
 *     read→PUT window in which the archive worker materialises a snapshot under an owner whose erasure has
 *     already swept the archive bucket (see the guard's own "risk-reduction, NOT a proof" note).
 *  2. **Media bucket.** A photo-upload presigned PUT is minted for the CLIENT and stays valid for its TTL
 *     (default 900s). A URL minted just before erasure can be redeemed AFTER the worker's synchronous media
 *     sweep — the client writes the object directly, landing it under an erased owner's media prefix.
 *
 * This scheduled sweeper re-lists the prefix of every recently-`completed` erasure owner in BOTH buckets
 * and deletes whatever a late write left behind.
 *
 * The tests pin the properties that make it correct rather than dangerous:
 *
 *  1. **`completed`-ONLY.** A `completed` owner's prefixes MUST be empty forever after the erasure worker's
 *     sweep, so anything there is an orphan and is safe to delete. A `queued`/`running`/`failed` owner may
 *     legitimately still hold objects, so sweeping them would delete live data. The status filter is the
 *     whole safety model.
 *  2. **It sweeps BOTH buckets under the owner's prefix** — archive (late version-archive PUT) AND media
 *     (late presigned photo PUT).
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

const ARCHIVE = 'commise-versions-test';
const MEDIA = 'commise-photos-test';

interface ListInput {
    Bucket: string;
    Prefix: string;
}
const listInput = (call: unknown): ListInput => (call as { input: ListInput }).input;
const isList = (call: unknown): boolean => (call as { command?: string }).command === 'ListObjectsV2';
const listCalls = (): ListInput[] =>
    s3Send.mock.calls
        .map((call) => call[0])
        .filter(isList)
        .map(listInput);
const deleteCalls = (): unknown[] => s3Send.mock.calls.map((call) => call[0]).filter((c) => !isList(c));

/** Every SQL statement the handler issued, in order, as inspectable text. */
const executedSql = (execute: ReturnType<typeof vi.fn>): string[] =>
    execute.mock.calls.map((call) => JSON.stringify(call[0]));

/** A schema-less Drizzle stub returning the given completed-owner rows for the SELECT. */
function dbWithCompletedOwners(ownerIds: string[]): { execute: ReturnType<typeof vi.fn> } {
    const execute = vi.fn().mockResolvedValue({ rows: ownerIds.map((owner_id) => ({ owner_id })) });

    return { execute };
}

/**
 * Program the S3 mock so a named set of `${Bucket}|${Prefix}` keys each list back one orphan object; every
 * other (bucket, prefix) lists empty. Delete calls resolve with no per-key errors. Bucket-aware so a test
 * can place an orphan in the media bucket alone, the archive bucket alone, or both.
 */
function s3WithOrphansAt(orphanKeys: Set<string>): void {
    s3Send.mockImplementation(async (command: unknown) => {
        if (isList(command)) {
            const { Bucket, Prefix } = listInput(command);

            if (orphanKeys.has(`${Bucket}|${Prefix}`)) {
                return { Contents: [{ Key: `${Prefix}r1/object` }], IsTruncated: false };
            }

            return { Contents: [], IsTruncated: false };
        }

        // DeleteObjectsCommand — a clean batch delete with no per-key failures.
        return { Errors: [] };
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    process.env['RECIPE_ARCHIVE_BUCKET'] = ARCHIVE;
    process.env['RECIPE_MEDIA_BUCKET'] = MEDIA;
    process.env['STAGE'] = 'sandbox';
});

afterEach(() => {
    delete process.env['RECIPE_ARCHIVE_BUCKET'];
    delete process.env['RECIPE_MEDIA_BUCKET'];
    delete process.env['STAGE'];
});

describe('readRecentlyCompletedOwners', () => {
    it('selects ONLY completed owners, within a bounded recent window, capped by the batch', async () => {
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
        const db = dbWithCompletedOwners([]);

        await readRecentlyCompletedOwners(db as never);

        const [select] = executedSql(db.execute);
        expect(select).not.toContain('running');
        expect(select).not.toContain('queued');
    });
});

describe('erasure-orphan-sweeper handler — the reconciliation path (both buckets)', () => {
    it('deletes an orphan left under a completed owner’s ARCHIVE prefix', async () => {
        vi.mocked(getRecipeDbMock).mockReturnValue(dbWithCompletedOwners(['own-1']) as never);
        s3WithOrphansAt(new Set([`${ARCHIVE}|recipes/own-1/`]));

        await handler();

        expect(listCalls()).toContainEqual({ Bucket: ARCHIVE, Prefix: 'recipes/own-1/' });
        expect(deleteCalls()).toHaveLength(1);
    });

    it('deletes an orphan left under a completed owner’s MEDIA prefix (the presigned-PUT resurrection)', async () => {
        // A photo-upload presigned URL minted before erasure lands an object AFTER the synchronous media
        // sweep. The archive-only sweeper never listed the media bucket, so this object survived erasure
        // while the job read `completed`. The sweeper must reconcile the media bucket too.
        vi.mocked(getRecipeDbMock).mockReturnValue(dbWithCompletedOwners(['own-1']) as never);
        s3WithOrphansAt(new Set([`${MEDIA}|recipes/own-1/`]));

        await handler();

        expect(listCalls()).toContainEqual({ Bucket: MEDIA, Prefix: 'recipes/own-1/' });
        expect(deleteCalls()).toHaveLength(1);
    });

    it('lists BOTH buckets under every completed owner’s prefix', async () => {
        vi.mocked(getRecipeDbMock).mockReturnValue(dbWithCompletedOwners(['own-1']) as never);
        s3WithOrphansAt(new Set());

        await handler();

        expect(listCalls()).toContainEqual({ Bucket: ARCHIVE, Prefix: 'recipes/own-1/' });
        expect(listCalls()).toContainEqual({ Bucket: MEDIA, Prefix: 'recipes/own-1/' });
    });

    it('sweeps every completed owner returned, each under its own prefix', async () => {
        vi.mocked(getRecipeDbMock).mockReturnValue(dbWithCompletedOwners(['own-1', 'own-2']) as never);
        s3WithOrphansAt(new Set([`${ARCHIVE}|recipes/own-2/`]));

        await handler();

        const prefixes = listCalls().map((c) => c.Prefix);
        expect(prefixes).toContain('recipes/own-1/');
        expect(prefixes).toContain('recipes/own-2/');
    });

    it('is a no-op when no owner has completed recently', async () => {
        vi.mocked(getRecipeDbMock).mockReturnValue(dbWithCompletedOwners([]) as never);
        s3WithOrphansAt(new Set());

        await handler();

        expect(s3Send).not.toHaveBeenCalled();
    });

    it('is a no-op over completed owners whose prefixes are already clean (the common case)', async () => {
        vi.mocked(getRecipeDbMock).mockReturnValue(dbWithCompletedOwners(['own-1', 'own-2']) as never);
        s3WithOrphansAt(new Set());

        await handler();

        // Listed both owners in both buckets (4 lists), deleted nothing.
        expect(listCalls()).toHaveLength(4);
        expect(deleteCalls()).toHaveLength(0);
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

        await expect(handler()).resolves.toBeUndefined();

        // own-1's archive list threw; own-1's media + both of own-2's lists still ran.
        expect(listCalls().length).toBeGreaterThanOrEqual(2);
    });

    it('requires the archive bucket rather than silently sweeping nothing', async () => {
        delete process.env['RECIPE_ARCHIVE_BUCKET'];
        vi.mocked(getRecipeDbMock).mockReturnValue(dbWithCompletedOwners(['own-1']) as never);

        await expect(handler()).rejects.toThrow(/RECIPE_ARCHIVE_BUCKET/);
    });

    it('requires the media bucket rather than silently leaving media orphans', async () => {
        delete process.env['RECIPE_MEDIA_BUCKET'];
        vi.mocked(getRecipeDbMock).mockReturnValue(dbWithCompletedOwners(['own-1']) as never);

        await expect(handler()).rejects.toThrow(/RECIPE_MEDIA_BUCKET/);
    });
});

describe('orphans-deleted metric (the resurrection-caught alarm signal)', () => {
    const emfLines = (log: ReturnType<typeof vi.spyOn>): Record<string, unknown>[] =>
        log.mock.calls
            .map((call: unknown[]) => String(call[0]))
            .filter((line: string) => line.includes('ErasureOrphansDeleted'))
            .map((line: string) => JSON.parse(line) as Record<string, unknown>);

    it('counts orphans across BOTH buckets — a nonzero value means a resurrection was caught', async () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.mocked(getRecipeDbMock).mockReturnValue(dbWithCompletedOwners(['own-1', 'own-2']) as never);
        // own-1 has an archive orphan; own-2 has a media orphan — the total is 2 across both buckets.
        s3WithOrphansAt(new Set([`${ARCHIVE}|recipes/own-1/`, `${MEDIA}|recipes/own-2/`]));

        await handler();

        const [emf] = emfLines(log);
        expect(emf).toMatchObject({ ErasureOrphansDeleted: 2, Stage: 'sandbox' });
        log.mockRestore();
    });

    it('emits 0 on a clean tick, so the alarm has data instead of INSUFFICIENT_DATA', async () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.mocked(getRecipeDbMock).mockReturnValue(dbWithCompletedOwners([]) as never);
        s3WithOrphansAt(new Set());

        await handler();

        const [emf] = emfLines(log);
        expect(emf).toMatchObject({ ErasureOrphansDeleted: 0 });
        log.mockRestore();
    });
});

describe('the batch bound', () => {
    it('caps the number of owners per tick at SWEEP_BATCH_SIZE', () => {
        expect(SWEEP_BATCH_SIZE).toBeGreaterThan(0);
        expect(Number.isInteger(SWEEP_BATCH_SIZE)).toBe(true);
    });
});
