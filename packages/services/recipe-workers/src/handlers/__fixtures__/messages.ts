import type { SQSEvent, SQSRecord } from 'aws-lambda';

import type { AccountErasureMessage } from '../account-erasure-worker.js';
import type { RecipeVersionArchiveMessage } from '../version-archive-worker.js';

/**
 * Fixture factories for the recipe-workers SQS handlers. Each `make*` accepts a `Partial<T>` of
 * overrides so a test states only the fields it cares about, per the repo fixture convention.
 */

/** A structurally-valid `SQSRecord` with a caller-supplied body. Overrides win over the defaults. */
export const makeSqsRecord = (body: string, overrides: Partial<SQSRecord> = {}): SQSRecord => ({
    messageId: '00000000-0000-4000-8000-000000000000',
    receiptHandle: 'receipt-handle',
    body,
    attributes: {
        ApproximateReceiveCount: '1',
        SentTimestamp: '1700000000000',
        SenderId: 'sender',
        ApproximateFirstReceiveTimestamp: '1700000000000',
    },
    messageAttributes: {},
    md5OfBody: 'd41d8cd98f00b204e9800998ecf8427e',
    eventSource: 'aws:sqs',
    eventSourceARN: 'arn:aws:sqs:us-east-1:000000000000:recipe-workers',
    awsRegion: 'us-east-1',
    ...overrides,
});

/** A typed account-erasure message with sensible defaults. */
export const makeErasureMessage = (overrides: Partial<AccountErasureMessage> = {}): AccountErasureMessage => ({
    ownerId: '01J0000000000000000000OWN0',
    requestedAt: '2026-07-10T00:00:00.000Z',
    ...overrides,
});

/** An `SQSRecord` whose body is the JSON of an {@link makeErasureMessage}. */
export const makeErasureRecord = (
    message: Partial<AccountErasureMessage> = {},
    recordOverrides: Partial<SQSRecord> = {},
): SQSRecord => makeSqsRecord(JSON.stringify(makeErasureMessage(message)), recordOverrides);

/** An `SQSEvent` wrapping one-or-more erasure records. */
export const makeErasureEvent = (...messages: Array<Partial<AccountErasureMessage>>): SQSEvent => ({
    Records: (messages.length > 0 ? messages : [{}]).map((message) => makeErasureRecord(message)),
});

/** A typed recipe-version archive message with sensible defaults. */
export const makeArchiveMessage = (
    overrides: Partial<RecipeVersionArchiveMessage> = {},
): RecipeVersionArchiveMessage => ({
    recipeId: '00000000-0000-4000-8000-0000000000r1',
    versionId: '00000000-0000-4000-8000-0000000000v1',
    // The archive object is keyed by the client-facing version NUMBER, not `versionId` (ARCH-BE-3).
    versionNumber: 1,
    ownerId: '01J0000000000000000000OWN0',
    requestedAt: '2026-07-10T00:00:00.000Z',
    ...overrides,
});

/** An `SQSRecord` whose body is the JSON of an {@link makeArchiveMessage}. */
export const makeArchiveRecord = (
    message: Partial<RecipeVersionArchiveMessage> = {},
    recordOverrides: Partial<SQSRecord> = {},
): SQSRecord => makeSqsRecord(JSON.stringify(makeArchiveMessage(message)), recordOverrides);

/** An `SQSEvent` wrapping one-or-more archive records. */
export const makeArchiveEvent = (...messages: Array<Partial<RecipeVersionArchiveMessage>>): SQSEvent => ({
    Records: (messages.length > 0 ? messages : [{}]).map((message) => makeArchiveRecord(message)),
});
