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
} from '../version-archive-worker.js';
import { makeArchiveEvent, makeArchiveMessage, makeSqsRecord } from '../__fixtures__/messages.js';

type TestHandler = (event: SQSEvent) => Promise<void>;
const runHandler = handler as unknown as TestHandler;

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
        const key = snapshotObjectKey(makeArchiveMessage({ ownerId: 'own', recipeId: 'rec', versionNumber: 3 }));

        // ARCH-BE-3: keyed by the client-facing number, matching what recipe-service writes inline.
        expect(key).toBe('recipes/own/rec/versions/3.json');
    });

    it('is deterministic and distinct per version', () => {
        const message = makeArchiveMessage({ ownerId: 'own', recipeId: 'rec', versionNumber: 1 });

        expect(snapshotObjectKey(message)).toBe(snapshotObjectKey(message));
        expect(snapshotObjectKey(message)).not.toBe(snapshotObjectKey({ ...message, versionNumber: 2 }));
    });

    it('keys the archive identically to recipe-service (one scheme, ARCH-BE-3)', () => {
        // The regression this pins: the worker and the service must never key the same snapshot to two
        // different objects. Both now route through the shared recipeVersionArchiveKey.
        const message = makeArchiveMessage({ ownerId: 'own', recipeId: 'rec', versionNumber: 7 });

        expect(snapshotObjectKey(message)).toBe(
            recipeVersionArchiveKey({ ownerId: 'own', recipeId: 'rec', versionNumber: 7 }),
        );
    });

    it('places the archive under the owner erasure prefix (verticals-8)', () => {
        const message = makeArchiveMessage({ ownerId: 'own', recipeId: 'rec', versionNumber: 2 });

        expect(snapshotObjectKey(message).startsWith(ownerMediaPrefix('own'))).toBe(true);
    });
});

describe('parseArchiveMessage', () => {
    it('shapes a valid SQS body into a typed archive message', () => {
        const record = makeSqsRecord(
            JSON.stringify({
                recipeId: 'r',
                versionId: 'v',
                versionNumber: 1,
                ownerId: 'o',
                requestedAt: '2026-07-10T00:00:00.000Z',
            }),
        );

        expect(parseArchiveMessage(record)).toEqual({
            recipeId: 'r',
            versionId: 'v',
            versionNumber: 1,
            ownerId: 'o',
            requestedAt: '2026-07-10T00:00:00.000Z',
        });
    });

    it('throws on an unparseable body', () => {
        expect(() => parseArchiveMessage(makeSqsRecord('nope'))).toThrow(SyntaxError);
    });
});

/** A `recipe_versions` row as the raw driver hands it back, with an overridable shape. */
function makeVersionRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: 'ver',
        recipe_id: 'rec',
        version_number: 3,
        snapshot: { version: 3, title: 'Soup', description: '', steps: [], ingredients: [] },
        base_version: 2,
        s3_key: null,
        created_by: 'own',
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
        const message = makeArchiveMessage({ ownerId: 'own', recipeId: 'rec', versionId: 'ver' });

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
            id: 'ver',
            recipeId: 'rec',
            versionNumber: 3,
            baseVersion: 2,
            createdBy: 'own',
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
        await expect(loadVersionSnapshot(db as never, makeArchiveMessage({ versionId: 'gone' }))).rejects.toThrow(
            /gone/,
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

        expect(await ownerErasureRequested(db as never, 'own')).toBe(true);
    });

    it('reports FALSE when no erasure job exists for the owner', async () => {
        const { db } = capturingDb([{ erased: false }]);

        expect(await ownerErasureRequested(db as never, 'own')).toBe(false);
    });

    it('reports FALSE when the query returns no row at all (defensive, not a throw)', async () => {
        const { db } = capturingDb([]);

        expect(await ownerErasureRequested(db as never, 'own')).toBe(false);
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

        await expect(ownerErasureRequested({ execute } as never, 'own')).rejects.toThrow('connection terminated');
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

    it('writes a JSON snapshot to the deterministic key for each record', async () => {
        await runHandler(
            makeArchiveEvent(
                { ownerId: 'own', recipeId: 'rec', versionId: 'v1', versionNumber: 1 },
                { ownerId: 'own', recipeId: 'rec', versionId: 'v2', versionNumber: 2 },
            ),
        );

        expect(getRecipeDbMock).toHaveBeenCalledTimes(2);
        expect(s3Send).toHaveBeenCalledTimes(2);

        const first = putInput(s3Send.mock.calls[0][0]);
        expect(first.Bucket).toBe('archive-bucket');
        expect(first.Key).toBe('recipes/own/rec/versions/1.json');
        expect(first.ContentType).toBe('application/json');
        // The body is the RecipeVersion wire contract — the SAME shape recipe-service PUT inline before
        // T130 relocated the write here, so an archive means the same thing before and after the cutover.
        const body = JSON.parse(first.Body) as { recipeId: string; createdBy: string; snapshot: unknown };
        expect(body).toMatchObject({ recipeId: 'rec', createdBy: 'own' });
        expect(body.snapshot).toBeDefined();

        expect(putInput(s3Send.mock.calls[1][0]).Key).toBe('recipes/own/rec/versions/2.json');
    });

    it('fails fast when RECIPE_ARCHIVE_BUCKET is unset — before touching the DB or S3', async () => {
        delete process.env['RECIPE_ARCHIVE_BUCKET'];

        await expect(runHandler(makeArchiveEvent({ versionId: 'v1' }))).rejects.toThrow(/RECIPE_ARCHIVE_BUCKET/);
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

        await expect(runHandler(makeArchiveEvent({ versionId: 'v1' }))).rejects.toThrow('PutObject failed');
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
        await runHandler(makeArchiveEvent({ ownerId: 'own', recipeId: 'rec', versionId: 'v1', versionNumber: 1 }));

        // The invariant the whole async path rests on. recipe-service stopped pruning at save time
        // (T130) precisely so the row survives until this write confirms; pruning first would destroy
        // the payload AND cascade away the outbox row that records the debt.
        expect(order).toEqual(['archive', 'prune']);
    });

    it('does NOT prune when the S3 put fails — the row must survive for the retry', async () => {
        s3Send.mockRejectedValue(new Error('S3 down'));

        await expect(
            runHandler(makeArchiveEvent({ ownerId: 'own', recipeId: 'rec', versionId: 'v1', versionNumber: 1 })),
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

        await runHandler(makeArchiveEvent({ ownerId: 'own', recipeId: 'rec', versionId: 'v1', versionNumber: 1 }));

        // No erasure on record → behaves exactly as before this guard existed: PUT, then prune.
        expect(s3Send).toHaveBeenCalledTimes(1);
        expect(putInput(s3Send.mock.calls[0][0]).Key).toBe('recipes/own/rec/versions/1.json');
        expect(prunedVersionIds).toEqual(['v1']);
    });

    it('does NOT write the snapshot when the owner has an erasure job on record', async () => {
        const { db } = guardDb(true);
        vi.mocked(getRecipeDbMock).mockReturnValue(db as never);

        await runHandler(makeArchiveEvent({ ownerId: 'erased', recipeId: 'rec', versionId: 'v1', versionNumber: 1 }));

        // The core assertion: no object is materialised under an erased owner's prefix. Reverting the guard
        // in the worker makes THIS fail — the PUT would fire.
        expect(s3Send).not.toHaveBeenCalled();
    });

    it('still prunes the version row when it suppresses the PUT (clears the outbox debt)', async () => {
        const { db, prunedVersionIds } = guardDb(true);
        vi.mocked(getRecipeDbMock).mockReturnValue(db as never);

        await runHandler(makeArchiveEvent({ ownerId: 'erased', recipeId: 'rec', versionId: 'v9', versionNumber: 4 }));

        // A suppressed PUT must not leave an un-prunable outbox row that the sweeper re-dispatches forever.
        // The version is pruned (cascading its pending-archive row), consistent with the erasure end state.
        expect(s3Send).not.toHaveBeenCalled();
        expect(prunedVersionIds).toEqual(['v9']);
    });

    it('does NOT suppress the PUT when a DIFFERENT owner is under erasure', async () => {
        // guardDb answers the EXISTS check by the flag, but the real scoping is proven in
        // `ownerErasureRequested` (the rendered `WHERE owner_id = $1`). Here we pin the handler contract:
        // an owner with NO erasure of their own archives normally even while other owners are being erased.
        const { db, prunedVersionIds } = guardDb(false);
        vi.mocked(getRecipeDbMock).mockReturnValue(db as never);

        await runHandler(makeArchiveEvent({ ownerId: 'live', recipeId: 'rec', versionId: 'v2', versionNumber: 2 }));

        expect(s3Send).toHaveBeenCalledTimes(1);
        expect(prunedVersionIds).toEqual(['v2']);
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

        await runHandler(makeArchiveEvent({ ownerId: 'own', recipeId: 'rec', versionId: 'v1', versionNumber: 1 }));

        // load → erasure-check → put → prune. The check must sit immediately before the PUT so the
        // read→PUT window (the residual race surface) is as small as possible.
        expect(order).toEqual(['load', 'erasure-check', 'put', 'prune']);
    });
});
