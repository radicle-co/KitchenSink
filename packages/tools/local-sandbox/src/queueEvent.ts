/**
 * @module queueEvent — the SQS event a local consumer hands a Lambda handler, and what it acknowledges after.
 *
 * Pure. `bin/queueConsumer.ts` does the receiving, the invoking and the deleting.
 */
import type { SQSEvent } from 'aws-lambda';

/** One message as `ReceiveMessage` returns it — the fields the event needs. */
export interface ReceivedMessage {
    readonly MessageId?: string | undefined;
    readonly ReceiptHandle?: string | undefined;
    readonly Body?: string | undefined;
    readonly MD5OfBody?: string | undefined;
    readonly Attributes?: Readonly<Record<string, string>> | undefined;
}

/** The queue, as the event names it. */
export interface QueueAddress {
    /** The queue URL, `<endpoint>/<account>/<name>`. */
    readonly url: string;
    readonly region: string;
}

/**
 * The event Lambda's SQS poller would deliver for these messages.
 *
 * @param messages - What one `ReceiveMessage` returned.
 * @param queue - The queue they came from.
 * @returns The event. Pure.
 */
export function sqsEventFor(messages: readonly ReceivedMessage[], queue: QueueAddress): SQSEvent {
    const [account = '000000000000', name = ''] = new URL(queue.url).pathname.split('/').filter((part) => part !== '');

    return {
        Records: messages.map((message) => ({
            messageId: message.MessageId ?? '',
            receiptHandle: message.ReceiptHandle ?? '',
            body: message.Body ?? '',
            md5OfBody: message.MD5OfBody ?? '',
            // The handlers read only `ApproximateReceiveCount`; the rest of Lambda's attribute set is filled with the
            // values a first delivery would carry.
            attributes: {
                ApproximateReceiveCount: '1',
                SentTimestamp: '0',
                SenderId: account,
                ApproximateFirstReceiveTimestamp: '0',
                ...message.Attributes,
            },
            messageAttributes: {},
            eventSource: 'aws:sqs',
            eventSourceARN: `arn:aws:sqs:${queue.region}:${account}:${name}`,
            awsRegion: queue.region,
        })),
    };
}

/** How one invocation ended. */
export type InvocationOutcome = { readonly kind: 'resolved'; readonly value: unknown } | { readonly kind: 'threw' };

/**
 * The receipt handles to delete after an invocation — Lambda's own acknowledgement rule.
 *
 * @param messages - The batch.
 * @param outcome - How the handler ended.
 * @param honoursFailureReport - Whether the mapping declares `ReportBatchItemFailures`.
 * @returns Receipt handles to delete. Pure.
 */
export function messagesToDelete(
    messages: readonly ReceivedMessage[],
    outcome: InvocationOutcome,
    honoursFailureReport: boolean,
): readonly string[] {
    if (outcome.kind === 'threw') {
        return [];
    }

    const reported = (outcome.value as { batchItemFailures?: readonly { itemIdentifier?: unknown }[] } | undefined)
        ?.batchItemFailures;
    const failed = new Set(
        honoursFailureReport && Array.isArray(reported) ? reported.map((failure) => failure.itemIdentifier) : [],
    );

    return messages.flatMap((message) =>
        message.ReceiptHandle !== undefined && !failed.has(message.MessageId) ? [message.ReceiptHandle] : [],
    );
}
