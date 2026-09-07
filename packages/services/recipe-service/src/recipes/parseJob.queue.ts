/**
 * THE PARSE JOB'S PRODUCER (plan U9, origin D9/R13) — the SQS adapter behind {@link ParseJobQueuePort}.
 *
 * DESIGN PATTERN: **Port + Adapter** over the shared batch core (`common/sqsBatchQueue.ts`), the third
 * producer port and deliberately NOT a member of one "queue client" abstraction: the erasure queue is a
 * compliance obligation, the verification queue is droppable enhancement, and THIS queue is the job
 * itself — a parse-job message that fails to send leaves its line waiting, so the caller
 * (`ParseJobsService`) marks the affected lines `failed_retryable` rather than swallowing (the per-line
 * retry endpoint re-drives exactly those). Three contracts, three failure semantics, one set of send
 * mechanics.
 *
 * Every message is parsed against `parseLineJobMessageSchema` — the CONSUMER's own schema, authored
 * consumer-first in `@kitchensink/recipe-core` (ADR-0022's ordering note) — before it is sent, so
 * producer/consumer drift is a loud refusal here instead of DLQ poison holding a cook's pasted text.
 */
import {
    parseLineJobMessageSchema,
    type ParseLineJobMessage,
} from '@kitchensink/recipe-core/parsing/parse-job-message';

import {
    createSqsBatchEnqueue,
    createSqsBatchTransport,
    type SqsBatchQueueConfig,
    type SqsBatchSend,
} from '../common/sqsBatchQueue.js';

/** DI token for the parse-job queue port — provided by `RecipesModule` via `useFactory` over the env config. */
export const PARSE_JOB_QUEUE = 'PARSE_JOB_QUEUE';

/** The queue the parse-job resource hands lines to. Implemented for real by {@link createSqsParseJobQueue}. */
export interface ParseJobQueuePort {
    /**
     * Enqueue these lines for the parse worker.
     *
     * @param messages - One message per line. An empty list is a no-op and issues no call.
     * @throws When any message was refused by the contract or failed to send. ⛔ The CALLER acts on it —
     *   see `ParseJobsService`: unlike a verification request, a parse-job line's message IS the work, so
     *   a failed send marks the line `failed_retryable` for the retry endpoint instead of being dropped.
     *   Messages that were fine are still sent — the throw reports what was lost.
     * @sideEffect Issues one or more SQS `SendMessageBatch` requests.
     */
    enqueue(messages: readonly ParseLineJobMessage[]): Promise<void>;
}

/** Config the SQS adapter needs (`RECIPE_PARSE_QUEUE_URL` + client settings). */
export type SqsParseJobQueueConfig = SqsBatchQueueConfig;

/**
 * Build the port over an injected transport.
 *
 * @param send - How a batch reaches SQS.
 * @param queueUrl - The queue every batch is addressed to.
 * @returns The port the service depends on.
 */
export function createParseJobQueue(send: SqsBatchSend, queueUrl: string): ParseJobQueuePort {
    return { enqueue: createSqsBatchEnqueue(parseLineJobMessageSchema, send, queueUrl, 'parse-job enqueue') };
}

/**
 * Build a {@link ParseJobQueuePort} over a real `SQSClient`. The client is created once and closed by the
 * process lifecycle (Nest never disposes singletons mid-run).
 *
 * @param config - Queue URL + client settings.
 * @returns The port `RecipesModule` provides under {@link PARSE_JOB_QUEUE}.
 * @sideEffect Constructs an SDK client.
 */
export function createSqsParseJobQueue(config: SqsParseJobQueueConfig): ParseJobQueuePort {
    return createParseJobQueue(createSqsBatchTransport(config).send, config.queueUrl);
}
