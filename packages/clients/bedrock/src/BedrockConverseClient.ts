/**
 * The Bedrock `Converse` boundary for the ingredient verification gate (plan U11, ADR-0024).
 *
 * DESIGN PATTERN: **Adapter over a narrow Port**, with the pure/impure split this repository already uses in
 * `deploy-gate.sh` and in `evaluateProvenance` vs `RecipesService.create`. `createBedrockTransport` is
 * the only impure thing in the package — it constructs the SDK client and sends. `createBedrockConverseClient` is a pure function of a transport, so every failure mode below is exercised by
 * handing it a transport that fails that way, with no network, no credentials and no spend.
 *
 * ## ⛔ THE RETURN TYPE ENCODES ADR-0024'S REFUND RULE
 *
 * "Any outcome with no billed response refunds in full." That is not a comment here; it is the shape:
 *
 *  - **No billed response ⇒ THROW.** Every member of the taxonomy carries `billed`, and the ones AWS
 *    documents as pre-inference refusals carry `billed: false`. An unrecognised failure carries `billed:
 *    true`, so a failure mode nobody has enumerated keeps its reservation rather than triggering a refund on
 *    a guess.
 *  - **A response arrived ⇒ RETURN**, carrying the `usage` the settlement is costed from — or, when the
 *    envelope is unreadable, `usage: undefined`, which the caller must distinguish from zero.
 *
 * So the settle path has two shapes to handle instead of an open-ended `instanceof` ladder that would drift
 * away from this file.
 *
 * ## ⛔ RETRIES ARE OFF, AND THAT IS A SPEND DECISION
 *
 * The SDK's default is three attempts with backoff. Inside a reserve-then-settle gate that is up to three
 * BILLED calls charged against ONE worst-case reservation, with the extra two invisible to the counter —
 * i.e. a ceiling quietly three times what the owner set. Retrying is the QUEUE's job (layer 0's
 * `maxReceiveCount` + DLQ), where each attempt takes its own reservation.
 *
 * ## What this module deliberately does NOT do
 *
 * It does not build the prompt, cap the input, parse the verdict, or judge a `stopReason`. Those are the
 * verifier's domain rules; a client that folded them in would make them untestable without an SDK and would
 * put "only `end_turn` may be trusted" in the one place a reader would never look for it.
 */
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import type { ConverseCommandInput } from '@aws-sdk/client-bedrock-runtime';

import {
    BedrockAccessDeniedError,
    BedrockClientError,
    BedrockInvalidRequestError,
    BedrockThrottledError,
    BedrockTimeoutError,
    BedrockUnavailableError,
} from './errors.js';
import { converseOutputSchema, firstTextIn, usageSchema, type BedrockTokenUsage } from './schemas.js';

/**
 * One verification call.
 *
 * ⛔ `maxOutputTokens` is REQUIRED, not optional-with-a-default. Layer 1 of ADR-0024's six is "explicit
 * `maxTokens` + input-token cap", and "without them the reservation is a lie". A default would let a caller
 * silently acquire an unbounded worst case; a required field makes forgetting it a compile error.
 */
export interface ConverseRequest {
    /**
     * The id Bedrock is CALLED with, resolved at cold start — never a constant at the call site.
     *
     * ⛔ NOT necessarily the model's own id, and NOT the id a verdict is recorded against. A model that
     * reports `inferenceTypesSupported: ["INFERENCE_PROFILE"]` — Claude Haiku 4.5 does — refuses its bare id
     * with `ValidationException: Invocation of model ID … with on-demand throughput isn't supported`, and must
     * be addressed through a cross-region inference profile (`us.anthropic.claude-haiku-4-5-…`). The rate
     * table (ADR-0024) and the recorded model identity key on the BARE id. For an on-demand model the two
     * coincide; for a profile model they cannot, so this field names the invocation and nothing else.
     */
    readonly invocationId: string;
    /** The instructions. Kept apart from the user turn so an embedded directive cannot impersonate one. */
    readonly systemPrompt: string;
    /** The user turn, carrying the delimited (and already length-checked) source line. */
    readonly userMessage: string;
    /** `inferenceConfig.maxTokens`. Half of the worst-case reservation. */
    readonly maxOutputTokens: number;
    /** `inferenceConfig.temperature`. Omitted leaves the model's own default. */
    readonly temperature?: number | undefined;
}

/**
 * What a call that ARRIVED produced.
 *
 * ⚠️ `unusable` is not an error and must not be turned into one: the response arrived, so it was billed, and
 * the settlement still needs its `usage`. It carries `usage: undefined` only when the token counts themselves
 * could not be read — a genuinely different state from "this call was free", and the caller must treat it as
 * "cost unknown, keep the reservation" rather than as a refund.
 */
export type ConverseOutcome =
    | {
          readonly kind: 'answered';
          /** The first assistant text block, verbatim. Unparsed — the verdict schema is the caller's. */
          readonly text: string;
          /** Passed through as received, including values outside the SDK's enum. */
          readonly stopReason: string;
          readonly usage: BedrockTokenUsage;
      }
    | {
          readonly kind: 'unusable';
          /** Why the envelope could not be read. Diagnostic; never shown to a user. */
          readonly reason: string;
          readonly stopReason: string | undefined;
          /** `undefined` means COST UNKNOWN, never zero. See the docstring above. */
          readonly usage: BedrockTokenUsage | undefined;
      };

/** The narrow port over the SDK's `send`. The one seam the tests replace. */
export type ConverseTransport = (input: ConverseCommandInput) => Promise<unknown>;

/** The gate's view of Bedrock. */
export interface BedrockConverseClient {
    /**
     * Issue one `Converse` call.
     *
     * @param request - The invocation id, the two prompt halves, and the output cap.
     * @returns What arrived; see {@link ConverseOutcome}.
     * @throws {BedrockClientError} When no response arrived. Read `billed` to decide the refund.
     * @sideEffect Delegates to the transport, which calls Bedrock.
     */
    converse(request: ConverseRequest): Promise<ConverseOutcome>;
}

/**
 * SDK exception names that AWS documents as refusals BEFORE inference — the only ones that refund.
 *
 * ⛔ Membership is the whole refund decision, so it is a table rather than a chain of `if`s: a name absent
 * here inherits {@link BedrockClientError}'s `billed: true` and keeps its reservation. That default is what
 * makes this list safe to be incomplete.
 */
const UNBILLED_FAILURES: Readonly<Record<string, () => BedrockClientError>> = Object.freeze({
    ThrottlingException: () => new BedrockThrottledError(),
    ServiceUnavailableException: () => new BedrockUnavailableError(),
    InternalServerException: () => new BedrockUnavailableError(),
    ModelNotReadyException: () => new BedrockUnavailableError(),
    ServiceQuotaExceededException: () => new BedrockThrottledError('bedrock: service quota exceeded'),
    AccessDeniedException: () => new BedrockAccessDeniedError(),
    ValidationException: () => new BedrockInvalidRequestError(),
    ModelTimeoutException: () => new BedrockTimeoutError(),
    TimeoutError: () => new BedrockTimeoutError(),
    AbortError: () => new BedrockTimeoutError(),
});

/**
 * Translate a thrown value into the taxonomy.
 *
 * ⚠️ The provider's own message is deliberately DISCARDED rather than wrapped: an upstream error can quote
 * the request, and the request contains a user's recipe line. The exception NAME is enough to act on and
 * carries no payload.
 *
 * @param thrown - Whatever the transport rejected with.
 * @returns The typed error to raise. Pure.
 */
function classify(thrown: unknown): BedrockClientError {
    const name = thrown instanceof Error ? thrown.name : '';
    const build = Object.hasOwn(UNBILLED_FAILURES, name) ? UNBILLED_FAILURES[name] : undefined;

    if (build !== undefined) {
        return build();
    }

    // ⛔ Assumed BILLED. See errors.ts: refunding a call that was billed under-counts, and a counter that
    // under-reports during a runaway reports green precisely when it matters.
    return new BedrockClientError(`bedrock: unrecognised failure (${name === '' ? 'non-Error' : name})`);
}

/**
 * Read the token counts off a response, or `undefined` when they are unreadable.
 *
 * @param body - The raw response.
 * @returns The usage, or `undefined`. Pure.
 */
function usageOf(body: unknown): BedrockTokenUsage | undefined {
    const envelope = body as { usage?: unknown } | null | undefined;
    const parsed = usageSchema.safeParse(envelope?.usage);

    return parsed.success ? parsed.data : undefined;
}

/**
 * Build a client over a transport.
 *
 * @param send - The transport. `createBedrockTransport(...).send` in production.
 * @returns The client. Pure — the returned method is impure through `send`.
 */
export function createBedrockConverseClient(send: ConverseTransport): BedrockConverseClient {
    return {
        async converse(request: ConverseRequest): Promise<ConverseOutcome> {
            const input: ConverseCommandInput = {
                // The SDK calls this `modelId`; ours is `invocationId` because for a profile-only model it is
                // not the model's id. Translating one vocabulary into the other is this adapter's job — the
                // alternative, re-exporting the SDK's name, would make the whole distinction a convention.
                modelId: request.invocationId,
                system: [{ text: request.systemPrompt }],
                messages: [{ role: 'user', content: [{ text: request.userMessage }] }],
                inferenceConfig: {
                    maxTokens: request.maxOutputTokens,
                    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
                },
            };

            let body: unknown;

            try {
                body = await send(input);
            } catch (thrown) {
                throw classify(thrown);
            }

            const usage = usageOf(body);
            const parsed = converseOutputSchema.safeParse(body);

            if (!parsed.success) {
                return {
                    kind: 'unusable',
                    reason: 'the response envelope did not match the Converse output shape',
                    stopReason: undefined,
                    usage,
                };
            }

            const text = firstTextIn(parsed.data.output.message.content);

            if (text === undefined) {
                return {
                    kind: 'unusable',
                    reason: 'the response carried no assistant text block',
                    stopReason: parsed.data.stopReason,
                    usage,
                };
            }

            if (usage === undefined) {
                // A readable answer we cannot COST. Reported as unusable so the settlement keeps the
                // worst-case charge standing: settling this at zero would refund a call that really spent.
                return {
                    kind: 'unusable',
                    reason: 'the response carried no readable usage, so its cost is unknown',
                    stopReason: parsed.data.stopReason,
                    usage: undefined,
                };
            }

            return { kind: 'answered', text, stopReason: parsed.data.stopReason, usage };
        },
    };
}

/** Settings for the real transport. */
export interface BedrockTransportConfig {
    /** The AWS region hosting the model. */
    readonly region: string;
    /** Overall per-request deadline. Bounds how long one reservation stays outstanding. */
    readonly requestTimeoutMs?: number | undefined;
}

/** The real transport, plus the SDK client it wraps (exposed so its configuration can be asserted). */
export interface BedrockTransport {
    readonly send: ConverseTransport;
    /** The configured SDK client. Exported so a guard test can prove `maxAttempts` is pinned. */
    readonly client: BedrockRuntimeClient;
}

/**
 * Build the real transport.
 *
 * ⛔ `maxAttempts: 1`. See the file docstring: SDK-internal retries would spend up to three times one
 * reservation with no counter entry for the extra calls. Retrying belongs to the queue.
 *
 * @param config - Region and optional request deadline.
 * @returns The transport and its client.
 * @sideEffect Constructs an SDK client; the returned `send` calls Bedrock.
 */
export function createBedrockTransport(config: BedrockTransportConfig): BedrockTransport {
    const client = new BedrockRuntimeClient({
        region: config.region,
        maxAttempts: 1,
        ...(config.requestTimeoutMs === undefined
            ? {}
            : { requestHandler: { requestTimeout: config.requestTimeoutMs } }),
    });

    return {
        client,
        send: (input: ConverseCommandInput): Promise<unknown> => client.send(new ConverseCommand(input)),
    };
}
