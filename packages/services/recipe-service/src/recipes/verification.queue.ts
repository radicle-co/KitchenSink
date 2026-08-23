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
 * `RecipesService` awaits this inside `POST /api/v1/recipes`. Its `try/catch` stops a THROWN failure from
 * failing the save; it does nothing about a STALL, and the AWS SDK stalls by default. Verified against
 * `@smithy/node-http-handler` in this tree: `setConnectionTimeout(request, reject, timeoutInMs = 0)` and
 * `setRequestTimeout(req, reject, timeoutInMs = 0)` both return `-1` when the value is falsy — **neither
 * timeout is set unless you set it** — while `maxAttempts` defaults to 3.
 *
 * So a blackholed endpoint (a security-group change, a wrong URL in SSM — ADR-0010 exists because that class
 * of misconfiguration is real) would hang the request until the ALB's idle timeout and hand the cook a `504`
 * on a recipe that WAS created. That is precisely the availability regression this producer's docstring
 * claims to prevent, arriving through the one door the `try/catch` does not cover. Hence:
 *
 *  1. **Explicit connection and request timeouts**, so a stall is a fast, catchable failure.
 *  2. **`maxAttempts: 2`**, because a retry budget multiplies the worst case and this work is droppable.
 *  3. **Batches sent CONCURRENTLY**, so a 100-line recipe (`MAX_RECIPE_INGREDIENTS`) costs one round trip's
 *     latency rather than ten. Ordering is irrelevant: verdicts are content-keyed and their write is an
 *     upsert, so two messages racing produce the same row.
 *
 * ## ⛔ EVERY MESSAGE IS PARSED AGAINST THE CONSUMER'S OWN SCHEMA BEFORE IT IS SENT
 *
 * Producer and consumer are different packages that deploy separately, and three fields here are bounded
 * more tightly than the wire or the column that feeds them: `unit` is `text` with no wire maximum,
 * `candidateFoodName` is food-service's `text`, and `sourceLine`'s cap is measured in code points. A message
 * that violates any of them is POISON — redelivered 20 times under `maxReceiveCount: 20`, then resident for
 * three days in a DLQ that holds a cook's recipe text, while the API reports success.
 *
 * Parsing here converts that into the outcome the system is designed to tolerate: the line goes unverified,
 * which `0023_line_verifications.sql` establishes is simply "publish", i.e. today's behaviour — and the
 * caller gets a loud, countable error instead of silence. This is parse-don't-validate applied at the one
 * boundary where the two halves of the contract can drift.
 *
 * ## ⚠️ A BATCH IS NOT ATOMIC
 *
 * `SendMessageBatch` can return `2xx` with a populated `Failed` array, so an unchecked call reports success
 * having delivered nothing. Failures are collected across ALL batches and reported once at the end — never
 * thrown mid-loop, which would abandon every batch after the first and silently drop the other ninety
 * messages of a large recipe.
 */
import {
    SendMessageBatchCommand,
    SQSClient,
    type SendMessageBatchCommandInput,
    type SQSClientConfig,
    type SendMessageBatchCommandOutput,
    type SendMessageBatchRequestEntry,
} from '@aws-sdk/client-sqs';
import {
    verifyIngredientLineMessageSchema,
    type VerifyIngredientLineMessage,
} from '@kitchensink/recipe-core/resolution/verification-message';

/** DI token for the verification queue port — provided by `RecipesModule` via `useFactory` over the env config. */
export const VERIFICATION_QUEUE = 'VERIFICATION_QUEUE';

/** AWS's hard limit on entries in one `SendMessageBatch` call. */
const SQS_BATCH_LIMIT = 10;

/** How long to wait for a TCP connection before giving up (ms). See the file docstring — the SDK sets none. */
const CONNECTION_TIMEOUT_MS = 1_000;

/** How long to wait for a whole request before giving up (ms). */
const REQUEST_TIMEOUT_MS = 2_000;

/**
 * Total SDK attempts per batch, including the first.
 *
 * Two rather than the SDK's three: the retry budget multiplies the worst case on a user's save path, and a
 * verification request is explicitly droppable. One retry absorbs a transient blip; a second buys little and
 * costs a whole request timeout.
 */
const MAX_ATTEMPTS = 2;

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

/**
 * One batch entry.
 *
 * `Id` is positional WITHIN THE BATCH and scoped to the call — SQS requires only that it be unique among the
 * entries of one request, and `batch.map` re-bases it per chunk. It is not the message's identity (that is
 * the content-derived `verificationKey` the worker computes), but it is what a `Failed` entry names, which
 * is why the reporting below carries it. Pure.
 */
function entryFor(message: VerifyIngredientLineMessage, index: number): SendMessageBatchRequestEntry {
    return { Id: String(index), MessageBody: JSON.stringify(message) };
}

/**
 * Keep only the messages the CONSUMER would accept, reporting the rest.
 *
 * @param messages - The candidate requests.
 * @returns The sendable messages, and one description per refusal. Pure.
 */
function partitionSendable(messages: readonly VerifyIngredientLineMessage[]): {
    readonly sendable: readonly VerifyIngredientLineMessage[];
    readonly refused: readonly string[];
} {
    const sendable: VerifyIngredientLineMessage[] = [];
    const refused: string[] = [];

    for (const message of messages) {
        const parsed = verifyIngredientLineMessageSchema.safeParse(message);

        if (parsed.success) {
            sendable.push(message);
        } else {
            // ⛔ The line, never the line's TEXT. This string reaches a log group; `sourceLine` is a cook's
            // recipe text and the whole point of refusing the message is to keep that out of places it does
            // not belong. The field paths say what was wrong without quoting the user.
            refused.push(parsed.error.issues.map((issue) => issue.path.join('.')).join(','));
        }
    }

    return { sendable, refused };
}

/**
 * How a batch actually reaches SQS.
 *
 * ⛔ INJECTED, exactly as `@kitchensink/bedrock-client` injects `ConverseTransport`, and for the same reason:
 * everything above this line — the contract parse, the chunking, the cross-batch failure collection — is
 * REAL LOGIC that a LocalStack test cannot exercise. LocalStack accepts poison happily and will not
 * manufacture a partial-batch failure on request. Splitting the transport out is what lets those rules be
 * asserted directly instead of hoped for.
 */
export type VerificationBatchSend = (input: SendMessageBatchCommandInput) => Promise<SendMessageBatchCommandOutput>;

/**
 * Build the port over an injected transport.
 *
 * @param send - How a batch reaches SQS.
 * @param queueUrl - The queue every batch is addressed to.
 * @returns The port the service depends on.
 */
export function createVerificationQueue(send: VerificationBatchSend, queueUrl: string): VerificationQueuePort {
    return {
        async enqueue(messages: readonly VerifyIngredientLineMessage[]): Promise<void> {
            const { sendable, refused } = partitionSendable(messages);
            const problems = refused.map((fields) => `refused by the contract (${fields})`);

            if (sendable.length > 0) {
                // Concurrent, and SETTLED rather than raced: one failing batch must not abandon the others.
                // Ordering is irrelevant — verdicts are content-keyed and their write is an upsert, so two
                // messages racing produce the same row.
                const results = await Promise.allSettled(
                    batches(sendable).map(async (batch) => send({ QueueUrl: queueUrl, Entries: batch.map(entryFor) })),
                );

                for (const [index, result] of results.entries()) {
                    if (result.status === 'rejected') {
                        const reason: unknown = result.reason;

                        problems.push(
                            `batch ${String(index)} failed: ${reason instanceof Error ? reason.message : String(reason)}`,
                        );

                        continue;
                    }

                    for (const failure of result.value.Failed ?? []) {
                        // ⛔ A 2xx with a populated `Failed` array is a PARTIAL failure, and ignoring it is
                        // how a send reports success having delivered nothing.
                        problems.push(
                            `batch ${String(index)} entry ${failure.Id ?? '?'} rejected: ${failure.Code ?? 'unknown'}`,
                        );
                    }
                }
            }

            if (problems.length > 0) {
                throw new Error(
                    `verification enqueue: ${String(problems.length)} of ${String(messages.length)} messages ` +
                        `were not delivered — ${problems.join('; ')}`,
                );
            }
        },
    };
}

/**
 * The SDK client settings, as a PURE value.
 *
 * ⛔ Separated from construction so the bounds can be ASSERTED. `NodeHttpHandler` resolves its own config
 * lazily — `client.config.requestHandler.httpHandlerConfigs()` answers `{}` until a request has actually run
 * — so a guard test that reached into the constructed client would read empty and pass whatever the code
 * said. This function is the judgement; the constructor is the effect.
 *
 * @param config - Queue URL + client settings.
 * @returns The settings an `SQSClient` is constructed with. Pure.
 */
export function sqsClientConfig(config: SqsVerificationQueueConfig): SQSClientConfig {
    return {
        region: config.region,
        maxAttempts: MAX_ATTEMPTS,
        // ⛔ NOT decoration — the SDK's own defaults are "no timeout at all". See the file docstring.
        requestHandler: { connectionTimeout: CONNECTION_TIMEOUT_MS, requestTimeout: REQUEST_TIMEOUT_MS },
        // A custom endpoint means LocalStack (the convention `createSqsErasureQueue` established). Pin static
        // test credentials so the integration tier is self-contained rather than depending on ambient host/CI
        // AWS config. Real AWS keeps the default credential chain (the ECS task role).
        ...(config.endpoint !== undefined
            ? { endpoint: config.endpoint, credentials: { accessKeyId: 'test', secretAccessKey: 'test' } }
            : {}),
    };
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
    const client = new SQSClient(sqsClientConfig(config));

    return { client, send: async (input) => client.send(new SendMessageBatchCommand(input)) };
}

/**
 * Build a {@link VerificationQueuePort} over a real `SQSClient`. The client is created once and closed by the
 * process lifecycle (Nest never disposes singletons mid-run).
 *
 * @param config - Queue URL + client settings.
 * @returns The port the service depends on.
 */
export function createSqsVerificationQueue(config: SqsVerificationQueueConfig): VerificationQueuePort {
    return createVerificationQueue(createSqsVerificationTransport(config).send, config.queueUrl);
}
