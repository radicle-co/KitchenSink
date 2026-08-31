import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
// `common/cdnInvalidation.js` boundary (not `@aws-sdk/client-cloudfront`) — the ADAPTER's own real-vs-
// no-op branching is unit-tested in `common/__tests__/cdnInvalidation.test.ts`; this suite only needs to
// pin how the WORKER calls the port it is handed.
const { cdnInvalidate, createCloudFrontInvalidationMock } = vi.hoisted(() => ({
    cdnInvalidate: vi.fn().mockResolvedValue(undefined),
    createCloudFrontInvalidationMock: vi.fn(),
}));

vi.mock('../../common/cdnInvalidation.js', () => ({
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
} from '../accountErasureWorker.js';
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

describe('eraseRecipeRows (CR-002 / U3 — SCOPED, owner-only erasure)', () => {
    // Real recipe ids (UUID-shaped) the removed-set SELECT resolves to. These drive the scoped detach,
    // delete, and the caller's per-recipe S3 sweep.
    const REMOVED_A = '00000000-0000-4000-8000-0000000000d1';
    const REMOVED_B = '00000000-0000-4000-8000-0000000000d2';
    const DONATE_1 = '00000000-0000-4000-8000-00000000cd01';

    /**
     * Seed the fake DB so `eraseRecipeRows` reads a concrete removed set. Execute order inside the fn is:
     * 0 flip, 1 removed-SELECT, 2 persist, 3 ratings, 4 detach, 5 delete, 6 collections, 7 scrub, 8
     * author_handles — so the removed-SELECT (index 1) is the 2nd enqueued result.
     */
    const seedRemoved = (control: FakeDbControl, ...ids: string[]): void => {
        control.enqueue({ rows: [] }); // 0: flip
        control.enqueue({ rows: ids.map((id) => ({ id })) }); // 1: removed-SELECT
    };

    it('runs every statement inside ONE transaction so a crash cannot half-erase', async () => {
        const control = createFakeDb();
        seedRemoved(control, REMOVED_A);

        await eraseRecipeRows(control.db, OWNER, []);

        expect(control.transactionCount()).toBe(1);
        // Every statement must be inside it: detaching a clone pointer and then failing to delete the
        // source would strip a NON-requesting user's provenance permanently, for nothing.
        expect(control.txStatements()).toHaveLength(control.statements().length);
        expect(control.statements().length).toBeGreaterThan(0);
    });

    it('flips DONATED recipes to BOTH public AND published, scoped to the owner (U3b)', async () => {
        const control = createFakeDb();
        seedRemoved(control, REMOVED_A);

        await eraseRecipeRows(control.db, OWNER, [DONATE_1]);

        const flip = control.statements().find((s) => /update recipes set visibility/i.test(s.text));

        // BOTH columns — a visibility-only flip would leave a donated DRAFT owner-only (still removed), so
        // this is the mutation that must fail if publish is dropped.
        expect(flip?.text).toMatch(/visibility = 'public'/i);
        expect(flip?.text).toMatch(/status = 'published'/i);
        // Scoped to the owner's own recipes: an election id the caller does not own is a no-op, never a way
        // to publish someone else's recipe. The election binds as one jsonb param (no array list-expansion).
        expect(flip?.text).toMatch(/id in \(select jsonb_array_elements_text\(\$\d::jsonb\)::uuid\)/i);
        expect(flip?.text).toMatch(/and owner_id = \$\d/i);
        expect(flip?.params).toEqual([JSON.stringify([DONATE_1]), OWNER]);
    });

    it('computes the removed set on BOTH axes — owner AND NOT (public AND published)', async () => {
        const control = createFakeDb();
        seedRemoved(control, REMOVED_A);

        await eraseRecipeRows(control.db, OWNER, []);

        const select = control.statements().find((s) => /select id from recipes/i.test(s.text));

        // The two-axis rule: a recipe is community-visible ONLY when public AND published, so owner-only =
        // the negation. Scoping by visibility alone (dropping the status axis) would wrongly SPARE a
        // public-visibility DRAFT — leaving it orphaned under an erased owner. This pins both axes.
        expect(select?.text).toMatch(/where owner_id = \$\d/i);
        expect(select?.text).toMatch(/not \(visibility = 'public' and status = 'published'\)/i);
        expect(select?.params).toEqual([OWNER]);
    });

    it('captures the removed id set on the job row, write-once (crash-convergence)', async () => {
        const control = createFakeDb();
        seedRemoved(control, REMOVED_A, REMOVED_B);

        await eraseRecipeRows(control.db, OWNER, []);

        const persist = control
            .statements()
            .find((s) => /update account_erasure_jobs set removed_recipe_ids/i.test(s.text));

        expect(persist).toBeDefined();
        // The captured ids — the exact set the S3 sweep will use after the rows are gone.
        expect(persist?.params[0]).toBe(JSON.stringify([REMOVED_A, REMOVED_B]));
        // Write-once: the `IS NULL` guard stops a replay (whose freshly-computed set is empty) from
        // clobbering the real set captured by the first attempt. Scoped to an active job.
        expect(persist?.text).toMatch(/status in \('queued', 'running'\)/i);
        expect(persist?.text).toMatch(/removed_recipe_ids is null/i);
    });

    it('returns the removed id set for the caller’s scoped S3 sweep', async () => {
        const control = createFakeDb();
        seedRemoved(control, REMOVED_A, REMOVED_B);

        const result = await eraseRecipeRows(control.db, OWNER, []);

        expect(result.removedRecipeIds).toEqual([REMOVED_A, REMOVED_B]);
    });

    it('deletes the erasing user’s ratings on OTHER users’ recipes (CR-001 — unchanged)', async () => {
        const control = createFakeDb();
        seedRemoved(control, REMOVED_A);

        await eraseRecipeRows(control.db, OWNER, []);

        // recipe_ratings.recipe_id CASCADEs, so ratings on the owner's OWN recipes go with those recipes —
        // but the owner's ratings on everyone ELSE's (surviving) recipes cascade from nothing and would
        // survive erasure. This scoped delete removes them; the statement-level aggregate trigger re-derives
        // each survivor's average/count off the back of it. NO manual aggregate write (trigger-only columns).
        const del = control.statements().find((s) => /delete from recipe_ratings/i.test(s.text));

        expect(control.statements().filter((s) => /delete from recipe_ratings/i.test(s.text))).toHaveLength(1);
        expect(del?.text).toMatch(/delete from recipe_ratings where user_id = \$\d/i);
        expect(del?.params).toEqual([OWNER]);

        // Re-verify the CR-001 invariant survives the rebuild: application code NEVER writes the aggregate.
        for (const statement of control.statements()) {
            expect(statement.text).not.toMatch(/update recipes set (average_rating|rating_count)/i);
            expect(statement.text).not.toMatch(/(average_rating|rating_count) =/i);
        }
    });

    it('detaches SURVIVORS pointing at removed recipes BEFORE the delete (NO ACTION FK)', async () => {
        const control = createFakeDb();
        seedRemoved(control, REMOVED_A);

        await eraseRecipeRows(control.db, OWNER, []);

        const statements = control.statements();
        const detachIndex = statements.findIndex((s) => /update recipes set cloned_from_id = null/i.test(s.text));
        const deleteIndex = statements.findIndex((s) => /^delete from recipes where/i.test(s.text));

        expect(detachIndex).toBeGreaterThanOrEqual(0);
        expect(deleteIndex).toBeGreaterThanOrEqual(0);
        // `recipes.cloned_from_id -> recipes.id` is ON DELETE NO ACTION and not deferrable — so a survivor
        // still pointing at a removed recipe makes the delete throw `recipes_cloned_from_id_fkey`. Detach
        // must run first.
        expect(detachIndex).toBeLessThan(deleteIndex);
    });

    it('scopes the clone-detach to the REMOVED set and guards SURVIVORS (id NOT IN removed), not owner_id', async () => {
        const control = createFakeDb();
        seedRemoved(control, REMOVED_A, REMOVED_B);

        await eraseRecipeRows(control.db, OWNER, []);

        const detach = control.statements().find((s) => /cloned_from_id = null/i.test(s.text));

        expect(control.statements().filter((s) => /cloned_from_id = null/i.test(s.text))).toHaveLength(1);
        // Detach exactly the SURVIVORS whose source is being removed: `cloned_from_id IN removed` AND the
        // referencing row is itself NOT removed (`id NOT IN removed`). This is the mutation-critical pin:
        // the survivor guard MUST be `id NOT IN removed`, NOT `owner_id <> ownerId` — because a DONATED
        // clone (kept) of the owner's OWN removed recipe would be missed by an owner-id guard and the delete
        // would then FK-fail. Both sides key on the identical owner-only predicate.
        expect(detach?.text).toMatch(/cloned_from_id in \(select id from recipes where owner_id = \$\d/i);
        expect(detach?.text).toMatch(/id not in \(select id from recipes where owner_id = \$\d/i);
        expect(detach?.text).toMatch(/not \(visibility = 'public' and status = 'published'\)/i);
        expect(detach?.text).not.toMatch(/owner_id <>/i);
        expect(detach?.params).toEqual([OWNER, OWNER]);
    });

    it('deletes the removed set by the two-axis owner-only predicate, NOT owner-wide, and with NO deleted_at filter', async () => {
        const control = createFakeDb();
        seedRemoved(control, REMOVED_A, REMOVED_B);

        await eraseRecipeRows(control.db, OWNER, []);

        const del = control.statements().find((s) => /^delete from recipes where/i.test(s.text));

        expect(control.statements().filter((s) => /^delete from recipes where/i.test(s.text))).toHaveLength(1);
        // Scoped by the SAME owner-only predicate that defines the removed set (post-flip) — the mutation
        // that preserves truly-public + donated recipes. A plain `DELETE ... WHERE owner_id` (the OLD
        // behaviour) would drop the `NOT (public AND published)` guard and delete the KEPT recipes too.
        expect(del?.text).toMatch(/delete from recipes where owner_id = \$\d/i);
        expect(del?.text).toMatch(/not \(visibility = 'public' and status = 'published'\)/i);
        expect(del?.params).toEqual([OWNER]);
        // Tombstones are erased too — a `deleted_at IS NULL` filter would leave a tombstoned owner-only
        // recipe (and its cascade) behind while reporting success (data-model.md §Hard purge).
        expect(del?.text).not.toMatch(/deleted_at/i);
    });

    it('deletes ALL the owner’s collections (U3c — unchanged)', async () => {
        const control = createFakeDb();
        seedRemoved(control, REMOVED_A);

        await eraseRecipeRows(control.db, OWNER, []);

        const del = control.statements().find((s) => /delete from collections/i.test(s.text));

        expect(control.statements().filter((s) => /delete from collections/i.test(s.text))).toHaveLength(1);
        expect(del?.text).toMatch(/delete from collections where owner_id = \$\d/i);
        expect(del?.params).toEqual([OWNER]);
    });

    it('scrubs the author_handle on KEPT rows to the pseudonym AFTER the delete (U3b residue)', async () => {
        const control = createFakeDb();
        seedRemoved(control, REMOVED_A);

        await eraseRecipeRows(control.db, OWNER, []);

        const statements = control.statements();
        const scrub = statements.find((s) => /update recipes set author_handle/i.test(s.text));
        const scrubIndex = statements.findIndex((s) => /update recipes set author_handle/i.test(s.text));
        const deleteIndex = statements.findIndex((s) => /^delete from recipes where/i.test(s.text));

        // Scrubbed to the deterministic ULID-derived pseudonym, on the owner's remaining (KEPT) rows that
        // still carry a cleartext handle. Mutation: leaving cleartext, or fabricating a handle on a
        // NULL-handle row, both fail here.
        expect(scrub?.text).toMatch(/set author_handle = \$\d/i);
        expect(scrub?.text).toMatch(/where owner_id = \$\d and author_handle is not null/i);
        expect(scrub?.params[0]).toBe(`user_${OWNER}`);
        expect(scrub?.params[1]).toBe(OWNER);
        // AFTER the delete, so only KEPT rows remain when the scrub runs (removed rows are already gone).
        expect(deleteIndex).toBeGreaterThanOrEqual(0);
        expect(scrubIndex).toBeGreaterThan(deleteIndex);
    });

    it('pseudonymizes a CLONE’s frozen source_owner_handle BEFORE the collection delete nulls its pointer', async () => {
        const control = createFakeDb();
        seedRemoved(control, REMOVED_A);

        await eraseRecipeRows(control.db, OWNER, []);

        const statements = control.statements();
        const scrubIndex = statements.findIndex((s) => /update collections set source_owner_handle/i.test(s.text));
        const deleteIndex = statements.findIndex((s) => /delete from collections/i.test(s.text));
        const scrub = statements[scrubIndex];

        // ⚠️ Narrowed, never optional-chained: `expect(scrub?.text)` passes vacuously when the statement was
        // never issued, which is the entire defect this case exists for.
        if (scrub === undefined) {
            throw new Error('the clone-provenance handle sweep was not issued');
        }

        expect(scrub.text).toMatch(/set source_owner_handle = \$\d/i);
        // ⛔ Keyed on the SOURCE POINTER, never on the handle VALUE. `author_handles.display_name` is
        // identity's `profiles.displayName` and is not unique, so a value match would rewrite a bystander's
        // provenance for an unrelated owner who shares a display name.
        expect(scrub.text).toMatch(/source_collection_id in \(select id from collections where owner_id = \$\d\)/i);
        expect(scrub.text).not.toMatch(/where source_owner_handle = \$/i);
        expect(scrub.params[0]).toBe(`user_${OWNER}`);
        expect(scrub.params[1]).toBe(OWNER);
        // ⛔ BEFORE the collection delete. `source_collection_id` is ON DELETE SET NULL, so running after it
        // would key on a pointer the same transaction had just erased and reach nothing.
        expect(deleteIndex).toBeGreaterThanOrEqual(0);
        expect(scrubIndex).toBeLessThan(deleteIndex);
    });

    it('scrubs the editor_handle on a KEPT recipe’s surviving versions, keyed as the sync worker keys it', async () => {
        const control = createFakeDb();
        seedRemoved(control, REMOVED_A);

        await eraseRecipeRows(control.db, OWNER, []);

        const statements = control.statements();
        const scrubIndex = statements.findIndex((s) => /update recipe_versions set editor_handle/i.test(s.text));
        const deleteIndex = statements.findIndex((s) => /^delete from recipes where/i.test(s.text));
        const scrub = statements[scrubIndex];

        if (scrub === undefined) {
            throw new Error('the editor-handle residue sweep was not issued');
        }

        // The same pseudonym as `recipes.author_handle` — one derivation, so a kept recipe and its version
        // history name the same stranger.
        expect(scrub.text).toMatch(/where created_by = \$\d and editor_handle is not null/i);
        expect(scrub.params[0]).toBe(`user_${OWNER}`);
        expect(scrub.params[1]).toBe(OWNER);
        // AFTER the recipe delete: a REMOVED recipe's versions go with the cascade, so only the KEPT ones
        // are still here to scrub.
        expect(deleteIndex).toBeGreaterThanOrEqual(0);
        expect(scrubIndex).toBeGreaterThan(deleteIndex);
    });

    it('deletes the author_handles read-model row (the user-keyed root — W8-a.2/.10)', async () => {
        const control = createFakeDb();
        seedRemoved(control, REMOVED_A);

        await eraseRecipeRows(control.db, OWNER, []);

        // author_handles is keyed by user_id with NO FK, so nothing cascades it — the cleartext read-model
        // row must be deleted explicitly or the display name survives erasure there.
        const del = control.statements().find((s) => /delete from author_handles/i.test(s.text));

        expect(control.statements().filter((s) => /delete from author_handles/i.test(s.text))).toHaveLength(1);
        expect(del?.text).toMatch(/delete from author_handles where user_id = \$\d/i);
        expect(del?.params).toEqual([OWNER]);
    });

    /**
     * ⛔ NINE ASSERTIONS STOOD HERE AND WERE REPLACED BY THE TWO BELOW — owner ruling 2026-08-25, ADR-0027.
     *
     * They pinned the SQL of sweep steps 10, 11 and 12: that `ingredient_resolution_mappings` was retired and
     * stripped of `author_id`/`source_phrase`, that `ingredient_resolution_memos` and
     * `ingredient_parse_corrections` were de-identified rather than deleted, that each moved its two columns
     * in ONE statement, that each keyed on the owner as a bound parameter, and that each ran inside the one
     * erasure transaction. Migration 0033 removed all three statements, so every one of those assertions was
     * about SQL that no longer exists.
     *
     * ⛔ Their coverage INVERTS rather than disappearing, and the inverse is the assertion that matters now.
     * The old suite could only fail if a sweep were removed; this one fails if a sweep is ADDED. That is the
     * live risk after a reversal — the tables still carry a `user_id`, `erasureSweepCoverage.test.ts` used to
     * demand a sweep for exactly that reason, and the obvious "fix" for a reader who has not read the ADR is
     * to put the statements back. A comment saying "do not restore this" is a convention; a red test is a
     * fact.
     *
     * ⚠️ What is genuinely NOT re-homed: the owner-parameterization claims those tests carried for these
     * three statements. They were properties OF statements that are gone. The same property is asserted for
     * every surviving statement by its own case above, and repo-wide by `rawSqlParameterization.test.ts`.
     */
    it('⛔ issues NO statement against the ingredient knowledge base — no sweep targets a phrase', async () => {
        const control = createFakeDb();
        seedRemoved(control, REMOVED_A);

        await eraseRecipeRows(control.db, OWNER, []);

        const statements = control.statements();

        // ⚠️ Non-vacuity FIRST. `every` over an empty list is `true`, so a `createFakeDb` that recorded
        // nothing would report this suite green while proving nothing at all.
        expect(statements.length).toBeGreaterThan(5);

        for (const table of [
            'ingredient_resolution_mappings',
            'ingredient_resolution_memos',
            'ingredient_parse_corrections',
        ]) {
            expect(
                statements.filter((s) => new RegExp(table, 'i').test(s.text)),
                `${table} is retained by owner ruling 2026-08-25 (ADR-0027) — its user_id is a distinct-user ` +
                    'counter and an authorization predicate, not an erasure predicate',
            ).toEqual([]);
        }
    });

    it('⛔ leaves the phrase columns alone — nothing NULLs source_phrase or source_line', async () => {
        const control = createFakeDb();
        seedRemoved(control, REMOVED_A);

        await eraseRecipeRows(control.db, OWNER, []);

        const statements = control.statements();

        expect(statements.length).toBeGreaterThan(5);

        // ⛔ Column-level, not table-level, because that is the shape a re-introduction would take: a new
        // sweep would more likely arrive as a phrase-nulling `SET` inside an existing statement than as a
        // whole new `UPDATE` against a table this suite already forbids.
        for (const statement of statements) {
            expect(statement.text).not.toMatch(/source_phrase\s*=\s*NULL/i);
            expect(statement.text).not.toMatch(/source_line\s*=\s*NULL/i);
        }
    });

    it('deletes from the shared ingredients table ONLY behind the owner + unreferenced predicates (U11)', async () => {
        // REWRITTEN for plan U11/R20 (this test used to forbid ANY delete here): step 13 now removes the
        // dead author's PRIVATE-food rows, so the guard proves the new shape instead — every DELETE that
        // touches `ingredients` must carry BOTH the `food_owner_id` scope and the reference check. A bare
        // `DELETE FROM ingredients`, or one missing either predicate, is still the catastrophic statement
        // this test exists to forbid. The behavioural half (referenced rows survive, `food_owner_id`
        // intact) is proven against a real database in `privateFoodErasure.integration.test.ts`.
        const control = createFakeDb();
        seedRemoved(control, REMOVED_A);

        await eraseRecipeRows(control.db, OWNER, []);

        const touching = control.statements().filter((statement) => /delete from ingredients\b/i.test(statement.text));

        expect(touching).toHaveLength(1);
        expect(touching[0]?.text).toMatch(/food_owner_id\s*=\s*\$\d/i);
        expect(touching[0]?.text).toMatch(/not exists/i);
        expect(touching[0]?.text).toMatch(/recipe_ingredients/i);
        expect(touching[0]?.params).toContain(OWNER);
    });

    it('does not hand-delete rows the FK cascade already removes', async () => {
        const control = createFakeDb();
        seedRemoved(control, REMOVED_A);

        await eraseRecipeRows(control.db, OWNER, []);

        const cascaded =
            /delete from (recipe_steps|recipe_ingredients|recipe_photos|recipe_versions|recipe_collections|recipe_version_pending_archives)/i;

        for (const statement of control.statements()) {
            expect(statement.text).not.toMatch(cascaded);
        }
    });

    it('propagates a failure so the transaction rolls back and SQS retries', async () => {
        const control = createFakeDb();
        // 0 flip, 1 removed-SELECT — fail the flip so the whole tx rolls back.
        control.failExecuteAt(0, new Error('deadlock detected'));

        await expect(eraseRecipeRows(control.db, OWNER, [])).rejects.toThrow('deadlock detected');
    });
});

describe('erasure job lifecycle', () => {
    describe('claimErasureJob', () => {
        it('claims the single active job for the owner, counts the attempt, and reads back the election + captured removed set', async () => {
            const control = createFakeDb();
            control.enqueue({ rows: [{ id: 'job-1', publishRecipeIds: ['rec-donate'], removedRecipeIds: null }] });

            const job = await claimErasureJob(control.db, OWNER);

            expect(job).toEqual({ id: 'job-1', publishRecipeIds: ['rec-donate'], removedRecipeIds: null });

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
            // The claim reads the DURABLE election (source of truth, not the message) AND the removed set a
            // prior attempt captured (for crash-convergence) — both back off the row it claims.
            expect(statement?.text).toMatch(/returning id/i);
            expect(statement?.text).toMatch(/publish_recipe_ids as "publishrecipeids"/i);
            expect(statement?.text).toMatch(/removed_recipe_ids as "removedrecipeids"/i);
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

describe('eraseRecipeObjects (CR-002 / U3a — per-removed-recipe sweep)', () => {
    /** The removed recipe whose object subtree is swept — the per-recipe prefix `recipes/{owner}/{recipe}/`. */
    const REC = '00000000-0000-4000-8000-0000000000f1';
    const PFX = `recipes/01JOWNER/${REC}/`;

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

    it('sweeps ONE recipe’s prefix (recipes/{owner}/{recipe}/), not the owner prefix, and returns the count', async () => {
        const send = vi
            .fn()
            .mockResolvedValueOnce({
                Contents: [{ Key: `${PFX}photos/a.jpg` }, { Key: `${PFX}versions/1.json` }],
                IsTruncated: false,
            })
            .mockResolvedValueOnce(deleteOk(`${PFX}photos/a.jpg`, `${PFX}versions/1.json`));

        const deleted = await eraseRecipeObjects(asClient(send), 'media-bucket', '01JOWNER', REC);

        expect(deleted).toBe(2);
        expect(send).toHaveBeenCalledTimes(2);
        expect(commandName(send.mock.calls[0][0])).toBe('ListObjectsV2');
        // THE scoping assertion: the prefix is the per-RECIPE prefix, so a KEPT recipe's media (under a
        // sibling `recipes/{owner}/{keptRecipe}/`) is never listed or deleted. Sweeping `recipes/{owner}/`
        // would delete it — the mutation this pins.
        expect(listInput(send.mock.calls[0][0])).toMatchObject({
            Bucket: 'media-bucket',
            Prefix: PFX,
            ContinuationToken: undefined,
        });
        expect(commandName(send.mock.calls[1][0])).toBe('DeleteObjects');
        expect(deleteKeys(send.mock.calls[1][0])).toEqual([`${PFX}photos/a.jpg`, `${PFX}versions/1.json`]);
    });

    it('returns 0 and issues no delete when the prefix is empty (Contents absent)', async () => {
        const send = vi.fn().mockResolvedValueOnce({ IsTruncated: false });

        const deleted = await eraseRecipeObjects(asClient(send), 'media-bucket', '01JOWNER', REC);

        expect(deleted).toBe(0);
        expect(send).toHaveBeenCalledTimes(1);
        expect(commandName(send.mock.calls[0][0])).toBe('ListObjectsV2');
    });

    it('refuses a blank owner rather than sweeping an unscoped prefix', async () => {
        const send = vi.fn();

        await expect(eraseRecipeObjects(asClient(send), 'media-bucket', '', REC)).rejects.toThrow(/ownerId/);
        expect(send).not.toHaveBeenCalled();
    });

    it('refuses a blank recipe id rather than collapsing toward the owner-wide prefix (would delete KEPT media)', async () => {
        const send = vi.fn();

        // A blank recipeId would widen the sweep toward `recipes/{owner}/`, deleting a surviving public
        // recipe's photos — the exact regression the scoped sweep prevents. Refuse it.
        await expect(eraseRecipeObjects(asClient(send), 'media-bucket', '01JOWNER', '')).rejects.toThrow(/recipeId/);
        expect(send).not.toHaveBeenCalled();
    });

    it('throws when S3 reports per-key delete errors — a 200 with Errors is NOT success', async () => {
        const send = vi
            .fn()
            .mockResolvedValueOnce({
                Contents: [{ Key: `${PFX}photos/a.jpg` }, { Key: `${PFX}photos/locked.jpg` }],
                IsTruncated: false,
            })
            .mockResolvedValueOnce({
                Deleted: [{ Key: `${PFX}photos/a.jpg` }],
                Errors: [{ Key: `${PFX}photos/locked.jpg`, Code: 'AccessDenied', Message: 'Access Denied' }],
            });

        await expect(eraseRecipeObjects(asClient(send), 'media-bucket', '01JOWNER', REC)).rejects.toThrow(
            /AccessDenied/,
        );
    });

    it('names the bucket and a failed key when a batch delete partially fails', async () => {
        const send = vi
            .fn()
            .mockResolvedValueOnce({ Contents: [{ Key: `${PFX}photos/locked.jpg` }], IsTruncated: false })
            .mockResolvedValueOnce({
                Errors: [{ Key: `${PFX}photos/locked.jpg`, Code: 'AccessDenied', Message: 'Access Denied' }],
            });

        await expect(eraseRecipeObjects(asClient(send), 'archive-bucket', '01JOWNER', REC)).rejects.toThrow(
            /archive-bucket/,
        );
    });

    it('treats an empty Errors array as a clean success', async () => {
        const send = vi
            .fn()
            .mockResolvedValueOnce({ Contents: [{ Key: `${PFX}photos/a.jpg` }], IsTruncated: false })
            .mockResolvedValueOnce({ Deleted: [{ Key: `${PFX}photos/a.jpg` }], Errors: [] });

        await expect(eraseRecipeObjects(asClient(send), 'media-bucket', '01JOWNER', REC)).resolves.toBe(1);
    });

    it('skips keyless list entries and never sends an empty delete batch', async () => {
        const send = vi
            .fn()
            .mockResolvedValueOnce({
                Contents: [{ Key: undefined }, { Key: `${PFX}photos/only.jpg` }, {}],
                IsTruncated: false,
            })
            .mockResolvedValueOnce(deleteOk(`${PFX}photos/only.jpg`));

        const deleted = await eraseRecipeObjects(asClient(send), 'media-bucket', '01JOWNER', REC);

        expect(deleted).toBe(1);
        expect(deleteKeys(send.mock.calls[1][0])).toEqual([`${PFX}photos/only.jpg`]);
    });

    it('does not issue a delete for a page whose entries are all keyless', async () => {
        const send = vi.fn().mockResolvedValueOnce({ Contents: [{ Key: undefined }, {}], IsTruncated: false });

        const deleted = await eraseRecipeObjects(asClient(send), 'media-bucket', '01JOWNER', REC);

        expect(deleted).toBe(0);
        expect(send).toHaveBeenCalledTimes(1);
        expect(commandName(send.mock.calls[0][0])).toBe('ListObjectsV2');
    });

    it('follows the continuation token across pages and aggregates the total deleted', async () => {
        const pages = [
            {
                Contents: [{ Key: `${PFX}photos/p1a` }, { Key: `${PFX}photos/p1b` }],
                IsTruncated: true,
                NextContinuationToken: 'token-2',
            },
            { Contents: [{ Key: `${PFX}photos/p2a` }], IsTruncated: false },
        ];
        let listCall = 0;
        const send = vi.fn((cmd: { command: string }) =>
            Promise.resolve(cmd.command === 'ListObjectsV2' ? pages[listCall++] : {}),
        );

        const deleted = await eraseRecipeObjects(asClient(send), 'media-bucket', '01JOWNER', REC);

        expect(deleted).toBe(3);
        expect(send).toHaveBeenCalledTimes(4);
        expect(listInput(send.mock.calls[0][0]).ContinuationToken).toBeUndefined();
        expect(listInput(send.mock.calls[2][0]).ContinuationToken).toBe('token-2');
        expect(deleteKeys(send.mock.calls[3][0])).toEqual([`${PFX}photos/p2a`]);
    });

    it('stops (no infinite loop) when a page is truncated but yields no next token', async () => {
        const send = vi
            .fn()
            .mockResolvedValueOnce({
                Contents: [{ Key: `${PFX}photos/a` }],
                IsTruncated: true,
                NextContinuationToken: undefined,
            })
            .mockResolvedValueOnce(deleteOk(`${PFX}photos/a`));

        const deleted = await eraseRecipeObjects(asClient(send), 'media-bucket', '01JOWNER', REC);

        expect(deleted).toBe(1);
        expect(send).toHaveBeenCalledTimes(2);
    });

    it('propagates a downstream S3 failure so the record is retried (no partial success swallowed)', async () => {
        const send = vi.fn().mockRejectedValueOnce(new Error('S3 unavailable'));

        await expect(eraseRecipeObjects(asClient(send), 'media-bucket', '01JOWNER', REC)).rejects.toThrow(
            'S3 unavailable',
        );
    });
});

describe('handler', () => {
    let control: FakeDbControl;

    /**
     * How many statements one {@link eraseRecipeRows} call issues — MEASURED from the function itself in
     * {@link beforeAll} below, because a hand-maintained count is exactly what rotted twice before.
     */
    let eraseStatementCount = 0;

    // A removed recipe the default happy-path seeds, so there is exactly one recipe to sweep per bucket.
    const REMOVED_1 = '00000000-0000-4000-8000-0000000000e1';
    const REMOVED_2 = '00000000-0000-4000-8000-0000000000e2';
    const DONATE = '00000000-0000-4000-8000-00000000cd09';

    /** The claim row shape (RETURNING id + the durable election + any captured removed set). */
    const claimRow = (
        overrides: Partial<{ id: string; publishRecipeIds: string[] | null; removedRecipeIds: string[] | null }> = {},
    ): { rows: unknown[] } => ({
        rows: [{ id: 'job-1', publishRecipeIds: null, removedRecipeIds: null, ...overrides }],
    });

    /**
     * Seed one record's happy path onto the shared FIFO results queue. Execute order per record: claim,
     * then every statement `eraseRecipeRows` issues (the flip first, the removed-SELECT second), then
     * mark-completed. Only the claim and the removed-SELECT need concrete rows; the rest fall back to
     * `{ rows: [] }`, so the padding exists purely to keep the NEXT record's seeding aligned.
     *
     * @param db - The fake db to seed.
     * @param claim - The claim row this record's `claimErasureJob` reads back.
     * @param removedIds - The recipe ids this record's removed-SELECT returns.
     * @param trailing - Extra fillers a caller needs after mark-completed.
     * @sideEffect Enqueues results onto the fake db's shared queue.
     */
    const seedRecord = (db: FakeDbControl, claim: { rows: unknown[] }, removedIds: string[], trailing = 0): void => {
        db.enqueue(claim); // claim
        db.enqueue({ rows: [] }); // flip
        db.enqueue({ rows: removedIds.map((id) => ({ id })) }); // removed-SELECT

        // The remaining erase statements, plus mark-completed, plus whatever the caller asked for.
        //
        // ⛔ MEASURED, never counted by hand. This padding used to be a literal, and it rotted TWICE — 8→9
        // when U14 added the knowledge-base sweep, 9→10 when 0026 added the memo sweep beside it. The FakeDb
        // serves ONE positional queue, so a stale count silently STARVES THE NEXT RECORD: its removed-SELECT
        // consumes the previous record's leftover padding and returns nothing, and the only symptom is two
        // missing S3 prefixes in one assertion three hundred lines away. A literal cannot detect that the
        // statement list grew; `eraseStatementCount` asks the function itself.
        for (let i = 0; i < eraseStatementCount - 1 + trailing; i += 1) {
            db.enqueue({ rows: [] });
        }
    };

    beforeAll(async () => {
        // Probe the real function against a throwaway fake: the removed-SELECT returns nothing, so no S3
        // work follows, and what is left is the statement count this suite's positional seeding depends on.
        const probe = createFakeDb();

        await eraseRecipeRows(probe.db, OWNER, []);
        eraseStatementCount = probe.statements().length;

        expect(
            eraseStatementCount,
            'the probe issued no statements — the padding would be meaningless',
        ).toBeGreaterThan(0);
    });

    beforeEach(() => {
        process.env['RECIPE_MEDIA_BUCKET'] = 'media-bucket';
        process.env['RECIPE_ARCHIVE_BUCKET'] = 'archive-bucket';
        delete process.env['CLOUDFRONT_DISTRIBUTION_ID'];
        control = createFakeDb();
        vi.mocked(getRecipeDbMock).mockReturnValue(control.db as never);
        // Default happy path: one active job, one removed recipe to sweep.
        seedRecord(control, claimRow(), [REMOVED_1]);
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

    it('sweeps EACH removed recipe’s prefix in BOTH the media and the version-archive bucket', async () => {
        await runHandler(makeErasureEvent({ ownerId: OWNER }));

        const listed = s3Send.mock.calls
            .map((call) => listInput(call[0]))
            .filter((input) => input.Prefix !== undefined);

        // verticals-8: version archives live under the SAME per-recipe prefix in a DIFFERENT bucket, so
        // this sweep reaches them. Per REMOVED recipe, never the owner prefix — a KEPT public recipe's
        // photos + version snapshots (under a sibling recipe prefix) must survive.
        expect(listed.map((input) => input.Bucket)).toEqual(['media-bucket', 'archive-bucket']);

        for (const input of listed) {
            expect(input.Prefix).toBe(`recipes/${OWNER}/${REMOVED_1}/`);
        }
    });

    it('flips DONATED recipes using the election from the ROW, not the message (durable row is source of truth)', async () => {
        // The message carries an EMPTY election, but the claimed ROW carries [DONATE]. The flip must use the
        // ROW — so a stale/forged/empty message can neither delete a donated recipe nor donate one the owner
        // did not elect. Mutation: reading the election from the message would flip nothing here.
        const rowControl = createFakeDb();
        seedRecord(rowControl, claimRow({ publishRecipeIds: [DONATE] }), [REMOVED_1]);
        vi.mocked(getRecipeDbMock).mockReturnValue(rowControl.db as never);

        await runHandler(makeErasureEvent({ ownerId: OWNER, publishRecipeIds: [] }));

        const flip = rowControl.statements().find((s) => /update recipes set visibility/i.test(s.text));
        expect(flip?.params).toEqual([JSON.stringify([DONATE]), OWNER]);
    });

    describe('CDN invalidation (HAZ-051/067/039)', () => {
        it('invalidates the owner’s wildcard media-prefix path LAST — strictly after BOTH S3 sweeps', async () => {
            await runHandler(makeErasureEvent({ ownerId: OWNER }));

            expect(cdnInvalidate).toHaveBeenCalledTimes(1);
            // ONE owner-prefix wildcard path (not one per removed recipe): it costs the same single path
            // regardless of how many recipes were removed, and harmlessly over-purges a kept recipe's edge
            // cache (which re-caches from origin). The archive bucket is never invalidated.
            expect(cdnInvalidate).toHaveBeenCalledWith([`/recipes/${OWNER}/*`]);

            const sweeps = timeline.filter((entry) => entry === 's3');
            const cdnIndex = timeline.indexOf('cdn');
            const lastSweepIndex = timeline.lastIndexOf('s3');

            // Both real-data sweeps — media AND archive (for the one removed recipe) — ran.
            expect(sweeps).toHaveLength(2);
            expect(cdnIndex).toBeGreaterThanOrEqual(0);
            // Finding 1 (HAZ-051/067): the CDN purge is a best-effort edge-cache hygiene step and must
            // NEVER gate real data deletion, so it is ordered strictly after ALL S3 sweeps.
            expect(cdnIndex).toBeGreaterThan(lastSweepIndex);
        });

        it('builds the CDN port from CLOUDFRONT_DISTRIBUTION_ID (the config the adapter itself gates on)', async () => {
            process.env['CLOUDFRONT_DISTRIBUTION_ID'] = 'E1234567890';

            await runHandler(makeErasureEvent({ ownerId: OWNER }));

            expect(createCloudFrontInvalidationMock).toHaveBeenCalledWith(
                expect.objectContaining({ distributionId: 'E1234567890' }),
            );
        });

        it('a CDN invalidation failure does NOT prevent the archive sweep — real data deletion is never gated on the CDN purge (Finding 1)', async () => {
            cdnInvalidate.mockRejectedValueOnce(new Error('CloudFront throttled'));

            await expect(runHandler(makeErasureEvent({ ownerId: OWNER }))).rejects.toThrow('CloudFront throttled');

            const annotation = control.statements().find((s) => /last_error/i.test(s.text));
            expect(annotation?.params[0]).toContain('CloudFront throttled');
            expect(control.statements().some((s) => /status = 'completed'/i.test(s.text))).toBe(false);
            // Both S3 sweeps already ran by the time the CDN call (issued LAST) can fail — so a CDN
            // misconfiguration never orphans the archive bucket's PII.
            expect(timeline.filter((entry) => entry === 's3')).toHaveLength(2);
            expect(cdnInvalidate).toHaveBeenCalledTimes(1);
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
        // Rows first, then objects: the reachable DB copy of the personal data goes first, and the removed
        // id set is captured on the row inside the delete transaction, so a crash before the sweep still
        // converges (the redelivery reads the captured ids back). The reverse order would leave live rows
        // pointing at objects that no longer exist.
        expect(deleteRecipes).toBeLessThan(firstSweep);
        expect(deleteCollections).toBeLessThan(firstSweep);
    });

    it('marks the job completed only AFTER both buckets are swept', async () => {
        await runHandler(makeErasureEvent({ ownerId: OWNER }));

        const completed = timelineIndex(/^db:update account_erasure_jobs set status = 'completed'/i);
        const sweeps = timeline.filter((entry) => entry === 's3');

        expect(completed).toBeGreaterThanOrEqual(0);
        expect(control.statements().find((s) => /status = 'completed'/i.test(s.text))?.params).toEqual(['job-1']);
        expect(sweeps).toHaveLength(2);
        expect(timeline.lastIndexOf('s3')).toBeLessThan(completed);
        expect(timeline.lastIndexOf('cdn')).toBeLessThan(completed);
    });

    it('claims the job before doing any destructive work', async () => {
        await runHandler(makeErasureEvent({ ownerId: OWNER }));

        const statements = control.statements();

        expect(statements[0]?.text).toMatch(/update account_erasure_jobs/i);
        expect(statements[0]?.text).toMatch(/status = 'running'/i);
    });

    it('converges on a crash replay: sweeps the CAPTURED removed set even after the rows are gone (U3a)', async () => {
        // A redelivery of a still-`running` job AFTER the erase transaction committed: the rows are already
        // deleted, so the removed-SELECT returns EMPTY — but the claim reads back the removed set captured
        // on the row by the first attempt, and the sweep uses THAT. Without the capture, the removed
        // recipes' S3 objects would be orphaned forever. This is the mutation that proves convergence.
        const replay = createFakeDb();
        seedRecord(replay, claimRow({ removedRecipeIds: [REMOVED_1] }), []); // removed-SELECT empty; row carries the set
        vi.mocked(getRecipeDbMock).mockReturnValue(replay.db as never);

        await runHandler(makeErasureEvent({ ownerId: OWNER }));

        const prefixes = s3Send.mock.calls.map((call) => listInput(call[0]).Prefix);
        expect(prefixes).toEqual([`recipes/${OWNER}/${REMOVED_1}/`, `recipes/${OWNER}/${REMOVED_1}/`]);
    });

    it('is a clean no-op over an already-erased owner (completed replay: no re-sweep, no second completion)', async () => {
        // No ACTIVE job (the previous delivery completed it) but a `completed` row exists for this owner —
        // the interlock authorizes the idempotent replay. The removed recipes were already swept on the
        // original completion, so a completed replay sweeps NOTHING (there is no active row to read the
        // captured set from) and marks nothing completed a second time.
        const replayControl = createFakeDb();
        replayControl.enqueue({ rows: [] }); // claim: no active row
        replayControl.enqueue({ rows: [{ exists: 1 }] }); // interlock: a (completed) row exists for the owner
        vi.mocked(getRecipeDbMock).mockReturnValue(replayControl.db as never);

        await expect(runHandler(makeErasureEvent({ ownerId: OWNER }))).resolves.toBeUndefined();

        // No active job → no captured set to read → the fresh removed-SELECT is empty → nothing to sweep.
        expect(s3Send).not.toHaveBeenCalled();

        for (const statement of replayControl.statements()) {
            expect(statement.text).not.toMatch(/status = 'completed'/i);
        }
    });

    it('refuses to erase and issues NO destructive work when no job row exists for the owner in THIS DB', async () => {
        // The interlock: a claim returns nothing AND no row of any status exists for the owner in this
        // database. That is a MISROUTED message, not a replay. The worker must refuse: no DELETE, no S3 sweep.
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
        expect(control.statements().some((s) => /status = 'completed'/i.test(s.text))).toBe(false);
    });

    it('surfaces the ORIGINAL failure even when recording last_error also fails', async () => {
        const failing = createFakeDb();
        failing.enqueue(claimRow()); // 0 = claim
        // 1 = flip (first erase statement) fails → whole erase tx rolls back; 2 = the last_error annotation.
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

    it('processes every record in a multi-record batch, sweeping each owner’s removed recipe', async () => {
        const multi = createFakeDb();
        // The FakeDb serves ONE global results queue, so seed both records in order. Each record consumes:
        // claim + eraseRecipeRows' 10 statements + mark-completed = 12 executes; the removed-SELECT (execute
        // 2 within the record) must return that record's removed recipe.
        seedRecord(multi, claimRow({ id: 'job-1' }), [REMOVED_1]); // record 1 (12 executes)
        seedRecord(multi, claimRow({ id: 'job-2' }), [REMOVED_2]); // record 2 (12 executes)
        vi.mocked(getRecipeDbMock).mockReturnValue(multi.db as never);

        await runHandler(makeErasureEvent({ ownerId: OWNER }, { ownerId: OWNER_2 }));

        const prefixes = s3Send.mock.calls.map((call) => listInput(call[0]).Prefix);
        expect(prefixes).toEqual([
            `recipes/${OWNER}/${REMOVED_1}/`,
            `recipes/${OWNER}/${REMOVED_1}/`,
            `recipes/${OWNER_2}/${REMOVED_2}/`,
            `recipes/${OWNER_2}/${REMOVED_2}/`,
        ]);
    });
});
