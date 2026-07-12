import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { S3Client } from '@aws-sdk/client-s3';
import type { SQSEvent } from 'aws-lambda';

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

import { getRecipeDb as getRecipeDbMock } from '../../common/db.js';
import {
    eraseRecipeObjects,
    eraseRecipeRows,
    handler,
    ownerMediaPrefix,
    parseErasureMessage,
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

beforeEach(() => {
    vi.clearAllMocks();
});

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
        const record = makeErasureRecord({ ownerId: '01JOWNER', requestedAt: '2026-07-10T12:00:00.000Z' });

        expect(parseErasureMessage(record)).toEqual({ ownerId: '01JOWNER', requestedAt: '2026-07-10T12:00:00.000Z' });
    });

    it('throws when the body is not valid JSON (poison message surfaces, not silently swallowed)', () => {
        expect(() => parseErasureMessage(makeSqsRecord('{not json'))).toThrow(SyntaxError);
    });
});

describe('eraseRecipeRows', () => {
    it('is a no-op that resolves for any owner (idempotent replay contract)', async () => {
        await expect(eraseRecipeRows({} as never, '01JOWNER')).resolves.toBeUndefined();
    });
});

describe('eraseRecipeObjects', () => {
    it('deletes every object under the owner prefix in one page and returns the count', async () => {
        const send = vi.fn().mockResolvedValueOnce({
            Contents: [{ Key: 'recipes/01JOWNER/a.jpg' }, { Key: 'recipes/01JOWNER/b.jpg' }],
            IsTruncated: false,
        });

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

    it('skips keyless list entries and never sends an empty delete batch', async () => {
        const send = vi.fn().mockResolvedValueOnce({
            Contents: [{ Key: undefined }, { Key: 'recipes/01JOWNER/only.jpg' }, {}],
            IsTruncated: false,
        });

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
        const send = vi.fn().mockResolvedValueOnce({
            Contents: [{ Key: 'recipes/01JOWNER/a' }],
            IsTruncated: true,
            NextContinuationToken: undefined,
        });

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
    beforeEach(() => {
        process.env['RECIPE_MEDIA_BUCKET'] = 'media-bucket';
        vi.mocked(getRecipeDbMock).mockReturnValue({} as never);
        s3Send.mockResolvedValue({ IsTruncated: false });
    });

    afterEach(() => {
        delete process.env['RECIPE_MEDIA_BUCKET'];
    });

    it('resolves the DB and erases S3 media for each record', async () => {
        await runHandler(makeErasureEvent({ ownerId: 'owner-1' }, { ownerId: 'owner-2' }));

        expect(getRecipeDbMock).toHaveBeenCalledTimes(2);
        const listPrefixes = s3Send.mock.calls.map((call) => listInput(call[0]).Prefix);
        expect(listPrefixes).toEqual(['recipes/owner-1/', 'recipes/owner-2/']);
    });

    it('fails fast when RECIPE_MEDIA_BUCKET is unset — before touching the DB or S3', async () => {
        delete process.env['RECIPE_MEDIA_BUCKET'];

        await expect(runHandler(makeErasureEvent({ ownerId: 'owner-1' }))).rejects.toThrow(/RECIPE_MEDIA_BUCKET/);
        expect(getRecipeDbMock).not.toHaveBeenCalled();
        expect(s3Send).not.toHaveBeenCalled();
    });

    it('propagates a poison-message parse failure instead of silently acking it', async () => {
        const event: SQSEvent = { Records: [makeSqsRecord('{not json')] };

        await expect(runHandler(event)).rejects.toThrow(SyntaxError);
    });

    it('stops on the first record whose S3 erase fails so SQS can retry the batch', async () => {
        s3Send.mockReset();
        s3Send.mockRejectedValueOnce(new Error('S3 down'));

        await expect(runHandler(makeErasureEvent({ ownerId: 'owner-1' }, { ownerId: 'owner-2' }))).rejects.toThrow(
            'S3 down',
        );
        // Second record must not have been processed after the first threw.
        expect(getRecipeDbMock).toHaveBeenCalledTimes(1);
    });
});
