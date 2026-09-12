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

/**
 * The SUBMITTER is this queue's tenant, for SQS fair queues (plan U8, R3).
 *
 * ⛔ Why it matters here and not elsewhere: a bulk import IS a parse job — one paste becomes up to
 * `MAX_PARSE_JOB_LINES` messages from one cook, all enqueued at once — so without a tenant label the queue
 * hands a second cook's single line to a poller that is 200 messages deep in the first cook's import. AWS
 * marks a tenant noisy on EITHER a concurrency share (>10% of in-flight, and at least 30 of its own in
 * flight) OR a processing-time share (>10% of recent consumer time, with no in-flight minimum), and the
 * second measure is the one that applies at this stack's concurrency — so labelling is worth doing without
 * a large consumer fleet.
 *
 * ⚠️ `userId` is OPTIONAL on this contract ("absent means unattended"), and an unattended line is correctly
 * left unlabelled: AWS treats every un-grouped message as its own tenant, so background work competes as
 * itself rather than pooling into one tenant named for nobody.
 *
 * @param message - The parse-job message.
 * @returns The submitter, or `undefined` for unattended work. Pure.
 */
function parseJobTenantOf(message: ParseLineJobMessage): string | undefined {
    return message.userId;
}

/** Config the SQS adapter needs (`RECIPE_PARSE_QUEUE_URL` + client settings). */
export type SqsParseJobQueueConfig = SqsBatchQueueConfig;

/**
 * Whether the transport this config addresses supports AWS fair queues.
 *
 * ⛔ A CAPABILITY QUESTION, NOT A TEST QUESTION, and the distinction is what makes it legitimate in
 * production code. `MessageGroupId` on a STANDARD queue is an AWS-only capability; a configured
 * `endpoint` means the transport is not AWS SQS. `sqsBatchClientConfig` already asks this exact
 * question of this exact field to pin static `test` credentials, under the convention
 * `createSqsErasureQueue` established — so this introduces no new notion of "are we in a test", it
 * names the one that was already here.
 *
 * ⚠️ It is a named export because `createSqsParseJobQueue` cannot be constructed without an SDK
 * client, which left the ONE place where the integration tier and production deliberately send
 * different bytes with no mutation-surviving assertion: inverting the expression inline kept all
 * seven parametrized tests green.
 *
 * ⚠️ It takes the ONE field it reads, not the whole config, so the call site says what the answer depends
 * on and a test states nothing it does not mean. `createSqsParseJobQueue` still passes its config whole —
 * structurally that satisfies the narrower parameter.
 *
 * @param config - Anything carrying the client's `endpoint`, absent for real AWS.
 * @returns `true` for real AWS SQS, `false` for an emulator endpoint. Pure.
 */
export function fairQueuesSupported(config: Pick<SqsParseJobQueueConfig, 'endpoint'>): boolean {
    return config.endpoint === undefined;
}

/**
 * Build the port over an injected transport.
 *
 * @param send - How a batch reaches SQS.
 * @param queueUrl - The queue every batch is addressed to.
 * @returns The port the service depends on.
 */
export function createParseJobQueue(send: SqsBatchSend, queueUrl: string, labelTenants = true): ParseJobQueuePort {
    return {
        enqueue: createSqsBatchEnqueue(
            parseLineJobMessageSchema,
            send,
            queueUrl,
            'parse-job enqueue',
            labelTenants ? parseJobTenantOf : undefined,
        ),
    };
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
    // ⛔ THE TENANT LABEL IS DROPPED AGAINST AN EMULATOR, AND ONLY AGAINST AN EMULATOR. AWS fair queues
    // accept `MessageGroupId` on a STANDARD queue; LocalStack does not implement that for
    // `SendMessageBatch` — measured on the community images this repo pins and on 4.9.0: a single
    // `SendMessage` carrying the label succeeds, the same label inside a BATCH entry is rejected with
    // `InvalidParameterValueException` ("not valid for this queue type"). Every batch therefore failed, and
    // `enqueueOrMark` converted the whole job's lines to `failed_retryable` — which is what reds the parse
    // integration suites.
    //
    // ⚠️ The signal is `fairQueuesSupported`, which states the question as a CAPABILITY rather than
    // an environment — and states it somewhere a test can reach, which inline it was not.
    //
    // ⛔ THE COST IS STATED RATHER THAN HIDDEN: against LocalStack the integration tier sends a batch
    // WITHOUT the label, so it does not exercise the exact entry production sends. What covers that gap is
    // `parseJob.queue.test.ts`, which asserts the label on the entries at the client boundary where the
    // emulator is not involved. The delivery path and the label are proven by different tiers because no
    // single tier available here can prove both.
    return createParseJobQueue(createSqsBatchTransport(config).send, config.queueUrl, fairQueuesSupported(config));
}
