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
 * ## ⛔ WHY `SendMessageBatch` AND NOT A LOOP OF `SendMessage`
 *
 * One recipe save produces one message PER INGREDIENT LINE, and the corpus's recipes run to dozens. A loop
 * would put dozens of sequential round trips on a user's synchronous save path — for work that is explicitly
 * asynchronous and explicitly allowed to be lost. `SendMessageBatch` caps that at one round trip per ten
 * messages, which is AWS's own limit on the call and therefore the chunk size below.
 *
 * ⚠️ A batch is NOT atomic. `SendMessageBatch` can return `2xx` with a populated `Failed` array, and an
 * unchecked call therefore reports success having sent nothing. The adapter inspects it — the partial failure
 * is the whole reason this is not a fire-and-forget `void client.send(...)`.
 */
import { SendMessageBatchCommand, SQSClient, type SendMessageBatchRequestEntry } from '@aws-sdk/client-sqs';
import type { VerifyIngredientLineMessage } from '@kitchensink/recipe-core/resolution/verification-message';

/** DI token for the verification queue port — provided by `RecipesModule` via `useFactory` over the env config. */
export const VERIFICATION_QUEUE = 'VERIFICATION_QUEUE';

/** AWS's hard limit on entries in one `SendMessageBatch` call. */
const SQS_BATCH_LIMIT = 10;

/** The queue the service asks the verification gate through. Implemented for real by {@link createSqsVerificationQueue}. */
export interface VerificationQueuePort {
    /**
     * Ask the gate about these lines.
     *
     * @param messages - The requests. An empty list is a no-op and issues no call.
     * @throws When the send fails, wholly or partly. ⛔ The CALLER swallows it — see
     *   `RecipesService.requestVerification`. It throws rather than swallowing here so the port stays
     *   honest: an adapter that hid its own failures could never be tested for them, and a future caller
     *   that DOES need to know would have no way to find out.
     * @sideEffect Issues one or more SQS `SendMessageBatch` requests.
     */
    enqueue(messages: readonly VerifyIngredientLineMessage[]): Promise<void>;
}

/** Config the SQS adapter needs (sourced from the service's env config). */
export interface SqsVerificationQueueConfig {
    /** The `recipe-verification` queue URL (`INGREDIENT_VERIFICATION_QUEUE_URL`). */
    readonly queueUrl: string;
    /** AWS region for the client. */
    readonly region: string;
    /** Custom endpoint (LocalStack) — omit for real AWS. */
    readonly endpoint?: string;
}

/** Split a list into chunks of at most {@link SQS_BATCH_LIMIT}. Pure. */
function batches(
    messages: readonly VerifyIngredientLineMessage[],
): readonly (readonly VerifyIngredientLineMessage[])[] {
    const chunks: (readonly VerifyIngredientLineMessage[])[] = [];

    for (let index = 0; index < messages.length; index += SQS_BATCH_LIMIT) {
        chunks.push(messages.slice(index, index + SQS_BATCH_LIMIT));
    }

    return chunks;
}

/** One batch entry. `Id` is positional and scoped to the call — it is not the message's identity. Pure. */
function entryFor(message: VerifyIngredientLineMessage, index: number): SendMessageBatchRequestEntry {
    return { Id: String(index), MessageBody: JSON.stringify(message) };
}

/**
 * Build a {@link VerificationQueuePort} over a real `SQSClient`. The client is created once and closed by the
 * process lifecycle (Nest never disposes singletons mid-run).
 *
 * @param config - Queue URL + client settings.
 * @returns The port the service depends on.
 */
export function createSqsVerificationQueue(config: SqsVerificationQueueConfig): VerificationQueuePort {
    const client = new SQSClient({
        // A custom endpoint means LocalStack (the convention `createSqsErasureQueue` established). Pin static
        // test credentials so the integration tier is self-contained rather than depending on ambient host/CI
        // AWS config. Real AWS keeps the default credential chain (the ECS task role).
        region: config.region,
        ...(config.endpoint !== undefined
            ? { endpoint: config.endpoint, credentials: { accessKeyId: 'test', secretAccessKey: 'test' } }
            : {}),
    });

    return {
        async enqueue(messages: readonly VerifyIngredientLineMessage[]): Promise<void> {
            if (messages.length === 0) {
                return;
            }

            for (const batch of batches(messages)) {
                const result = await client.send(
                    new SendMessageBatchCommand({
                        QueueUrl: config.queueUrl,
                        Entries: batch.map(entryFor),
                    }),
                );

                // ⛔ A 2xx with a populated `Failed` array is a PARTIAL failure, and ignoring it is how a
                // send reports success having delivered nothing.
                if (result.Failed !== undefined && result.Failed.length > 0) {
                    throw new Error(
                        `verification enqueue: ${result.Failed.length} of ${batch.length} messages were rejected ` +
                            `(first: ${result.Failed[0]?.Code ?? 'unknown'})`,
                    );
                }
            }
        },
    };
}
