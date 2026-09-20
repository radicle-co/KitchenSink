/**
 * THE VERIFICATION GATE'S PRODUCER (plan U11 / ADR-0024) — the SQS adapter behind
 * {@link VerificationQueuePort}.
 *
 * DESIGN PATTERN: **Port + Adapter**, a deliberate sibling of `account/erasure.queue.ts` rather than a
 * generalisation of it. The two queues carry different contracts, have different failure semantics (an
 * erasure is a compliance obligation with a durable row behind it; a verification request is a quality
 * enhancement whose loss degrades to today's behaviour) and will drift for different reasons — merging them
 * into one "queue client" would be the wrong abstraction in Metz's sense.
 *
 * Isolating the SDK here keeps `RecipesService` unit-testable against a fake port — no network, no SDK
 * module-mocking — exactly as `ErasureService` is. The adapter itself is exercised against LocalStack by the
 * integration tier.
 *
 * ## ⛔ THIS RUNS ON A USER'S SYNCHRONOUS SAVE, SO IT IS BOUNDED THREE WAYS
 *
 * `RecipesService` awaits this inside `POST /api/v1/recipes`; a blackholed endpoint must be a fast,
 * catchable failure rather than a `504` on a recipe that WAS created. The bounds themselves — explicit
 * connection/request timeouts, `maxAttempts: 2`, concurrent settled batches — live in
 * `common/sqsBatchQueue.ts` (plan U9), the ONE representation of the batch-send mechanics this port and
 * the parse-job port share. What stays HERE is the port: its contract
 * (`verifyIngredientLineMessageSchema` — every message is parsed against the CONSUMER's own schema before
 * it is sent, so producer/consumer drift surfaces as a loud, countable refusal instead of DLQ poison
 * holding a cook's recipe text), its DI token, and its failure semantics (the caller swallows — see
 * `RecipesService.requestVerification` — because a lost verification request degrades to the behaviour
 * that predates the gate).
 */
import type { SQSClient } from '@aws-sdk/client-sqs';
import {
    verifyIngredientLineMessageSchema,
    type VerifyIngredientLineMessage,
} from '@kitchensink/recipe-core/resolution/verification-message';

import {
    createSqsBatchEnqueue,
    createSqsBatchTransport,
    sqsBatchClientConfig,
    type SqsBatchQueueConfig,
    type SqsBatchSend,
} from '../common/sqsBatchQueue.js';

/** DI token for the verification queue port — provided by `RecipesModule` via `useFactory` over the env config. */
export const VERIFICATION_QUEUE = 'VERIFICATION_QUEUE';

/** The queue the service asks the verification gate through. Implemented for real by {@link createSqsVerificationQueue}. */
export interface VerificationQueuePort {
    /**
     * Ask the gate about these lines.
     *
     * @param messages - The requests. An empty list is a no-op and issues no call.
     * @throws When any message was refused by the contract or failed to send. ⛔ The CALLER swallows it — see
     *   `RecipesService.requestVerification`. It throws rather than swallowing here so the port stays
     *   honest: an adapter that hid its own failures could never be tested for them, and a future caller
     *   that DOES need to know would have no way to find out. Messages that were fine are still sent — the
     *   throw reports what was lost, it does not abandon the rest.
     * @sideEffect Issues one or more SQS `SendMessageBatch` requests.
     */
    enqueue(messages: readonly VerifyIngredientLineMessage[]): Promise<void>;
}

/** Config the SQS adapter needs (sourced from the service's env config). */
export type SqsVerificationQueueConfig = SqsBatchQueueConfig;

/** How a batch actually reaches SQS — injected; see `common/sqsBatchQueue.ts` for why. */
export type VerificationBatchSend = SqsBatchSend;

/**
 * Build the port over an injected transport.
 *
 * @param send - How a batch reaches SQS.
 * @param queueUrl - The queue every batch is addressed to.
 * @returns The port the service depends on.
 */
export function createVerificationQueue(send: VerificationBatchSend, queueUrl: string): VerificationQueuePort {
    return {
        enqueue: createSqsBatchEnqueue(verifyIngredientLineMessageSchema, send, queueUrl, 'verification enqueue'),
    };
}

/**
 * The SDK client settings, as a PURE value — see `sqsBatchClientConfig` for why it is separated from
 * construction (the SDK resolves handler config lazily, so a guard test cannot read it off the client).
 *
 * @param config - Queue URL + client settings.
 * @returns The settings an `SQSClient` is constructed with. Pure.
 */
export function sqsClientConfig(config: SqsVerificationQueueConfig): ReturnType<typeof sqsBatchClientConfig> {
    return sqsBatchClientConfig(config);
}

/** The real transport, plus the SDK client it wraps (exposed so its configuration can be asserted). */
export interface SqsVerificationTransport {
    readonly send: VerificationBatchSend;
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
export function createSqsVerificationTransport(config: SqsVerificationQueueConfig): SqsVerificationTransport {
    return createSqsBatchTransport(config);
}

/**
 * Build a {@link VerificationQueuePort} over a real `SQSClient`. The client is created once and closed by the
 * process lifecycle (Nest never disposes singletons mid-run).
 *
 * @param config - Queue URL + client settings.
 * @returns The port `RecipesModule` provides under {@link VERIFICATION_QUEUE}.
 * @sideEffect Constructs an SDK client.
 */
export function createSqsVerificationQueue(config: SqsVerificationQueueConfig): VerificationQueuePort {
    return createVerificationQueue(createSqsVerificationTransport(config).send, config.queueUrl);
}
