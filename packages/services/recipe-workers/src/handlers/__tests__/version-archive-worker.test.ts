import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SQSEvent } from 'aws-lambda';

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
import { handler, loadVersionSnapshot, parseArchiveMessage, snapshotObjectKey } from '../version-archive-worker.js';
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
    it('builds the deterministic owner/recipe/version archive key', () => {
        const key = snapshotObjectKey(makeArchiveMessage({ ownerId: 'own', recipeId: 'rec', versionId: 'ver' }));

        expect(key).toBe('recipes/own/rec/versions/ver.json');
    });

    it('is deterministic and distinct per version', () => {
        const message = makeArchiveMessage({ ownerId: 'own', recipeId: 'rec', versionId: 'v1' });

        expect(snapshotObjectKey(message)).toBe(snapshotObjectKey(message));
        expect(snapshotObjectKey(message)).not.toBe(snapshotObjectKey({ ...message, versionId: 'v2' }));
    });
});

describe('parseArchiveMessage', () => {
    it('shapes a valid SQS body into a typed archive message', () => {
        const record = makeSqsRecord(
            JSON.stringify({ recipeId: 'r', versionId: 'v', ownerId: 'o', requestedAt: '2026-07-10T00:00:00.000Z' }),
        );

        expect(parseArchiveMessage(record)).toEqual({
            recipeId: 'r',
            versionId: 'v',
            ownerId: 'o',
            requestedAt: '2026-07-10T00:00:00.000Z',
        });
    });

    it('throws on an unparseable body', () => {
        expect(() => parseArchiveMessage(makeSqsRecord('nope'))).toThrow(SyntaxError);
    });
});

describe('loadVersionSnapshot', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('echoes the message identifiers and stamps an ISO-8601 archivedAt', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-10T08:30:00.000Z'));
        const message = makeArchiveMessage({ ownerId: 'own', recipeId: 'rec', versionId: 'ver' });

        const snapshot = await loadVersionSnapshot({} as never, message);

        expect(snapshot).toEqual({
            recipeId: 'rec',
            versionId: 'ver',
            ownerId: 'own',
            archivedAt: '2026-07-10T08:30:00.000Z',
        });
        expect(snapshot.archivedAt).toMatch(ISO_8601);
    });
});

describe('handler', () => {
    beforeEach(() => {
        process.env['RECIPE_ARCHIVE_BUCKET'] = 'archive-bucket';
        vi.mocked(getRecipeDbMock).mockReturnValue({} as never);
        s3Send.mockResolvedValue({});
    });

    afterEach(() => {
        delete process.env['RECIPE_ARCHIVE_BUCKET'];
    });

    it('writes a JSON snapshot to the deterministic key for each record', async () => {
        await runHandler(
            makeArchiveEvent(
                { ownerId: 'own', recipeId: 'rec', versionId: 'v1' },
                { ownerId: 'own', recipeId: 'rec', versionId: 'v2' },
            ),
        );

        expect(getRecipeDbMock).toHaveBeenCalledTimes(2);
        expect(s3Send).toHaveBeenCalledTimes(2);

        const first = putInput(s3Send.mock.calls[0][0]);
        expect(first.Bucket).toBe('archive-bucket');
        expect(first.Key).toBe('recipes/own/rec/versions/v1.json');
        expect(first.ContentType).toBe('application/json');
        const body = JSON.parse(first.Body) as { recipeId: string; versionId: string; ownerId: string };
        expect(body).toMatchObject({ recipeId: 'rec', versionId: 'v1', ownerId: 'own' });

        expect(putInput(s3Send.mock.calls[1][0]).Key).toBe('recipes/own/rec/versions/v2.json');
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
