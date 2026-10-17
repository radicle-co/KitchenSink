import type { SQSEvent } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { recordInvalidPayload } from '../../common/invalidPayload.js';
import { handler as archiveHandler } from '../versionArchiveWorker.js';
import { handler as parseHandler } from '../parseLine.js';
import { handler as verifyHandler } from '../verifyLine.js';

vi.mock('../../common/invalidPayload.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../common/invalidPayload.js')>();

    return { ...actual, recordInvalidPayload: vi.fn() };
});

vi.mock('../../common/db.js', () => ({
    getRecipeDb: vi.fn(() => {
        throw new Error('the database must not be reached for an invalid payload');
    }),
    getRecipePool: vi.fn(() => {
        throw new Error('the pool must not be reached for an invalid payload');
    }),
}));

/**
 * AC-018-b requires, for EVERY consumer, a test asserting an invalid payload is not redriven. GR-018 §18-b:
 * "A queue/event consumer that rejects a payload on shape does not return it to the queue for redrive. It
 * records the rejection and completes the message."
 *
 * Every consumer here used to THROW on a shape rejection, which is the redrive this rule forbids: on the
 * parse and verification queues that is twenty deliveries of a message that can never land, and on the
 * verification queue each delivery also passes through the spend gate.
 *
 * ⚠️ The handler is driven with ONE argument. `SQSHandler`'s declared arity allows it, and passing a fake
 * `context` would imply these handlers read one — they do not.
 */
type TestHandler = (event: SQSEvent) => Promise<unknown>;

const junkRecord = (messageId: string) =>
    ({
        messageId,
        receiptHandle: 'rh',
        body: 'not json at all',
        attributes: {},
        messageAttributes: {},
        md5OfBody: '',
        eventSource: 'aws:sqs',
        eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:q',
        awsRegion: 'us-east-1',
    }) as unknown as SQSEvent['Records'][number];

const eventOf = (messageId: string): SQSEvent => ({ Records: [junkRecord(messageId)] });

describe('GR-018 §18-b — an invalid payload completes once, never redriven', () => {
    beforeEach(() => {
        vi.mocked(recordInvalidPayload).mockClear();
        process.env['STAGE'] = 'pr-91';
        process.env['AWS_REGION'] = 'us-east-1';
        process.env['RECIPE_ARCHIVE_BUCKET'] = 'kitchensink-archive-pr-91';
    });

    it('parse completes an unparseable body and records it', async () => {
        await expect((parseHandler as unknown as TestHandler)(eventOf('parse-1'))).resolves.not.toThrow();

        expect(vi.mocked(recordInvalidPayload)).toHaveBeenCalledOnce();
        expect(vi.mocked(recordInvalidPayload).mock.calls[0]?.[0]).toMatchObject({
            queue: 'parse',
            messageId: 'parse-1',
        });
    });

    it('verification completes an unparseable body and records it', async () => {
        await expect((verifyHandler as unknown as TestHandler)(eventOf('verify-1'))).resolves.not.toThrow();

        expect(vi.mocked(recordInvalidPayload).mock.calls[0]?.[0]).toMatchObject({
            queue: 'verification',
            messageId: 'verify-1',
        });
    });

    it('version archive completes an unparseable body and records it', async () => {
        await expect((archiveHandler as unknown as TestHandler)(eventOf('archive-1'))).resolves.not.toThrow();

        expect(vi.mocked(recordInvalidPayload).mock.calls[0]?.[0]).toMatchObject({
            queue: 'archive',
            messageId: 'archive-1',
        });
    });
});
