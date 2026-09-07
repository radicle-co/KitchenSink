/**
 * @module parseQueueConsumer — the delivery a local sandbox has no Lambda to perform.
 *
 * DESIGN PATTERN: **Ports and Adapters with an injected clock/termination predicate.** The loop is a pure
 * function of a {@link ParseQueuePort}, a handler and a `shouldContinue` predicate, so its whole contract —
 * acknowledge only after success, survive one bad message, survive a broker outage — is exercised without a
 * broker and without a timer. `sqsParseQueuePort` is the only impure thing here.
 *
 * ## ⛔ WHY IT EXISTS
 *
 * `RecipeWorkersStack` attaches `new lambda_event_sources.SqsEventSource(parseQueue, { batchSize: 1 })`, and
 * `up.ts` deploys no Lambda — it creates queues, buckets, tables, topics and parameters. So locally the
 * parse queue filled and nothing drained it: every pasted ingredient line sat as `pending` forever, with the
 * producer having answered `202`.
 *
 * ## ⛔ DELETE MEANS "DONE", AND ONLY AFTER THE HANDLER RETURNED
 *
 * `parseLine.ts` THROWS on a transient failure specifically so the message redelivers — that throw is the
 * retry. A loop that deleted on receipt, or that swallowed the throw and deleted anyway, would lose the line
 * locally while the deployed path retried it, and the local run would look healthier than production.
 *
 * ⚠️ A LOCAL loop has no `maxReceiveCount` and no DLQ, because those are the QUEUE's properties and the
 * queue here is the one `up.ts` created from the same template — so redelivery, the visibility timeout and
 * the DLQ redrive policy are all LocalStack's, not this module's. What this module must not do is
 * short-circuit them.
 */
import { DeleteMessageCommand, ReceiveMessageCommand, type SQSClient } from '@aws-sdk/client-sqs';

/** One message, reduced to what a consumer needs. */
export interface ParseQueueMessage {
    /** The raw JSON body — parsed by the handler, never here. */
    readonly body: string;
    /** The token that acknowledges it. */
    readonly receiptHandle: string;
}

/** The broker, as this loop sees it. */
export interface ParseQueuePort {
    /** @returns The next batch; an empty array when the long poll expired. */
    receive(): Promise<readonly ParseQueueMessage[]>;
    /** Acknowledge one message. */
    delete(receiptHandle: string): Promise<void>;
}

/** Everything the loop talks to. */
export interface DrainParseQueueDeps {
    readonly queue: ParseQueuePort;
    /** Process one message body. Throwing means "not done" — the message is left for redelivery. */
    readonly handle: (body: string) => Promise<void>;
    /**
     * Report a failure.
     *
     * ⛔ Required, not optional-with-a-default. A consumer acquired by omission would drop every failure
     * silently, which is precisely the shape of the defect this whole directory exists to repair.
     */
    readonly onError: (error: unknown) => void;
    /** Asked once per poll. `false` ends the loop — a signal handler in the entry, a counter in a test. */
    readonly shouldContinue: () => boolean;
}

/** What one run of the loop did. */
export interface DrainSummary {
    /** Messages whose handler returned, and which were therefore acknowledged. */
    readonly processed: number;
    /** Messages whose handler threw, plus polls that could not reach the broker. */
    readonly failed: number;
}

/**
 * Drain the parse queue until told to stop.
 *
 * @param deps - The broker, the handler, the failure sink and the termination predicate.
 * @returns What the run did.
 * @sideEffect Receives from and deletes on the queue, and runs the handler.
 */
export async function drainParseQueue(deps: DrainParseQueueDeps): Promise<DrainSummary> {
    let processed = 0;
    let failed = 0;

    while (deps.shouldContinue()) {
        let batch: readonly ParseQueueMessage[];

        try {
            batch = await deps.queue.receive();
        } catch (error) {
            // ⚠️ A broker that is restarting is not a reason to stop. Reported and re-polled — the long poll
            // is its own backoff.
            failed += 1;
            deps.onError(error);
            continue;
        }

        for (const message of batch) {
            try {
                await deps.handle(message.body);
            } catch (error) {
                failed += 1;
                deps.onError(error);
                // ⛔ NOT deleted. The throw is the retry.
                continue;
            }

            await deps.queue.delete(message.receiptHandle);
            processed += 1;
        }
    }

    return { processed, failed };
}

/** What the SQS adapter needs. */
export interface SqsParseQueueOptions {
    readonly client: Pick<SQSClient, 'send'>;
    readonly queueUrl: string;
    /**
     * Long-poll seconds. 20 is SQS's maximum and the right default for a worker: it is one request per 20
     * idle seconds instead of a spin, and it returns the instant a message arrives.
     */
    readonly waitTimeSeconds?: number;
    /**
     * Cancels an in-flight long poll, so a stop signal is not left waiting out the poll.
     *
     * ⛔ AN ABORT ANSWERS AN EMPTY BATCH, NOT A FAILURE, and that is safe for exactly one reason: this
     * signal is only ever raised by our OWN shutdown. "The poll was cancelled" genuinely is "no messages
     * this poll", the loop then asks `shouldContinue` and leaves. Measured without it: a `SIGINT` was
     * logged and the process stayed alive for the rest of the 20-second poll, which under `turbo run dev`
     * reads as a hung worker.
     *
     * ⚠️ It must NOT be widened into a general request timeout. A timeout that answered "empty" would
     * report a broker that is failing as a broker that is idle.
     */
    readonly abortSignal?: AbortSignal;
}

/**
 * The SQS adapter.
 *
 * ⚠️ `MaxNumberOfMessages: 1`, mirroring the stack's `batchSize: 1` — one record is one line, and the
 * handler's own contract ("a DLQ message maps to one un-landed line") depends on it.
 *
 * @param options - The client, the queue URL, the poll length and the shutdown signal.
 * @returns The port.
 * @sideEffect Every call reaches the broker.
 */
export function sqsParseQueuePort(options: SqsParseQueueOptions): ParseQueuePort {
    return {
        async receive() {
            // ⚠️ No pre-check on `aborted` — an already-aborted signal makes the SDK reject immediately, so
            // the one decision below covers both "aborted before we asked" and "aborted mid-poll". A second
            // check would also narrow the type against a value that changes while we await it.
            let response: unknown;

            try {
                response = await options.client.send(
                    new ReceiveMessageCommand({
                        QueueUrl: options.queueUrl,
                        MaxNumberOfMessages: 1,
                        WaitTimeSeconds: options.waitTimeSeconds ?? 20,
                    }) as never,
                    { abortSignal: options.abortSignal } as never,
                );
            } catch (error) {
                // Only OUR abort is absorbed; everything else is a real failure the loop must report.
                if (options.abortSignal?.aborted !== true) {
                    throw error;
                }

                return [];
            }

            const messages = (response as { Messages?: { Body?: string; ReceiptHandle?: string }[] }).Messages ?? [];

            return messages.flatMap((message) =>
                message.Body === undefined || message.ReceiptHandle === undefined
                    ? []
                    : [{ body: message.Body, receiptHandle: message.ReceiptHandle }],
            );
        },
        async delete(receiptHandle) {
            await options.client.send(
                new DeleteMessageCommand({ QueueUrl: options.queueUrl, ReceiptHandle: receiptHandle }) as never,
            );
        },
    };
}
