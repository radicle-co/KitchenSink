/**
 * THE SHARED SQS BATCH-SEND CORE (plan U9) — the one representation of "send a batch of contract-checked
 * messages to SQS reliably", behind BOTH producer ports (`recipes/verification.queue.ts` and
 * `recipes/parseJob.queue.ts`).
 *
 * ## Why this exists as a module, when `verification.queue.ts` refuses to merge with the erasure queue
 *
 * That refusal is about PORTS: the erasure and verification queues carry different contracts with opposite
 * failure semantics, so one "queue client" interface would be the wrong abstraction (Metz). This module is
 * not a port — it is the MECHANICS under two ports that had begun to duplicate, line for line, knowledge
 * that changes for one reason (how the AWS SDK batches, times out, and reports partial failure):
 *
 *  1. **Explicit connection/request timeouts** — verified against `@smithy/node-http-handler` in this
 *     tree: `setConnectionTimeout(request, reject, timeoutInMs = 0)` and `setRequestTimeout(...)` both
 *     return `-1` when the value is falsy, so the SDK sets NO timeout unless you set one, and a blackholed
 *     endpoint hangs a user's request until the ALB's idle timeout.
 *  2. **`maxAttempts: 2`** — a retry budget multiplies the worst case on a synchronous save path.
 *  3. **Every message parsed against the CONSUMER's schema before it is sent** — a message the deployed
 *     worker refuses is POISON (redelivered to `maxReceiveCount`, then resident in a DLQ holding a cook's
 *     text while the API reported success). Refusal reports FIELD PATHS only, never the message content —
 *     these strings reach a log group.
 *  4. **A batch is not atomic** — `SendMessageBatch` can return `2xx` with a populated `Failed` array.
 *     Failures are collected across ALL batches and thrown once at the end, never mid-loop (which would
 *     abandon every batch after the first).
 *
 * Failure SEMANTICS stay with the callers: the recipe save swallows a verification enqueue failure
 * (droppable), the parse-job create marks affected lines `failed_retryable` (recoverable). The core only
 * promises to send what the contract admits and to say, precisely, what it could not.
 */
import {
    SendMessageBatchCommand,
    SQSClient,
    type SendMessageBatchCommandInput,
    type SendMessageBatchCommandOutput,
    type SendMessageBatchRequestEntry,
    type SQSClientConfig,
} from '@aws-sdk/client-sqs';
import type { ZodType } from 'zod';

import { BatchEnqueueError } from './batchEnqueueError.js';

/** AWS's hard limit on entries in one `SendMessageBatch` call. */
const SQS_BATCH_LIMIT = 10;

/** How long to wait for a TCP connection before giving up (ms). See the module docstring — the SDK sets none. */
const CONNECTION_TIMEOUT_MS = 1_000;

/** How long to wait for a whole request before giving up (ms). */
const REQUEST_TIMEOUT_MS = 2_000;

/** Total SDK attempts per batch, including the first. */
const MAX_ATTEMPTS = 2;

/** Config either SQS producer adapter needs (sourced from the service's env config). */
export interface SqsBatchQueueConfig {
    /** The queue every batch is addressed to. */
    readonly queueUrl: string;
    /** AWS region for the client. */
    readonly region: string;
    /** Custom endpoint (LocalStack) — omit for real AWS. */
    readonly endpoint?: string;
}

/**
 * How a batch actually reaches SQS.
 *
 * ⛔ INJECTED, exactly as `@kitchensink/bedrock-client` injects `ConverseTransport`, and for the same
 * reason: the contract parse, the chunking and the cross-batch failure collection are REAL LOGIC that a
 * LocalStack test cannot exercise — LocalStack accepts poison happily and will not manufacture a
 * partial-batch failure on request.
 */
export type SqsBatchSend = (input: SendMessageBatchCommandInput) => Promise<SendMessageBatchCommandOutput>;

/** Split a list into chunks of at most {@link SQS_BATCH_LIMIT}. Pure. */
function batches<T>(messages: readonly T[]): readonly (readonly T[])[] {
    const chunks: (readonly T[])[] = [];

    for (let index = 0; index < messages.length; index += SQS_BATCH_LIMIT) {
        chunks.push(messages.slice(index, index + SQS_BATCH_LIMIT));
    }

    return chunks;
}

/**
 * Names this message's TENANT for SQS fair queues, or `undefined` to leave it unlabelled.
 *
 * ⛔ On a STANDARD queue `MessageGroupId` is a tenant label and nothing else — it does NOT order messages,
 * which is what it means on a FIFO queue. AWS applies fairness automatically to any standard queue carrying
 * it; there is no attribute to enable.
 */
export type TenantOf<T> = (message: T) => string | undefined;

/**
 * One batch entry.
 *
 * ⛔ THE `Id` IS SUPPLIED, NOT DERIVED HERE, so the one value a `Failed` entry names is decided in the same
 * place that records what it refers to. Deriving it twice — once to send, once to look up — is how the two
 * drift and a rejection is attributed to the wrong message.
 *
 * @param tenantOf - Names the message's tenant, or answers `undefined` to send it unlabelled.
 * @param message - The message.
 * @param id - Unique among THIS request's entries, which is all SQS requires.
 * @returns The entry. Pure.
 */
function entryFor<T>(tenantOf: TenantOf<T> | undefined, message: T, id: string): SendMessageBatchRequestEntry {
    const tenant = tenantOf?.(message);

    return {
        Id: id,
        MessageBody: JSON.stringify(message),
        // ⚠️ OMITTED rather than sent empty when there is no tenant. AWS treats every message WITHOUT a
        // group as its own distinct tenant, which is the right default for work that has no submitter; an
        // empty string would instead pool all of them into one tenant named "".
        ...(tenant === undefined ? {} : { MessageGroupId: tenant }),
    };
}

/** A message paired with its position in the list the CALLER handed in. */
interface Positioned<T> {
    readonly message: T;
    /** Position among the caller's messages — the addressing a failure report is expressed in. */
    readonly index: number;
}

/**
 * Keep only the messages the CONSUMER would accept, reporting the rest.
 *
 * ⛔ THE POSITION TRAVELS WITH THE MESSAGE from here on. Chunking and refusal both renumber what is left,
 * so a position recovered afterwards by counting is a position in the survivors, not in the caller's list.
 *
 * @param schema - The consumer's own contract.
 * @param messages - The candidate requests.
 * @returns The sendable messages and the refusals, each carrying its caller-side position. Pure.
 */
function partitionSendable<T>(
    schema: ZodType<T>,
    messages: readonly T[],
): {
    readonly sendable: readonly Positioned<T>[];
    readonly refused: readonly { readonly index: number; readonly fields: string }[];
} {
    const sendable: Positioned<T>[] = [];
    const refused: { readonly index: number; readonly fields: string }[] = [];

    for (const [index, message] of messages.entries()) {
        const parsed = schema.safeParse(message);

        if (parsed.success) {
            sendable.push({ message, index });
        } else {
            // ⛔ The field paths, never the message's CONTENT. This string reaches a log group; the payload
            // may carry a cook's own text, and the whole point of refusing the message is to keep that out
            // of places it does not belong.
            refused.push({ index, fields: parsed.error.issues.map((issue) => issue.path.join('.')).join(',') });
        }
    }

    return { sendable, refused };
}

/**
 * Build a batch-send `enqueue` over an injected transport. See the module docstring for the four rules it
 * enforces; the returned function throws ONE error naming everything that was not delivered (messages that
 * were fine are still sent — the throw reports what was lost, it does not abandon the rest).
 *
 * @param schema - The CONSUMER's message contract; anything it refuses is reported, never sent.
 * @param send - How a batch reaches SQS.
 * @param queueUrl - The queue every batch is addressed to.
 * @param label - Prefix for the thrown error (`"<label>: N of M messages were not delivered — …"`).
 * @returns The enqueue function a port wraps.
 */
export function createSqsBatchEnqueue<T>(
    schema: ZodType<T>,
    send: SqsBatchSend,
    queueUrl: string,
    label: string,
    tenantOf?: TenantOf<T>,
): (messages: readonly T[]) => Promise<void> {
    return async (messages: readonly T[]): Promise<void> => {
        const { sendable, refused } = partitionSendable(schema, messages);
        const problems = refused.map(
            ({ index, fields }) => `message ${String(index)} refused by the contract (${fields})`,
        );
        // ⛔ A SET OF MESSAGE POSITIONS, NOT A COUNT OF `problems` — one problem is not one message. A
        // contract refusal and a per-entry rejection each describe ONE message, but a REJECTED BATCH
        // describes up to `SQS_BATCH_LIMIT` of them, and that is the arm that fires during an outage. The
        // count an operator reads is this set's size, so the number and the attribution cannot disagree.
        const undelivered = new Set<number>(refused.map(({ index }) => index));

        if (sendable.length > 0) {
            // Concurrent, and SETTLED rather than raced: one failing batch must not abandon the others.
            const batched = batches(sendable);
            const addressed = batched.map((batch) =>
                batch.map((item, position) => ({ ...item, id: String(position) })),
            );
            const results = await Promise.allSettled(
                addressed.map(async (batch) =>
                    send({
                        QueueUrl: queueUrl,
                        Entries: batch.map((item) => entryFor(tenantOf, item.message, item.id)),
                    }),
                ),
            );

            for (const [index, result] of results.entries()) {
                const batch = addressed[index] ?? [];

                if (result.status === 'rejected') {
                    const reason: unknown = result.reason;

                    problems.push(
                        `batch ${String(index)} failed: ${reason instanceof Error ? reason.message : String(reason)}`,
                    );

                    for (const item of batch) {
                        undelivered.add(item.index);
                    }

                    continue;
                }

                // ⛔ KEYED BY THE `Id` WE SENT. `Failed` is neither ordered nor complete, and ids re-base per
                // chunk, so reading it positionally names a message from another batch entirely.
                const sentIds = new Map(batch.map((item) => [item.id, item.index]));

                for (const failure of result.value.Failed ?? []) {
                    // ⛔ A 2xx with a populated `Failed` array is a PARTIAL failure, and ignoring it is how
                    // a send reports success having delivered nothing.
                    problems.push(
                        `batch ${String(index)} entry ${failure.Id ?? '?'} rejected: ${failure.Code ?? 'unknown'}`,
                    );

                    const attributed = failure.Id === undefined ? undefined : sentIds.get(failure.Id);

                    if (attributed === undefined) {
                        // Unattributable: the whole batch is undelivered. See `BatchEnqueueError` —
                        // a producer that cannot say WHICH message was lost may exonerate none of them.
                        for (const item of batch) {
                            undelivered.add(item.index);
                        }

                        continue;
                    }

                    undelivered.add(attributed);
                }
            }
        }

        if (problems.length > 0) {
            const lost = [...undelivered].sort((left, right) => left - right);

            throw new BatchEnqueueError(
                `${label}: ${String(lost.length)} of ${String(messages.length)} messages ` +
                    `were not delivered — ${problems.join('; ')}`,
                lost,
            );
        }
    };
}

/**
 * The SDK client settings, as a PURE value.
 *
 * ⛔ Separated from construction so the bounds can be ASSERTED. `NodeHttpHandler` resolves its own config
 * lazily — `client.config.requestHandler.httpHandlerConfigs()` answers `{}` until a request has actually
 * run — so a guard test that reached into the constructed client would read empty and pass whatever the
 * code said. This function is the judgement; the constructor is the effect.
 *
 * @param config - Queue URL + client settings.
 * @returns The settings an `SQSClient` is constructed with. Pure.
 */
export function sqsBatchClientConfig(config: SqsBatchQueueConfig): SQSClientConfig {
    return {
        region: config.region,
        maxAttempts: MAX_ATTEMPTS,
        // ⛔ NOT decoration — the SDK's own defaults are "no timeout at all". See the module docstring.
        requestHandler: { connectionTimeout: CONNECTION_TIMEOUT_MS, requestTimeout: REQUEST_TIMEOUT_MS },
        // A custom endpoint means LocalStack (the convention `createSqsErasureQueue` established). Pin
        // static test credentials so the integration tier is self-contained rather than depending on
        // ambient host/CI AWS config. Real AWS keeps the default credential chain (the ECS task role).
        ...(config.endpoint !== undefined
            ? { endpoint: config.endpoint, credentials: { accessKeyId: 'test', secretAccessKey: 'test' } }
            : {}),
    };
}

/** The real transport, plus the SDK client it wraps (exposed so its configuration can be asserted). */
export interface SqsBatchTransport {
    readonly send: SqsBatchSend;
    /** The configured SDK client. Exported so a guard test can prove the timeouts are pinned. */
    readonly client: SQSClient;
}

/**
 * Build the real transport.
 *
 * @param config - Queue URL + client settings.
 * @returns The transport and its client.
 * @sideEffect Constructs an SDK client; the returned `send` calls SQS.
 */
export function createSqsBatchTransport(config: SqsBatchQueueConfig): SqsBatchTransport {
    const client = new SQSClient(sqsBatchClientConfig(config));

    return { client, send: async (input) => client.send(new SendMessageBatchCommand(input)) };
}
