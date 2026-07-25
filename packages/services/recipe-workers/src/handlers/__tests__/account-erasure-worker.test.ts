import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { S3Client } from '@aws-sdk/client-s3';
import type { SQSEvent } from 'aws-lambda';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

/**
 * T135-test — unit tests for the GDPR account-erasure worker (C-007 / D7).
 *
 * This is a right-to-erasure path, so these tests are written to FAIL if the erasure is subtly wrong,
 * not merely to demonstrate that it runs. The previous version of this spec pinned `eraseRecipeRows` as
 * "a no-op that resolves for any owner", which codified the stub as correct — a worker that deleted a
 * user's photos, reported success, and left every database row intact. Those assertions are gone.
 *
 * The load-bearing rules are pinned by RENDERING each `db.execute(sql\`…\`)` to real SQL via
 * {@link PgDialect} (the technique `recipes.dal.soft-delete.test.ts` established) and asserting on the
 * predicate the database will actually evaluate. Return-value assertions cannot catch a dropped
 * `WHERE`, a re-introduced `deleted_at IS NULL` filter, or a missing clone-detach — rendering can.
 *
 * The rules pinned here, each of which is a real production failure if broken:
 *   - tombstones are erased too (no `deleted_at` filter — data-model.md §Hard purge);
 *   - other owners' `cloned_from_id` pointers are NULLed BEFORE the delete, or the delete throws on the
 *     `recipes_cloned_from_id_fkey` NO ACTION constraint (verified against real Postgres 16);
 *   - both the media AND the version-archive bucket are swept (verticals-8);
 *   - DB rows go before S3 objects, and `completed` is written only after BOTH;
 *   - a failure never makes the job row terminal (see the `handler` describe for the full reasoning).
 */

// The module-level `new S3Client({})` in the worker resolves to this shared mock, so its `.send`
// is observable/controllable from the handler tests. The command classes echo their input so a
// test can introspect the exact List/Delete payloads without depending on the real SDK shapes.
const { s3Send } = vi.hoisted(() => ({ s3Send: vi.fn() }));

vi.mock('@aws-sdk/client-s3', () => ({
    // `function` (not arrow) so `new S3Client({})` at module scope is constructable under the mock.
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

// The module-level CDN adapter factory (HAZ-051/067/039) resolves to this shared mock, so the erasure
// worker's invalidation call is observable/controllable exactly like `s3Send` above. Mocked at the
// `common/cdn-invalidation.js` boundary (not `@aws-sdk/client-cloudfront`) — the ADAPTER's own real-vs-
// no-op branching is unit-tested in `common/__tests__/cdn-invalidation.test.ts`; this suite only needs to
// pin how the WORKER calls the port it is handed.
const { cdnInvalidate, createCloudFrontInvalidationMock } = vi.hoisted(() => ({
    cdnInvalidate: vi.fn().mockResolvedValue(undefined),
    createCloudFrontInvalidationMock: vi.fn(),
}));

vi.mock('../../common/cdn-invalidation.js', () => ({
    createCloudFrontInvalidation: createCloudFrontInvalidationMock.mockImplementation(() => ({
        invalidate: cdnInvalidate,
    })),
}));

import { getRecipeDb as getRecipeDbMock } from '../../common/db.js';
import {
    claimErasureJob,
    eraseRecipeObjects,
    eraseRecipeRows,
    handler,
    isInvalidErasureMessageError,
    markErasureJobCompleted,
    ownerMediaPrefix,
    parseErasureMessage,
    recordErasureJobError,
} from '../account-erasure-worker.js';
import { makeErasureEvent, makeErasureRecord, makeSqsRecord } from '../__fixtures__/messages.js';

type TestHandler = (event: SQSEvent) => Promise<void>;
const runHandler = handler as unknown as TestHandler;

const asClient = (send: unknown): S3Client => ({ send }) as unknown as S3Client;

/** Build the object returned by an inspected List command call. */
const listInput = (call: unknown): { Bucket?: string; Prefix?: string; ContinuationToken?: string } =>
    (call as { input: { Bucket?: string; Prefix?: string; ContinuationToken?: string } }).input;

const deleteKeys = (call: unknown): string[] =>
    (call as { input: { Delete: { Objects: Array<{ Key: string }> } } }).input.Delete.Objects.map((o) => o.Key);

const commandName = (call: unknown): string => (call as { command: string }).command;

// ── The raw-SQL fake ──────────────────────────────────────────────────────────────────────────────

const dialect = new PgDialect();

/** One rendered statement: the SQL Postgres would receive, plus its bound parameters. */
interface RenderedStatement {
    readonly text: string;
    readonly params: readonly unknown[];
}

/**
 * Interleaved record of DB statements (`db:<sql>`) and S3 calls (`s3`), in the order they happened.
 *
 * Ordering here spans two different systems, so it cannot be asserted from either mock alone: "rows
 * before objects" and "completed only after both sweeps" are exactly the rules a one-sided call-order
 * check would miss.
 */
let timeline: string[] = [];

interface FakeDbControl {
    readonly db: NodePgDatabase<Record<string, never>>;
    /** Every statement passed to `execute`, in order, including those issued inside a transaction. */
    readonly statements: () => RenderedStatement[];
    /** Statements issued INSIDE a `db.transaction(...)` callback — the atomicity assertion. */
    readonly txStatements: () => RenderedStatement[];
    readonly enqueue: (...results: Array<{ rows: unknown[] }>) => void;
    /** Force the Nth `execute` (0-based, across all executes) to reject. */
    readonly failExecuteAt: (index: number, error: Error) => void;
    readonly transactionCount: () => number;
}

/**
 * A fake of the schema-less Drizzle handle this Lambda uses (`common/db.ts`): `execute(sql)` +
 * `transaction(cb)`. Statements are captured as `SQL` objects and rendered on demand, so assertions
 * describe the query the database evaluates rather than how Drizzle happened to compose it.
 */
function createFakeDb(): FakeDbControl {
    const captured: Array<{ sql: SQL; inTx: boolean }> = [];
    const results: Array<{ rows: unknown[] }> = [];
    const failures = new Map<number, Error>();
    let txDepth = 0;
    let transactions = 0;
    let executeCount = 0;

    const execute = (statement: SQL): Promise<{ rows: unknown[] }> => {
        const index = executeCount++;
        captured.push({ sql: statement, inTx: txDepth > 0 });
        timeline.push(`db:${dialect.sqlToQuery(statement).sql.replace(/\s+/g, ' ').trim()}`);

        const failure = failures.get(index);

        if (failure) {
            return Promise.reject(failure);
        }

        return Promise.resolve(results.shift() ?? { rows: [] });
    };

    const db: Record<string, unknown> = {
        execute,
        transaction: async (callback: (tx: unknown) => Promise<unknown>): Promise<unknown> => {
            transactions += 1;
            txDepth += 1;

            try {
                return await callback(db);
            } finally {
                txDepth -= 1;
            }
        },
    };

    const render = (entry: { sql: SQL }): RenderedStatement => {
        const { sql: text, params } = dialect.sqlToQuery(entry.sql);

        // Collapse the template's indentation so assertions read as one line of SQL.
        return { text: text.replace(/\s+/g, ' ').trim(), params };
    };

    return {
        db: db as unknown as NodePgDatabase<Record<string, never>>,
        statements: (): RenderedStatement[] => captured.map(render),
        txStatements: (): RenderedStatement[] => captured.filter((entry) => entry.inTx).map(render),
        enqueue: (...r: Array<{ rows: unknown[] }>): void => {
            results.push(...r);
        },
        failExecuteAt: (index: number, error: Error): void => {
            failures.set(index, error);
        },
        transactionCount: (): number => transactions,
    };
}

// Real app-user ids are ULIDs (identity mints them via ulidx); the erasure message boundary now enforces
// that, so every owner id that flows through parseErasureMessage/handler must be a VALID 26-char ULID.
const OWNER = '01JQ8N2X4RBV6WK3ZT5Y7A9C0P';
const OWNER_2 = '01JQ8N2X4RBV6WK3ZT5Y7A9C1Q';

beforeEach(() => {
    vi.clearAllMocks();
    timeline = [];
});

/** Index in the {@link timeline} of the first entry matching `pattern`, or -1. */
const timelineIndex = (pattern: RegExp): number => timeline.findIndex((entry) => pattern.test(entry));

describe('ownerMediaPrefix', () => {
    it('namespaces media under recipes/<ownerId>/', () => {
        expect(ownerMediaPrefix('01JOWNER')).toBe('recipes/01JOWNER/');
    });

    it('embeds the owner id verbatim so distinct owners never share a prefix', () => {
        expect(ownerMediaPrefix('a')).not.toBe(ownerMediaPrefix('b'));
        expect(ownerMediaPrefix('a')).toContain('a');
    });
});

describe('parseErasureMessage', () => {
    it('shapes a valid SQS body into a typed erasure message', () => {
        const record = makeErasureRecord({ ownerId: OWNER, requestedAt: '2026-07-10T12:00:00.000Z' });

        expect(parseErasureMessage(record)).toEqual({ ownerId: OWNER, requestedAt: '2026-07-10T12:00:00.000Z' });
    });

    it('throws when the body is not valid JSON (poison message surfaces, not silently swallowed)', () => {
        expect(() => parseErasureMessage(makeSqsRecord('{not json'))).toThrow(SyntaxError);
    });

    // An ownerId that is absent, blank, or not a string is the worst-case input for THIS worker: it is
    // not a crash, it is a SILENT FALSE ERASURE. `ownerMediaPrefix('')` is `recipes//`, which matches no
    // real key, and `DELETE ... WHERE owner_id = ''` matches no row — so an unvalidated blank owner sweeps
    // nothing, deletes nothing, and marks the job `completed`. The job row would then assert to a
    // regulator that the user's data was erased when nothing was touched. Rejecting at the boundary is
    // what keeps "completed" honest.
    it.each([
        ['absent', {}],
        ['null', { ownerId: null }],
        ['blank', { ownerId: '' }],
        ['whitespace only', { ownerId: '   ' }],
        ['not a string', { ownerId: 12345 }],
        // Defense in depth (U3): the owner id feeds the S3 prefix and the SQL predicate, so the message
        // boundary rejects anything that is not a strict ULID — the format identity actually mints. A
        // hostile or malformed id can never reach the sweep. (Not exploitable today — the trailing-slash
        // prefix already contains the blast radius — but this hardens the most destructive path against any
        // future, less-trustworthy producer.)
        ['a path traversal', { ownerId: '..' }],
        ['the bucket prefix itself', { ownerId: 'recipes/' }],
        ['a leading slash', { ownerId: '/01JQ8N2X4RBV6WK3ZT5Y7A9C0P' }],
        ['a non-ULID slug', { ownerId: 'owner-1' }],
        ['a ULID with an invalid Crockford char (O)', { ownerId: '01J0000000000000000000OWN0' }],
        ['too short to be a ULID', { ownerId: '01JQ8N2X4R' }],
    ])('rejects a message whose ownerId is %s rather than reporting a false erasure', (_label, body) => {
        const record = makeSqsRecord(JSON.stringify({ requestedAt: '2026-07-10T12:00:00.000Z', ...body }));

        expect(() => parseErasureMessage(record)).toThrow(/ownerId/);
    });

    it('raises an InvalidErasureMessageError its type guard recognises', () => {
        try {
            parseErasureMessage(makeSqsRecord(JSON.stringify({ ownerId: '' })));
            expect.unreachable('parseErasureMessage must reject a blank ownerId');
        } catch (error) {
            expect(isInvalidErasureMessageError(error)).toBe(true);
        }
    });

    it('does not confuse an unrelated error for an InvalidErasureMessageError', () => {
        expect(isInvalidErasureMessageError(new Error('nope'))).toBe(false);
    });
});

describe('eraseRecipeRows', () => {
    it('runs every delete inside ONE transaction so a crash cannot half-erase', async () => {
        const control = createFakeDb();

        await eraseRecipeRows(control.db, OWNER);

        expect(control.transactionCount()).toBe(1);
        // Every statement must be inside it: detaching clone pointers and then failing to delete the
        // source would strip a NON-requesting user's provenance permanently, for nothing.
        expect(control.txStatements()).toHaveLength(control.statements().length);
        expect(control.statements().length).toBeGreaterThan(0);
    });

    it('deletes the erasing user’s ratings on OTHER users’ recipes (the third owner-scoped root)', async () => {
        const control = createFakeDb();

        await eraseRecipeRows(control.db, OWNER);

        // recipe_ratings.recipe_id CASCADEs, so ratings on the owner's OWN recipes go with those recipes —
        // but the owner's ratings on everyone ELSE's (surviving) recipes cascade from nothing and would
        // survive a right-to-erasure request. This scoped delete is the only thing that removes them, and
        // the statement-level aggregate trigger re-derives each survivor's average/count off the back of
        // it. Remove this statement and a user's ratings on others' recipes silently outlive their erasure.
        const del = control.statements().find((s) => /delete from recipe_ratings/i.test(s.text));

        // Exactly one such statement — not zero (missing), not duplicated.
        expect(control.statements().filter((s) => /delete from recipe_ratings/i.test(s.text))).toHaveLength(1);
        expect(del?.text).toMatch(/delete from recipe_ratings where user_id = \$\d/i);
        expect(del?.params).toEqual([OWNER]);
    });

    it('NULLs other owners’ cloned_from_id pointers BEFORE deleting the source recipes', async () => {
        const control = createFakeDb();

        await eraseRecipeRows(control.db, OWNER);

        const statements = control.statements();
        const detachIndex = statements.findIndex((s) => /update recipes set cloned_from_id = null/i.test(s.text));
        const deleteIndex = statements.findIndex((s) => /delete from recipes/i.test(s.text));

        expect(detachIndex).toBeGreaterThanOrEqual(0);
        expect(deleteIndex).toBeGreaterThanOrEqual(0);
        // Ordering is the whole point: `recipes.cloned_from_id -> recipes.id` is ON DELETE NO ACTION and
        // NOT deferrable (verified against the live catalog), so deleting first throws
        // `recipes_cloned_from_id_fkey` the first time anyone has cloned this user's recipe.
        expect(detachIndex).toBeLessThan(deleteIndex);
    });

    it('detaches only clones owned by OTHER users, scoped to this owner’s recipes', async () => {
        const control = createFakeDb();

        await eraseRecipeRows(control.db, OWNER);

        const detach = control.statements().find((s) => /cloned_from_id = null/i.test(s.text));

        // Exactly one detach statement — not zero (missing), not duplicated.
        expect(control.statements().filter((s) => /cloned_from_id = null/i.test(s.text))).toHaveLength(1);
        // Scoped to the erasing owner's recipes...
        expect(detach?.text).toMatch(/cloned_from_id in \(select id from recipes where owner_id = \$\d\)/i);
        // ...and explicitly NOT to the owner's own clones: those are deleted by the same statement that
        // deletes their source, and a non-deferrable NO ACTION check runs at end-of-statement, so they
        // need no detach (proven: a 3-row delete incl. a self-referencing clone succeeds).
        expect(detach?.text).toMatch(/owner_id <> \$\d/i);
        expect(detach?.params).toEqual([OWNER, OWNER]);
    });

    it('deletes recipes by owner with NO deleted_at filter so tombstones are erased too', async () => {
        const control = createFakeDb();

        await eraseRecipeRows(control.db, OWNER);

        const del = control.statements().find((s) => /delete from recipes/i.test(s.text));

        // Exactly one such statement — not zero (missing), not duplicated.
        expect(control.statements().filter((s) => /delete from recipes/i.test(s.text))).toHaveLength(1);
        expect(del?.text).toMatch(/delete from recipes where owner_id = \$\d/i);
        expect(del?.params).toEqual([OWNER]);
        // THE assertion that stops the read-path habit leaking in here. The erasure worker is an explicit
        // exemption from the `activeRecipes()` / `no-raw-recipes-select` rule (data-model.md): a
        // `deleted_at IS NULL` filter would leave every tombstoned recipe — and its cascaded versions,
        // photos and steps — behind on a right-to-erasure request, while reporting success.
        expect(del?.text).not.toMatch(/deleted_at/i);
    });

    it('deletes the owner’s collections', async () => {
        const control = createFakeDb();

        await eraseRecipeRows(control.db, OWNER);

        const del = control.statements().find((s) => /delete from collections/i.test(s.text));

        // Exactly one such statement — not zero (missing), not duplicated.
        expect(control.statements().filter((s) => /delete from collections/i.test(s.text))).toHaveLength(1);
        expect(del?.text).toMatch(/delete from collections where owner_id = \$\d/i);
        expect(del?.params).toEqual([OWNER]);
    });

    it('deletes the author_handles read-model row (the FOURTH owner-scoped root — W8-a.2/.10)', async () => {
        const control = createFakeDb();

        await eraseRecipeRows(control.db, OWNER);

        // author_handles is keyed by user_id with NO FK to recipes/collections, so nothing cascades it —
        // omit this and an erased user's display name survives right-to-erasure in the read model.
        const del = control.statements().find((s) => /delete from author_handles/i.test(s.text));

        // Exactly one such statement — not zero (missing), not duplicated.
        expect(control.statements().filter((s) => /delete from author_handles/i.test(s.text))).toHaveLength(1);
        expect(del?.text).toMatch(/delete from author_handles where user_id = \$\d/i);
        expect(del?.params).toEqual([OWNER]);
    });

    it('never deletes from the shared global ingredients table', async () => {
        const control = createFakeDb();

        await eraseRecipeRows(control.db, OWNER);

        // `ingredients` is a global dedup table with no owner column; deleting from it would destroy
        // rows every other user's recipes reference. `recipe_ingredients` is removed by cascade instead.
        for (const statement of control.statements()) {
            expect(statement.text).not.toMatch(/delete from ingredients/i);
        }
    });

    it('does not hand-delete rows the FK cascade already removes', async () => {
        const control = createFakeDb();

        await eraseRecipeRows(control.db, OWNER);

        // Verified against the live pg_constraint catalog: recipe_steps, recipe_ingredients,
        // recipe_photos, recipe_versions, recipe_collections and recipe_version_pending_archives all
        // cascade from `recipes.id`. Re-deleting them by hand would be dead SQL that silently rots the
        // day a cascade changes — the schema is the one authority for the cascade graph.
        const cascaded =
            /delete from (recipe_steps|recipe_ingredients|recipe_photos|recipe_versions|recipe_collections|recipe_version_pending_archives)/i;

        for (const statement of control.statements()) {
            expect(statement.text).not.toMatch(cascaded);
        }
    });

    it('propagates a failure so the transaction rolls back and SQS retries', async () => {
        const control = createFakeDb();
        control.failExecuteAt(1, new Error('deadlock detected'));

        await expect(eraseRecipeRows(control.db, OWNER)).rejects.toThrow('deadlock detected');
    });
});

describe('erasure job lifecycle', () => {
    describe('claimErasureJob', () => {
        it('claims the single active job for the owner and counts the attempt', async () => {
            const control = createFakeDb();
            control.enqueue({ rows: [{ id: 'job-1' }] });

            const job = await claimErasureJob(control.db, OWNER);

            expect(job).toEqual({ id: 'job-1' });

            const [statement] = control.statements();
            expect(statement?.text).toMatch(/update account_erasure_jobs/i);
            expect(statement?.text).toMatch(/status = 'running'/i);
            // `attempts` must increment on the CLAIM, not on success: an attempt that dies mid-erasure
            // (the case worth counting) would never reach a success-path increment.
            expect(statement?.text).toMatch(/attempts = attempts \+ 1/i);
            // Claiming `queued` OR `running` is what makes an SQS redelivery resumable rather than a
            // no-op. The `idx_erasure_jobs_active_owner` unique partial index guarantees this predicate
            // matches at most ONE row, which is why the message needs no jobId.
            expect(statement?.text).toMatch(/where owner_id = \$\d and status in \('queued', 'running'\)/i);
            expect(statement?.params).toEqual([OWNER]);
        });

        it('returns undefined when the owner has no active job (already-completed replay)', async () => {
            const control = createFakeDb();
            control.enqueue({ rows: [] });

            expect(await claimErasureJob(control.db, OWNER)).toBeUndefined();
        });
    });

    describe('markErasureJobCompleted', () => {
        it('marks the claimed job completed and clears a stale last_error', async () => {
            const control = createFakeDb();

            await markErasureJobCompleted(control.db, 'job-1');

            const [statement] = control.statements();
            expect(statement?.text).toMatch(/update account_erasure_jobs/i);
            expect(statement?.text).toMatch(/status = 'completed'/i);
            // A retry that succeeds must not leave the previous attempt's error on a `completed` row,
            // implying a failure that did not happen.
            expect(statement?.text).toMatch(/last_error = null/i);
            expect(statement?.text).toMatch(/where id = \$\d/i);
            expect(statement?.params).toEqual(['job-1']);
        });
    });

    describe('recordErasureJobError', () => {
        it('records the error WITHOUT making the job status terminal', async () => {
            const control = createFakeDb();

            await recordErasureJobError(control.db, 'job-1', new Error('S3 unavailable'));

            const [statement] = control.statements();
            expect(statement?.text).toMatch(/update account_erasure_jobs set last_error = \$\d/i);
            expect(statement?.params[0]).toContain('S3 unavailable');
            expect(statement?.params[1]).toBe('job-1');
            // The crux. Writing `status = 'failed'` here would (a) drop the job out of the `queued`/
            // `running` set the T136b cron sweeper re-drains, stalling a legal request until the user
            // happens to ask again, and (b) let a re-POST create a second active job, so this message's
            // SQS retry would then violate `idx_erasure_jobs_active_owner` and crash (reproduced against
            // real Postgres). The job stays `running` because it IS still in flight — SQS will retry it.
            expect(statement?.text).not.toMatch(/status/i);
        });

        it('truncates a huge error so one poison failure cannot bloat the row', async () => {
            const control = createFakeDb();

            await recordErasureJobError(control.db, 'job-1', new Error('x'.repeat(5000)));

            const [statement] = control.statements();
            const lastErrorParam = statement?.params[0];
            expect(typeof lastErrorParam).toBe('string');
            expect((lastErrorParam as string).length).toBeLessThanOrEqual(1000);
        });

        it('records a non-Error throw without crashing the error path', async () => {
            const control = createFakeDb();

            await recordErasureJobError(control.db, 'job-1', 'a string was thrown');

            expect(control.statements()[0]?.params[0]).toContain('a string was thrown');
        });
    });
});

describe('eraseRecipeObjects', () => {
    /**
     * A `DeleteObjects` response with no per-key failures.
     *
     * Modelled explicitly because a real `DeleteObjects` ALWAYS resolves to a response object, and the
     * sweep now reads `Errors` off it. A mock that resolves `undefined` for the delete would be a fiction
     * that only the old, return-ignoring implementation could tolerate.
     */
    const deleteOk = (...keys: string[]): { Deleted: Array<{ Key: string }> } => ({
        Deleted: keys.map((Key) => ({ Key })),
    });

    it('deletes every object under the owner prefix in one page and returns the count', async () => {
        const send = vi
            .fn()
            .mockResolvedValueOnce({
                Contents: [{ Key: 'recipes/01JOWNER/a.jpg' }, { Key: 'recipes/01JOWNER/b.jpg' }],
                IsTruncated: false,
            })
            .mockResolvedValueOnce(deleteOk('recipes/01JOWNER/a.jpg', 'recipes/01JOWNER/b.jpg'));

        const deleted = await eraseRecipeObjects(asClient(send), 'media-bucket', '01JOWNER');

        expect(deleted).toBe(2);
        expect(send).toHaveBeenCalledTimes(2);
        expect(commandName(send.mock.calls[0][0])).toBe('ListObjectsV2');
        expect(listInput(send.mock.calls[0][0])).toMatchObject({
            Bucket: 'media-bucket',
            Prefix: 'recipes/01JOWNER/',
            ContinuationToken: undefined,
        });
        expect(commandName(send.mock.calls[1][0])).toBe('DeleteObjects');
        expect(deleteKeys(send.mock.calls[1][0])).toEqual(['recipes/01JOWNER/a.jpg', 'recipes/01JOWNER/b.jpg']);
    });

    it('returns 0 and issues no delete when the prefix is empty (Contents absent)', async () => {
        const send = vi.fn().mockResolvedValueOnce({ IsTruncated: false });

        const deleted = await eraseRecipeObjects(asClient(send), 'media-bucket', '01JOWNER');

        expect(deleted).toBe(0);
        expect(send).toHaveBeenCalledTimes(1);
        expect(commandName(send.mock.calls[0][0])).toBe('ListObjectsV2');
    });

    it('refuses a blank owner rather than sweeping an unscoped prefix', async () => {
        const send = vi.fn();

        // Defence in depth behind `parseErasureMessage`: this function is what actually issues the
        // deletes, so it enforces its own precondition rather than trusting every future caller.
        await expect(eraseRecipeObjects(asClient(send), 'media-bucket', '')).rejects.toThrow(/ownerId/);
        expect(send).not.toHaveBeenCalled();
    });

    it('throws when S3 reports per-key delete errors — a 200 with Errors is NOT success', async () => {
        // `DeleteObjects` is a batch API: S3 answers 200 and reports per-key failures in `Errors`, so the
        // SDK does NOT throw. Trusting the absence of an exception would count an object that is still in
        // the bucket as deleted, and the job would be marked `completed` — a false erasure with no signal.
        const send = vi
            .fn()
            .mockResolvedValueOnce({
                Contents: [{ Key: 'recipes/01JOWNER/a.jpg' }, { Key: 'recipes/01JOWNER/locked.jpg' }],
                IsTruncated: false,
            })
            .mockResolvedValueOnce({
                Deleted: [{ Key: 'recipes/01JOWNER/a.jpg' }],
                Errors: [{ Key: 'recipes/01JOWNER/locked.jpg', Code: 'AccessDenied', Message: 'Access Denied' }],
            });

        await expect(eraseRecipeObjects(asClient(send), 'media-bucket', '01JOWNER')).rejects.toThrow(/AccessDenied/);
    });

    it('names the bucket and a failed key when a batch delete partially fails', async () => {
        const send = vi
            .fn()
            .mockResolvedValueOnce({ Contents: [{ Key: 'recipes/01JOWNER/locked.jpg' }], IsTruncated: false })
            .mockResolvedValueOnce({
                Errors: [{ Key: 'recipes/01JOWNER/locked.jpg', Code: 'AccessDenied', Message: 'Access Denied' }],
            });

        // The retry lands in the DLQ eventually; whoever reads it needs the bucket and key, not a count.
        await expect(eraseRecipeObjects(asClient(send), 'archive-bucket', '01JOWNER')).rejects.toThrow(
            /archive-bucket/,
        );
    });

    it('treats an empty Errors array as a clean success', async () => {
        const send = vi
            .fn()
            .mockResolvedValueOnce({ Contents: [{ Key: 'recipes/01JOWNER/a.jpg' }], IsTruncated: false })
            .mockResolvedValueOnce({ Deleted: [{ Key: 'recipes/01JOWNER/a.jpg' }], Errors: [] });

        await expect(eraseRecipeObjects(asClient(send), 'media-bucket', '01JOWNER')).resolves.toBe(1);
    });

    it('skips keyless list entries and never sends an empty delete batch', async () => {
        const send = vi
            .fn()
            .mockResolvedValueOnce({
                Contents: [{ Key: undefined }, { Key: 'recipes/01JOWNER/only.jpg' }, {}],
                IsTruncated: false,
            })
            .mockResolvedValueOnce(deleteOk('recipes/01JOWNER/only.jpg'));

        const deleted = await eraseRecipeObjects(asClient(send), 'media-bucket', '01JOWNER');

        expect(deleted).toBe(1);
        expect(deleteKeys(send.mock.calls[1][0])).toEqual(['recipes/01JOWNER/only.jpg']);
    });

    it('does not issue a delete for a page whose entries are all keyless', async () => {
        const send = vi.fn().mockResolvedValueOnce({ Contents: [{ Key: undefined }, {}], IsTruncated: false });

        const deleted = await eraseRecipeObjects(asClient(send), 'media-bucket', '01JOWNER');

        expect(deleted).toBe(0);
        expect(send).toHaveBeenCalledTimes(1);
        expect(commandName(send.mock.calls[0][0])).toBe('ListObjectsV2');
    });

    it('follows the continuation token across pages and aggregates the total deleted', async () => {
        // List and Delete share one `send`, so key the response on the command rather than call order.
        const pages = [
            {
                Contents: [{ Key: 'recipes/01JOWNER/p1a' }, { Key: 'recipes/01JOWNER/p1b' }],
                IsTruncated: true,
                NextContinuationToken: 'token-2',
            },
            { Contents: [{ Key: 'recipes/01JOWNER/p2a' }], IsTruncated: false },
        ];
        let listCall = 0;
        const send = vi.fn((cmd: { command: string }) =>
            Promise.resolve(cmd.command === 'ListObjectsV2' ? pages[listCall++] : {}),
        );

        const deleted = await eraseRecipeObjects(asClient(send), 'media-bucket', '01JOWNER');

        expect(deleted).toBe(3);
        // List(page1), Delete(page1), List(page2), Delete(page2)
        expect(send).toHaveBeenCalledTimes(4);
        expect(listInput(send.mock.calls[0][0]).ContinuationToken).toBeUndefined();
        expect(listInput(send.mock.calls[2][0]).ContinuationToken).toBe('token-2');
        expect(deleteKeys(send.mock.calls[3][0])).toEqual(['recipes/01JOWNER/p2a']);
    });

    it('stops (no infinite loop) when a page is truncated but yields no next token', async () => {
        const send = vi
            .fn()
            .mockResolvedValueOnce({
                Contents: [{ Key: 'recipes/01JOWNER/a' }],
                IsTruncated: true,
                NextContinuationToken: undefined,
            })
            .mockResolvedValueOnce(deleteOk('recipes/01JOWNER/a'));

        const deleted = await eraseRecipeObjects(asClient(send), 'media-bucket', '01JOWNER');

        expect(deleted).toBe(1);
        expect(send).toHaveBeenCalledTimes(2);
    });

    it('propagates a downstream S3 failure so the record is retried (no partial success swallowed)', async () => {
        const send = vi.fn().mockRejectedValueOnce(new Error('S3 unavailable'));

        await expect(eraseRecipeObjects(asClient(send), 'media-bucket', '01JOWNER')).rejects.toThrow('S3 unavailable');
    });
});

describe('handler', () => {
    let control: FakeDbControl;

    beforeEach(() => {
        process.env['RECIPE_MEDIA_BUCKET'] = 'media-bucket';
        process.env['RECIPE_ARCHIVE_BUCKET'] = 'archive-bucket';
        delete process.env['CLOUDFRONT_DISTRIBUTION_ID'];
        control = createFakeDb();
        vi.mocked(getRecipeDbMock).mockReturnValue(control.db as never);
        // Every claim resolves to an active job unless a test says otherwise.
        control.enqueue({ rows: [{ id: 'job-1' }] });
        s3Send.mockImplementation(() => {
            timeline.push('s3');

            return Promise.resolve({ IsTruncated: false });
        });
        cdnInvalidate.mockImplementation(() => {
            timeline.push('cdn');

            return Promise.resolve(undefined);
        });
    });

    afterEach(() => {
        delete process.env['RECIPE_MEDIA_BUCKET'];
        delete process.env['RECIPE_ARCHIVE_BUCKET'];
        delete process.env['CLOUDFRONT_DISTRIBUTION_ID'];
    });

    it('sweeps the owner prefix in BOTH the media and the version-archive bucket', async () => {
        await runHandler(makeErasureEvent({ ownerId: OWNER }));

        const listed = s3Send.mock.calls
            .map((call) => listInput(call[0]))
            .filter((input) => input.Prefix !== undefined);

        // verticals-8: version archives live under the SAME owner prefix in a DIFFERENT bucket, by
        // design, precisely so this sweep reaches them. Sweeping only the media bucket leaves every
        // version snapshot — the full text of the user's recipes — in S3 after a "completed" erasure.
        expect(listed.map((input) => input.Bucket)).toEqual(['media-bucket', 'archive-bucket']);

        for (const input of listed) {
            expect(input.Prefix).toBe(`recipes/${OWNER}/`);
        }
    });

    describe('CDN invalidation (HAZ-051/067/039)', () => {
        it('invalidates the owner’s wildcard media-prefix path, AFTER the media sweep and BEFORE the archive sweep', async () => {
            await runHandler(makeErasureEvent({ ownerId: OWNER }));

            expect(cdnInvalidate).toHaveBeenCalledTimes(1);
            // The SAME prefix the media bucket sweep lists+deletes — one wildcard path, not one per object,
            // since a deleted owner's media space is invalidated wholesale rather than per key.
            expect(cdnInvalidate).toHaveBeenCalledWith([`/recipes/${OWNER}/*`]);

            const mediaSweep = timeline.indexOf('s3');
            const cdnIndex = timeline.indexOf('cdn');
            const archiveSweep = timeline.indexOf('s3', cdnIndex + 1);

            expect(mediaSweep).toBeGreaterThanOrEqual(0);
            // Invalidating BEFORE the media objects are gone would leave a moment where a stale edge could
            // re-cache an object that a concurrent read still finds live at origin; AFTER is correct.
            expect(cdnIndex).toBeGreaterThan(mediaSweep);
            expect(archiveSweep).toBeGreaterThan(cdnIndex);
        });

        it('builds the CDN port from CLOUDFRONT_DISTRIBUTION_ID (the config the adapter itself gates on)', async () => {
            process.env['CLOUDFRONT_DISTRIBUTION_ID'] = 'E1234567890';

            await runHandler(makeErasureEvent({ ownerId: OWNER }));

            expect(createCloudFrontInvalidationMock).toHaveBeenCalledWith(
                expect.objectContaining({ distributionId: 'E1234567890' }),
            );
        });

        it('records last_error and rethrows when CDN invalidation fails, leaving the job non-terminal', async () => {
            cdnInvalidate.mockRejectedValueOnce(new Error('CloudFront throttled'));

            await expect(runHandler(makeErasureEvent({ ownerId: OWNER }))).rejects.toThrow('CloudFront throttled');

            const annotation = control.statements().find((s) => /last_error/i.test(s.text));
            expect(annotation?.params[0]).toContain('CloudFront throttled');
            // Same non-terminal posture as an S3 sweep failure: never mark `completed` while the CDN purge
            // request has not been successfully SUBMITTED — SQS redelivery retries the whole attempt.
            expect(control.statements().some((s) => /status = 'completed'/i.test(s.text))).toBe(false);
            // The archive bucket must not have been swept — the failure stops the attempt before it, so a
            // retry re-does (harmlessly, idempotently) only the media sweep + invalidation + archive sweep.
            expect(timeline.filter((entry) => entry === 's3')).toHaveLength(1);
        });

        it('is never invoked when the interlock refuses to erase (no job row for the owner)', async () => {
            const misrouted = createFakeDb();
            misrouted.enqueue({ rows: [] });
            misrouted.enqueue({ rows: [] });
            vi.mocked(getRecipeDbMock).mockReturnValue(misrouted.db as never);

            await runHandler(makeErasureEvent({ ownerId: OWNER }));

            expect(cdnInvalidate).not.toHaveBeenCalled();
        });

        it('is never invoked when RECIPE_MEDIA_BUCKET is unset (fails fast before any destructive work)', async () => {
            delete process.env['RECIPE_MEDIA_BUCKET'];

            await expect(runHandler(makeErasureEvent({ ownerId: OWNER }))).rejects.toThrow(/RECIPE_MEDIA_BUCKET/);
            expect(cdnInvalidate).not.toHaveBeenCalled();
        });
    });

    it('erases the database rows BEFORE sweeping S3', async () => {
        await runHandler(makeErasureEvent({ ownerId: OWNER }));

        const firstSweep = timelineIndex(/^s3$/);
        const deleteRecipes = timelineIndex(/^db:delete from recipes/i);
        const deleteCollections = timelineIndex(/^db:delete from collections/i);

        expect(firstSweep).toBeGreaterThanOrEqual(0);
        expect(deleteRecipes).toBeGreaterThanOrEqual(0);
        expect(deleteCollections).toBeGreaterThanOrEqual(0);
        // Rows first, then objects. The DB rows are the reachable copy of the personal data, so they go
        // first; and because the S3 sweep is prefix-based rather than driven by `recipe_photos.s3_key`
        // rows, a crash in between still converges — a retry re-lists the prefix with no rows to read.
        // The reverse order would leave live rows pointing at objects that no longer exist.
        expect(deleteRecipes).toBeLessThan(firstSweep);
        expect(deleteCollections).toBeLessThan(firstSweep);
    });

    it('marks the job completed only AFTER both buckets are swept', async () => {
        await runHandler(makeErasureEvent({ ownerId: OWNER }));

        const completed = timelineIndex(/^db:update account_erasure_jobs set status = 'completed'/i);
        const sweeps = timeline.filter((entry) => entry === 's3');

        expect(completed).toBeGreaterThanOrEqual(0);
        expect(control.statements().find((s) => /status = 'completed'/i.test(s.text))?.params).toEqual(['job-1']);
        // Both buckets swept, and the row only claims success afterwards. Completing after the DB delete
        // but before the sweeps would report "erased" while the user's photos and version snapshots were
        // still sitting in the buckets — and a crash there would leave a permanent false `completed`.
        expect(sweeps).toHaveLength(2);
        expect(timeline.lastIndexOf('s3')).toBeLessThan(completed);
        // The CDN purge request must also have been submitted before the row claims success — the same
        // "never complete before every step ran" rule the S3 sweeps already get (HAZ-051/067/039).
        expect(timeline.lastIndexOf('cdn')).toBeLessThan(completed);
    });

    it('claims the job before doing any destructive work', async () => {
        await runHandler(makeErasureEvent({ ownerId: OWNER }));

        const statements = control.statements();

        expect(statements[0]?.text).toMatch(/update account_erasure_jobs/i);
        expect(statements[0]?.text).toMatch(/status = 'running'/i);
    });

    it('is a clean no-op over an already-erased owner (at-least-once replay)', async () => {
        // No ACTIVE job (the previous delivery already completed it), but the `completed` row still exists
        // for this owner in THIS DB — so the interlock authorizes the idempotent replay.
        const replayControl = createFakeDb();
        replayControl.enqueue({ rows: [] }); // claim: no active row
        replayControl.enqueue({ rows: [{ exists: 1 }] }); // interlock: a (completed) row exists for the owner
        vi.mocked(getRecipeDbMock).mockReturnValue(replayControl.db as never);

        await expect(runHandler(makeErasureEvent({ ownerId: OWNER }))).resolves.toBeUndefined();

        // The erasure still runs (it is idempotent — a completed owner's prefixes are already empty) but
        // nothing is marked completed a second time.
        expect(s3Send).toHaveBeenCalled();

        for (const statement of replayControl.statements()) {
            expect(statement.text).not.toMatch(/status = 'completed'/i);
        }
    });

    it('refuses to erase and issues NO destructive work when no job row exists for the owner in THIS DB', async () => {
        // The interlock: a claim returns nothing AND no row of any status exists for the owner in this
        // database. That is a MISROUTED message (e.g. a sandbox erasure drained by a pr-{N} worker), not a
        // replay. Running the unconditional deletes here would hard-delete a non-requesting user's recipes
        // and photos out of the wrong DB. The worker must refuse: no DELETE, no S3 sweep.
        const misrouted = createFakeDb();
        misrouted.enqueue({ rows: [] }); // claim: no active row
        misrouted.enqueue({ rows: [] }); // interlock: NO row of any status for this owner in this DB
        vi.mocked(getRecipeDbMock).mockReturnValue(misrouted.db as never);

        await expect(runHandler(makeErasureEvent({ ownerId: OWNER }))).resolves.toBeUndefined();

        expect(s3Send).not.toHaveBeenCalled();
        expect(misrouted.statements().some((s) => /delete from recipes/i.test(s.text))).toBe(false);
        expect(misrouted.statements().some((s) => /delete from collections/i.test(s.text))).toBe(false);
    });

    it('records last_error and rethrows when the S3 sweep fails, leaving the job non-terminal', async () => {
        s3Send.mockReset();
        s3Send.mockRejectedValue(new Error('S3 down'));

        await expect(runHandler(makeErasureEvent({ ownerId: OWNER }))).rejects.toThrow('S3 down');

        const annotation = control.statements().find((s) => /last_error/i.test(s.text));
        expect(annotation?.params[0]).toContain('S3 down');
        expect(annotation?.params[1]).toBe('job-1');
        // Rethrowing is what gets the record retried and, eventually, DLQ'd. Swallowing the error to
        // mark the row `failed` would ACK the message and abandon a right-to-erasure request.
        expect(control.statements().some((s) => /status = 'completed'/i.test(s.text))).toBe(false);
    });

    it('surfaces the ORIGINAL failure even when recording last_error also fails', async () => {
        const failing = createFakeDb();
        failing.enqueue({ rows: [{ id: 'job-1' }] });
        // 0 = claim, 1 = first erase statement, 2 = the last_error annotation.
        failing.failExecuteAt(1, new Error('deadlock detected'));
        failing.failExecuteAt(2, new Error('connection terminated'));
        vi.mocked(getRecipeDbMock).mockReturnValue(failing.db as never);

        // The annotation is best-effort telemetry; masking the real cause with the telemetry's own
        // failure would send an on-call engineer chasing the wrong error.
        await expect(runHandler(makeErasureEvent({ ownerId: OWNER }))).rejects.toThrow('deadlock detected');
    });

    it('fails fast when RECIPE_MEDIA_BUCKET is unset — before touching the DB or S3', async () => {
        delete process.env['RECIPE_MEDIA_BUCKET'];

        await expect(runHandler(makeErasureEvent({ ownerId: OWNER }))).rejects.toThrow(/RECIPE_MEDIA_BUCKET/);
        expect(getRecipeDbMock).not.toHaveBeenCalled();
        expect(s3Send).not.toHaveBeenCalled();
    });

    it('fails fast when RECIPE_ARCHIVE_BUCKET is unset — before touching the DB or S3', async () => {
        delete process.env['RECIPE_ARCHIVE_BUCKET'];

        // Resolved up-front, not lazily at the second sweep: discovering the missing archive bucket only
        // after the rows and media are gone would leave the version archives unreachable AND unswept.
        await expect(runHandler(makeErasureEvent({ ownerId: OWNER }))).rejects.toThrow(/RECIPE_ARCHIVE_BUCKET/);
        expect(getRecipeDbMock).not.toHaveBeenCalled();
        expect(s3Send).not.toHaveBeenCalled();
    });

    it('propagates a poison-message parse failure instead of silently acking it', async () => {
        const event: SQSEvent = { Records: [makeSqsRecord('{not json')] };

        await expect(runHandler(event)).rejects.toThrow(SyntaxError);
    });

    it('rejects a blank-owner message before any destructive work', async () => {
        const event: SQSEvent = { Records: [makeSqsRecord(JSON.stringify({ ownerId: '', requestedAt: 'x' }))] };

        await expect(runHandler(event)).rejects.toThrow(/ownerId/);
        expect(s3Send).not.toHaveBeenCalled();
    });

    it('stops on the first record whose erase fails so SQS can retry the batch', async () => {
        s3Send.mockReset();
        s3Send.mockRejectedValue(new Error('S3 down'));

        await expect(runHandler(makeErasureEvent({ ownerId: OWNER }, { ownerId: OWNER_2 }))).rejects.toThrow('S3 down');
        // Second record must not have been processed after the first threw.
        expect(getRecipeDbMock).toHaveBeenCalledTimes(1);
    });

    it('processes every record in a multi-record batch', async () => {
        const multi = createFakeDb();
        // The FakeDb serves ONE global results queue, so every statement between the two records' claims
        // (record 1's four erase statements + its completed update) consumes a slot. Pad so BOTH records'
        // claims land a job — otherwise record 2's claim reads empty and the U2 interlock (correctly)
        // treats it as a misrouted message and skips it. In production each record's claim is independent.
        const filler = { rows: [] };
        multi.enqueue(
            { rows: [{ id: 'job-1' }] }, // record 1 claim
            filler, // erase: ratings
            filler, // erase: clone-detach
            filler, // erase: recipes
            filler, // erase: collections
            filler, // erase: author_handles (W8-a.10)
            filler, // mark completed
            { rows: [{ id: 'job-2' }] }, // record 2 claim
        );
        vi.mocked(getRecipeDbMock).mockReturnValue(multi.db as never);

        await runHandler(makeErasureEvent({ ownerId: OWNER }, { ownerId: OWNER_2 }));

        const prefixes = s3Send.mock.calls.map((call) => listInput(call[0]).Prefix);
        expect(prefixes).toEqual([
            `recipes/${OWNER}/`,
            `recipes/${OWNER}/`,
            `recipes/${OWNER_2}/`,
            `recipes/${OWNER_2}/`,
        ]);
    });
});
