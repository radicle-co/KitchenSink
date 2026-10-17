/**
 * The SQS event a local queue consumer hands a Lambda handler, and which messages it deletes afterwards.
 *
 * ⛔ Deleting is the acknowledgement. Delete a message whose record failed and the work is lost with nothing to say
 * so; keep one that succeeded and it is processed twice. Lambda's own rules decide: a handler that THROWS fails the
 * whole batch, and one that reports `batchItemFailures` fails only those records — and only when its mapping
 * declares `ReportBatchItemFailures`, because otherwise Lambda ignores the response and acknowledges everything.
 */
import { describe, expect, it } from 'vitest';

import { messagesToDelete, sqsEventFor } from '../queueEvent.js';

const queue = { url: 'http://localhost:4566/000000000000/kitchensink-recipe-account-erasure-dev', region: 'us-east-1' };
const messages = [
    { MessageId: 'm1', ReceiptHandle: 'r1', Body: '{"a":1}', Attributes: { ApproximateReceiveCount: '1' } },
    { MessageId: 'm2', ReceiptHandle: 'r2', Body: '{"a":2}' },
];

describe('sqsEventFor', () => {
    it('builds one record per message, in Lambda’s shape', () => {
        const event = sqsEventFor(messages, queue);

        expect(event.Records).toHaveLength(2);
        expect(event.Records[0]).toMatchObject({
            messageId: 'm1',
            receiptHandle: 'r1',
            body: '{"a":1}',
            eventSource: 'aws:sqs',
            eventSourceARN: 'arn:aws:sqs:us-east-1:000000000000:kitchensink-recipe-account-erasure-dev',
            awsRegion: 'us-east-1',
            attributes: { ApproximateReceiveCount: '1' },
        });
    });
});

describe('messagesToDelete', () => {
    it('acknowledges the whole batch when the handler resolved', () => {
        expect(messagesToDelete(messages, { kind: 'resolved', value: undefined }, false)).toEqual(['r1', 'r2']);
    });

    it('acknowledges nothing when the handler threw — the batch redelivers', () => {
        expect(messagesToDelete(messages, { kind: 'threw' }, true)).toEqual([]);
    });

    it('keeps the records the handler reported as failed, when the mapping honours the report', () => {
        const value = { batchItemFailures: [{ itemIdentifier: 'm2' }] };

        expect(messagesToDelete(messages, { kind: 'resolved', value }, true)).toEqual(['r1']);
    });

    it('ignores a failure report the mapping does not honour, as Lambda does', () => {
        const value = { batchItemFailures: [{ itemIdentifier: 'm2' }] };

        expect(messagesToDelete(messages, { kind: 'resolved', value }, false)).toEqual(['r1', 'r2']);
    });
});
