import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ownerMediaPrefix, recipeVersionArchiveKey } from '@kitchensink/recipe-core';

import type { SQSEvent } from 'aws-lambda';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

// Shared mock for the worker's module-level `new S3Client({})`; the PutObject class echoes its input.
const { s3Send } = vi.hoisted(() => ({ s3Send: vi.fn() }));

vi.mock('@aws-sdk/client-s3', () => ({
    // `function` (not arrow) so `new S3Client({})` at module scope is constructable under the mock.
    S3Client: vi.fn(function () {
        return { send: s3Send };
    }),
    PutObjectCommand: vi.fn(function (input: unknown) {
        return { command: 'PutObject', input };
    }),
}));

const { getRecipeDb } = vi.hoisted(() => ({ getRecipeDb: vi.fn() }));
vi.mock('../../common/db.js', () => ({ getRecipeDb }));

import { getRecipeDb as getRecipeDbMock } from '../../common/db.js';
import {
    handler,
    loadVersionSnapshot,
    ownerErasureRequested,
    parseArchiveMessage,
    snapshotObjectKey,
} from '../versionArchiveWorker.js';
import { makeArchiveEvent, makeArchiveMessage, makeSqsRecord } from '../__fixtures__/messages.js';

type TestHandler = (event: SQSEvent) => Promise<void>;
const runHandler = handler as unknown as TestHandler;

/**
 * REAL ids, replacing the mnemonic `'own'` / `'rec'` / `'v1'` literals this suite used to carry.
 *
 * `parseArchiveMessage` now validates the message body, so a mnemonic id no longer reaches the code under test:
 * it is rejected at the boundary and every assertion below it becomes untestable. The names are kept meaningful
 * so the cases stay readable, and the two id FAMILIES are honoured, because they differ per column —
 * `recipes.id` / `recipe_versions.id` are `uuid`, while `owner_id` / `created_by` hold identity's ULID.
 *
 * `OWNER_LIVE` and `OWNER_ERASED` avoid `I`, `L`, `O` and `U`: Crockford base32 excludes them, so a literal
 * spelling out `LIVE` would not be a ULID at all.
 */
const OWNER = '01J0000000000000000000WN00';
const OWNER_ERASED = '01J00000000000000000ER5ED0';
const OWNER_LIVE = '01J000000000000000000V1E00';
const RECIPE = '00000000-0000-4000-8000-0000000000c1';
const VERSION_1 = '00000000-0000-4000-8000-000000000101';
const VERSION_2 = '00000000-0000-4000-8000-000000000102';
const VERSION_9 = '00000000-0000-4000-8000-000000000109';
/** A version id that intentionally has no row — the `loadVersionSnapshot` not-found path. */
const VERSION_GONE = '00000000-0000-4000-8000-0000000009ff';

interface PutInput {
    Bucket: string;
    Key: string;
    ContentType: string;
    Body: string;
}
const putInput = (call: unknown): PutInput => (call as { input: PutInput }).input;

const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

beforeEach(() => {
    vi.clearAllMocks();
});

describe('snapshotObjectKey', () => {
    it('builds the deterministic owner/recipe/version archive key from the version NUMBER', () => {
        const key = snapshotObjectKey(makeArchiveMessage({ ownerId: OWNER, recipeId: RECIPE, versionNumber: 3 }));

        // ARCH-BE-3: keyed by the client-facing number, matching what recipe-service writes inline.
        expect(key).toBe(`recipes/${OWNER}/${RECIPE}/versions/3.json`);
    });

    it('is deterministic and distinct per version', () => {
        const message = makeArchiveMessage({ ownerId: OWNER, recipeId: RECIPE, versionNumber: 1 });

        expect(snapshotObjectKey(message)).toBe(snapshotObjectKey(message));
        expect(snapshotObjectKey(message)).not.toBe(snapshotObjectKey({ ...message, versionNumber: 2 }));
    });

    it('keys the archive identically to recipe-service (one scheme, ARCH-BE-3)', () => {
        // The regression this pins: the worker and the service must never key the same snapshot to two
        // different objects. Both now route through the shared recipeVersionArchiveKey.
        const message = makeArchiveMessage({ ownerId: OWNER, recipeId: RECIPE, versionNumber: 7 });

        expect(snapshotObjectKey(message)).toBe(
            recipeVersionArchiveKey({ ownerId: OWNER, recipeId: RECIPE, versionNumber: 7 }),
        );
    });

    it('places the archive under the owner erasure prefix (verticals-8)', () => {
        const message = makeArchiveMessage({ ownerId: OWNER, recipeId: RECIPE, versionNumber: 2 });

        expect(snapshotObjectKey(message).startsWith(ownerMediaPrefix(OWNER))).toBe(true);
    });
});

describe('parseArchiveMessage', () => {
    it('shapes a valid SQS body into a typed archive message', () => {
        const record = makeSqsRecord(
            JSON.stringify({
                recipeId: RECIPE,
                versionId: VERSION_1,
                versionNumber: 1,
                ownerId: OWNER,
                requestedAt: '2026-07-10T00:00:00.000Z',
            }),
        );

        expect(parseArchiveMessage(record)).toEqual({
            recipeId: RECIPE,
            versionId: VERSION_1,
            versionNumber: 1,
            ownerId: OWNER,
            requestedAt: '2026-07-10T00:00:00.000Z',
        });
    });

    it('throws on an unparseable body', () => {
        expect(() => parseArchiveMessage(makeSqsRecord('nope'))).toThrow(SyntaxError);
    });

    /**
     * THE WIRING PROOF. The cases above all feed VALID messages, so they pass whether or not the body is
     * validated — deleting the `.parse` call left all 25 of them green, which is exactly the coverage-theatre
     * this repo's testing standard forbids. These cases fail the moment `parseArchiveMessage` goes back to
     * casting, because a cast cannot reject anything.
     */
    describe('rejects a signature-less, shape-invalid body (the mutation guard)', () => {
        const bodyWith = (overrides: Record<string, unknown>): string =>
            JSON.stringify({
                recipeId: RECIPE,
                versionId: VERSION_1,
                versionNumber: 1,
                ownerId: OWNER,
                requestedAt: '2026-07-10T00:00:00.000Z',
                ...overrides,
            });

        it.each([
            // The GDPR case: this owner matches no erasure row, so the resurrection guard returns false and
            // the worker would archive under a prefix no erasure sweep scans.
            ['an ownerId that is not a ULID', { ownerId: 'anything-at-all' }],
            ['an ownerId that escapes the prefix', { ownerId: '../../other-owner' }],
            ['a missing ownerId', { ownerId: undefined }],
            ['a versionId that is not a UUID', { versionId: 'v1' }],
            ['a missing recipeId', { recipeId: undefined }],
            ['a zero versionNumber', { versionNumber: 0 }],
            ['a versionNumber above int4', { versionNumber: 2_147_483_648 }],
        ])('rejects %s', (_label, overrides) => {
            expect(() => parseArchiveMessage(makeSqsRecord(bodyWith(overrides)))).toThrow();
        });
    });
});

/** A `recipe_versions` row as the raw driver hands it back, with an overridable shape. */
function makeVersionRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: VERSION_1,
        recipe_id: RECIPE,
        version_number: 3,
        snapshot: { version: 3, title: 'Soup', description: '', steps: [], ingredients: [] },
        base_version: 2,
        s3_key: null,
        created_by: OWNER,
        change_summary: 'tweaked salt',
        created_at: new Date('2026-07-10T08:30:00.000Z'),
        ...overrides,
    };
}

/** A schema-less Drizzle stub whose `execute` returns one queued result per call. */
function dbReturning(...results: unknown[]): { execute: ReturnType<typeof vi.fn> } {
    const execute = vi.fn();

    for (const rows of results) {
        execute.mockResolvedValueOnce({ rows });
    }

    execute.mockResolvedValue({ rows: [] });

    return { execute };
}

describe('loadVersionSnapshot', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('serializes the row into the RecipeVersion archive body — snapshot INCLUDED', async () => {
        const db = dbReturning([makeVersionRow()]);
        const message = makeArchiveMessage({ ownerId: OWNER, recipeId: RECIPE, versionId: VERSION_1 });

        const snapshot = await loadVersionSnapshot(db as never, message);

        // The regression this pins: the previous stub returned {recipeId, versionId, ownerId,
        // archivedAt} and NO snapshot, so the worker would have archived an empty envelope while
        // reporting success — losing the version it claimed to save. The body must carry the snapshot.
        expect(snapshot.snapshot).toEqual({
            version: 3,
            title: 'Soup',
            description: '',
            steps: [],
            ingredients: [],
        });
        expect(snapshot).toMatchObject({
            id: VERSION_1,
            recipeId: RECIPE,
            versionNumber: 3,
            baseVersion: 2,
            createdBy: OWNER,
            changeSummary: 'tweaked salt',
        });
        expect(snapshot.createdAt).toMatch(ISO_8601);
    });

    it('omits absent optional columns rather than emitting nulls', async () => {
        const db = dbReturning([makeVersionRow({ base_version: null, s3_key: null, change_summary: null })]);

        const snapshot = await loadVersionSnapshot(db as never, makeArchiveMessage());

        expect(snapshot).not.toHaveProperty('baseVersion');
        expect(snapshot).not.toHaveProperty('s3Key');
        expect(snapshot).not.toHaveProperty('changeSummary');
    });

    it('THROWS when the version row is gone rather than archiving an empty body', async () => {
        const db = dbReturning([]);

        // The row IS the payload. If it has vanished, there is nothing to archive — failing loudly
        // makes SQS retry and then DLQ it, instead of writing a bogus object and pruning nothing.
        await expect(loadVersionSnapshot(db as never, makeArchiveMessage({ versionId: VERSION_GONE }))).rejects.toThrow(
            new RegExp(VERSION_GONE),
        );
    });
});

describe('ownerErasureRequested', () => {
    const dialect = new PgDialect();

    /** A db stub that captures the rendered SQL of the single `execute` and returns one result. */
    function capturingDb(rows: unknown[]): {
        db: { execute: ReturnType<typeof vi.fn> };
        rendered: () => { text: string; params: readonly unknown[] };
    } {
        let captured: SQL | undefined;
        const execute = vi.fn().mockImplementation((statement: SQL) => {
            captured = statement;

            return Promise.resolve({ rows });
        });

        return {
            db: { execute },
            rendered: () => {
                const { sql: text, params } = dialect.sqlToQuery(captured!);

                return { text: text.replace(/\s+/g, ' ').trim(), params };
            },
        };
    }

    it('reports TRUE when an erasure job exists for the owner', async () => {
        const { db } = capturingDb([{ erased: true }]);

        expect(await ownerErasureRequested(db as never, OWNER)).toBe(true);
    });

    it('reports FALSE when no erasure job exists for the owner', async () => {
        const { db } = capturingDb([{ erased: false }]);

        expect(await ownerErasureRequested(db as never, OWNER)).toBe(false);
    });

    it('reports FALSE when the query returns no row at all (defensive, not a throw)', async () => {
        const { db } = capturingDb([]);

        expect(await ownerErasureRequested(db as never, OWNER)).toBe(false);
    });

    it('scopes the existence check to the passed owner id against account_erasure_jobs', async () => {
        // The owner-scoping is the whole safety property: a different owner's erasure must not be able to
        // answer this query. Render the real SQL and assert the predicate the database will evaluate — a
        // dropped `WHERE owner_id = $1` or a hard-coded owner cannot pass this.
        const { db, rendered } = capturingDb([{ erased: false }]);

        await ownerErasureRequested(db as never, '01JOWNER-UNDER-ERASURE');

        const { text, params } = rendered();
        expect(text).toMatch(/from account_erasure_jobs where owner_id = \$1/i);
        expect(params).toEqual(['01JOWNER-UNDER-ERASURE']);
    });

    it('propagates a DB error rather than defaulting to "no erasure"', async () => {
        // A swallowed error read as `false` would let a suppressed PUT slip through during an erasure.
        const execute = vi.fn().mockRejectedValue(new Error('connection terminated'));

        await expect(ownerErasureRequested({ execute } as never, OWNER)).rejects.toThrow('connection terminated');
    });
});

describe('handler', () => {
    let dbExecute: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        process.env['RECIPE_ARCHIVE_BUCKET'] = 'archive-bucket';
        dbExecute = vi.fn().mockResolvedValue({ rows: [makeVersionRow()] });
        vi.mocked(getRecipeDbMock).mockReturnValue({ execute: dbExecute } as never);
        s3Send.mockResolvedValue({});
    });

    afterEach(() => {
        delete process.env['RECIPE_ARCHIVE_BUCKET'];
    });

    it('touches NEITHER the database nor S3 when the message is shape-invalid', async () => {
        // The end-to-end statement of the guard: an invalid owner id must be refused BEFORE the worker opens a
        // connection or writes an object — not merely produce a wrong key. This is the case that reds if the
        // boundary parse is removed, and it is deliberately asserted on the SINKS rather than on the throw,
        // because "it threw" would still pass if the throw happened after the PUT.
        await expect(runHandler(makeArchiveEvent({ ownerId: 'not-a-ulid' }))).rejects.toThrow();

        expect(s3Send).not.toHaveBeenCalled();
        expect(dbExecute).not.toHaveBeenCalled();
    });

    it('writes a JSON snapshot to the deterministic key for each record', async () => {
        await runHandler(
            makeArchiveEvent(
                { ownerId: OWNER, recipeId: RECIPE, versionId: VERSION_1, versionNumber: 1 },
                { ownerId: OWNER, recipeId: RECIPE, versionId: VERSION_2, versionNumber: 2 },
            ),
        );

        expect(getRecipeDbMock).toHaveBeenCalledTimes(2);
        expect(s3Send).toHaveBeenCalledTimes(2);

        const first = putInput(s3Send.mock.calls[0][0]);
        expect(first.Bucket).toBe('archive-bucket');
        expect(first.Key).toBe(`recipes/${OWNER}/${RECIPE}/versions/1.json`);
        expect(first.ContentType).toBe('application/json');
        // The body is the RecipeVersion wire contract — the SAME shape recipe-service PUT inline before
        // T130 relocated the write here, so an archive means the same thing before and after the cutover.
        const body = JSON.parse(first.Body) as { recipeId: string; createdBy: string; snapshot: unknown };
        expect(body).toMatchObject({ recipeId: RECIPE, createdBy: OWNER });
        // The snapshot is read verbatim off `recipe_versions.snapshot` (loadVersionSnapshot) — assert the
        // actual value from the mocked row, not merely that some snapshot field exists. This is the exact
        // failure the previous stub had: an envelope with no snapshot that still reported success.
        expect(body.snapshot).toEqual({ version: 3, title: 'Soup', description: '', steps: [], ingredients: [] });

        expect(putInput(s3Send.mock.calls[1][0]).Key).toBe(`recipes/${OWNER}/${RECIPE}/versions/2.json`);
    });

    it('fails fast when RECIPE_ARCHIVE_BUCKET is unset — before touching the DB or S3', async () => {
        delete process.env['RECIPE_ARCHIVE_BUCKET'];

        await expect(runHandler(makeArchiveEvent({ versionId: VERSION_1 }))).rejects.toThrow(/RECIPE_ARCHIVE_BUCKET/);
        expect(getRecipeDbMock).not.toHaveBeenCalled();
        expect(s3Send).not.toHaveBeenCalled();
    });

    it('propagates a poison-message parse failure instead of silently acking it', async () => {
        const event: SQSEvent = { Records: [makeSqsRecord('{broken')] };

        await expect(runHandler(event)).rejects.toThrow(SyntaxError);
    });

    it('propagates an S3 put failure so SQS retries the record', async () => {
        s3Send.mockReset();
        s3Send.mockRejectedValueOnce(new Error('PutObject failed'));

        await expect(runHandler(makeArchiveEvent({ versionId: VERSION_1 }))).rejects.toThrow('PutObject failed');
    });
});

describe('handler — archive-before-prune (FR-007b-i)', () => {
    let order: string[];
    let dbExecute: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        process.env['RECIPE_ARCHIVE_BUCKET'] = 'archive-bucket';
        order = [];
        dbExecute = vi.fn().mockImplementation(async (query: unknown) => {
            const text = JSON.stringify(query);

            if (text.includes('DELETE')) {
                order.push('prune');

                return { rows: [] };
            }

            return { rows: [makeVersionRow()] };
        });
        vi.mocked(getRecipeDbMock).mockReturnValue({ execute: dbExecute } as never);
        s3Send.mockImplementation(async () => {
            order.push('archive');

            return {};
        });
    });

    afterEach(() => {
        delete process.env['RECIPE_ARCHIVE_BUCKET'];
    });

    it('prunes the version from Postgres only AFTER the S3 put resolves', async () => {
        await runHandler(
            makeArchiveEvent({ ownerId: OWNER, recipeId: RECIPE, versionId: VERSION_1, versionNumber: 1 }),
        );

        // The invariant the whole async path rests on. recipe-service stopped pruning at save time
        // (T130) precisely so the row survives until this write confirms; pruning first would destroy
        // the payload AND cascade away the outbox row that records the debt.
        expect(order).toEqual(['archive', 'prune']);
    });

    it('does NOT prune when the S3 put fails — the row must survive for the retry', async () => {
        s3Send.mockRejectedValue(new Error('S3 down'));

        await expect(
            runHandler(makeArchiveEvent({ ownerId: OWNER, recipeId: RECIPE, versionId: VERSION_1, versionNumber: 1 })),
        ).rejects.toThrow('S3 down');

        expect(order).not.toContain('prune');
        // Throwing (rather than swallowing) is what makes SQS redeliver and eventually DLQ the record.
    });
});

describe('handler — GDPR archive-resurrection guard (C-007 / D7)', () => {
    const dialect = new PgDialect();

    /**
     * A schema-less db stub that routes by rendered SQL: the erasure EXISTS check answers with the
     * configured flag, the version SELECT returns a row, and DELETE is recorded as a prune. This is what
     * lets a test assert "PUT suppressed but row still pruned" without a real database.
     */
    function guardDb(ownerHasErasure: boolean): {
        db: { execute: ReturnType<typeof vi.fn> };
        prunedVersionIds: string[];
    } {
        const prunedVersionIds: string[] = [];
        const execute = vi.fn().mockImplementation((statement: SQL) => {
            const { sql: text, params } = dialect.sqlToQuery(statement);
            const normalized = text.toLowerCase();

            if (normalized.includes('account_erasure_jobs')) {
                return Promise.resolve({ rows: [{ erased: ownerHasErasure }] });
            }

            if (normalized.includes('delete from recipe_versions')) {
                prunedVersionIds.push(String(params[0]));

                return Promise.resolve({ rows: [] });
            }

            return Promise.resolve({ rows: [makeVersionRow()] });
        });

        return { db: { execute }, prunedVersionIds };
    }

    beforeEach(() => {
        process.env['RECIPE_ARCHIVE_BUCKET'] = 'archive-bucket';
        s3Send.mockResolvedValue({});
    });

    afterEach(() => {
        delete process.env['RECIPE_ARCHIVE_BUCKET'];
    });

    it('writes the snapshot when the owner has NO erasure job (unchanged path)', async () => {
        const { db, prunedVersionIds } = guardDb(false);
        vi.mocked(getRecipeDbMock).mockReturnValue(db as never);

        await runHandler(
            makeArchiveEvent({ ownerId: OWNER, recipeId: RECIPE, versionId: VERSION_1, versionNumber: 1 }),
        );

        // No erasure on record → behaves exactly as before this guard existed: PUT, then prune.
        expect(s3Send).toHaveBeenCalledTimes(1);
        expect(putInput(s3Send.mock.calls[0][0]).Key).toBe(`recipes/${OWNER}/${RECIPE}/versions/1.json`);
        expect(prunedVersionIds).toEqual([VERSION_1]);
    });

    it('does NOT write the snapshot when the owner has an erasure job on record', async () => {
        const { db } = guardDb(true);
        vi.mocked(getRecipeDbMock).mockReturnValue(db as never);

        await runHandler(
            makeArchiveEvent({ ownerId: OWNER_ERASED, recipeId: RECIPE, versionId: VERSION_1, versionNumber: 1 }),
        );

        // The core assertion: no object is materialised under an erased owner's prefix. Reverting the guard
        // in the worker makes THIS fail — the PUT would fire.
        expect(s3Send).not.toHaveBeenCalled();
    });

    it('still prunes the version row when it suppresses the PUT (clears the outbox debt)', async () => {
        const { db, prunedVersionIds } = guardDb(true);
        vi.mocked(getRecipeDbMock).mockReturnValue(db as never);

        await runHandler(
            makeArchiveEvent({ ownerId: OWNER_ERASED, recipeId: RECIPE, versionId: VERSION_9, versionNumber: 4 }),
        );

        // A suppressed PUT must not leave an un-prunable outbox row that the sweeper re-dispatches forever.
        // The version is pruned (cascading its pending-archive row), consistent with the erasure end state.
        expect(s3Send).not.toHaveBeenCalled();
        expect(prunedVersionIds).toEqual([VERSION_9]);
    });

    it('does NOT suppress the PUT when a DIFFERENT owner is under erasure', async () => {
        // guardDb answers the EXISTS check by the flag, but the real scoping is proven in
        // `ownerErasureRequested` (the rendered `WHERE owner_id = $1`). Here we pin the handler contract:
        // an owner with NO erasure of their own archives normally even while other owners are being erased.
        const { db, prunedVersionIds } = guardDb(false);
        vi.mocked(getRecipeDbMock).mockReturnValue(db as never);

        await runHandler(
            makeArchiveEvent({ ownerId: OWNER_LIVE, recipeId: RECIPE, versionId: VERSION_2, versionNumber: 2 }),
        );

        expect(s3Send).toHaveBeenCalledTimes(1);
        expect(prunedVersionIds).toEqual([VERSION_2]);
    });

    it('checks erasure state AFTER loading the snapshot and BEFORE the PUT (tightest read→PUT window)', async () => {
        const order: string[] = [];
        const execute = vi.fn().mockImplementation((statement: SQL) => {
            const normalized = dialect.sqlToQuery(statement).sql.toLowerCase();

            if (normalized.includes('account_erasure_jobs')) {
                order.push('erasure-check');

                return Promise.resolve({ rows: [{ erased: false }] });
            }

            if (normalized.includes('delete from recipe_versions')) {
                order.push('prune');

                return Promise.resolve({ rows: [] });
            }

            order.push('load');

            return Promise.resolve({ rows: [makeVersionRow()] });
        });
        vi.mocked(getRecipeDbMock).mockReturnValue({ execute } as never);
        s3Send.mockImplementation(async () => {
            order.push('put');

            return {};
        });

        await runHandler(
            makeArchiveEvent({ ownerId: OWNER, recipeId: RECIPE, versionId: VERSION_1, versionNumber: 1 }),
        );

        // load → erasure-check → put → prune. The check must sit immediately before the PUT so the
        // read→PUT window (the residual race surface) is as small as possible.
        expect(order).toEqual(['load', 'erasure-check', 'put', 'prune']);
    });
});
