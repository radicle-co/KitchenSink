/**
 * THE LLM PARSE LEG (plan U18 / KTD-10, KTD-17; ADR-0024) — reserve → call → settle → read.
 *
 * DESIGN PATTERNS: **Composition root** over four narrow Ports (the spend ledger, the Bedrock adapter, the
 * settings resolver, the metric sink), each replaced wholesale in the unit suite; plus **parse, don't
 * validate** at the boundary (`readParseAnswer`) and a **pure assembling factory** for the call
 * (`buildParsePrompt`). Every JUDGEMENT this module appears to make was already made by a pure function —
 * `planReservation` priced the call, `readParseAnswer` judged the answer, `normalizeParseAnswer` collapsed
 * the absent-measure forms — so what is left here is ORCHESTRATION and the one thing orchestration owns:
 * which failures are transient and which are terminal.
 *
 * ## ⛔ THIS IS THE SECOND OPINION, AND IT IS ONLY WORTH ANYTHING IF IT IS INDEPENDENT
 *
 * KTD-10 runs BOTH engines on every line and lets a comparator adjudicate, precisely so that neither reading
 * is anchored to the other. That premise is only true if this call cannot see the CRF's answer — plan U18:
 * *"Nothing from the CRF's output, and no signal derived from it, is ever placed in the LLM's prompt."*
 * Showing the model our parse pulls it toward agreeing with what it was shown, which would inflate the
 * agreement rate the comparator's whole shape-classification is calibrated against, INVISIBLY — the failure
 * would look like the two engines getting better.
 *
 * So the independence is STRUCTURAL, not a convention:
 *
 *  - {@link parseLineWithLlm} takes the deps and the SOURCE LINE. There is no third parameter.
 *  - `buildParsePrompt` takes the line and nothing else — a second argument is a compile error.
 *  - {@link LlmParseDeps} carries four ports and two injected primitives. None of them can hold a parse.
 *
 * All three are asserted at the TYPE level in `__tests__/llmParse.test.ts`, because a reviewer can miss a
 * second argument and `tsc` cannot.
 *
 * ## ⛔ THE DISTINCTION THIS FILE EXISTS TO GET RIGHT (ADR-0024, and the sibling gate says it too)
 *
 *  - **TRANSIENT** — a ceiling denial, an unreadable counter, unreadable settings, an unpriced model, a
 *    provider failure. It THROWS: the message returns to the queue and retries under layer 0's
 *    `maxReceiveCount` + DLQ, where an exhausted ceiling is visible as queue depth instead of as silently
 *    degraded recipes. No parse is produced, and none is invented.
 *  - **TERMINAL** — a reading, or an answer we cannot believe, or a line too long to send. A value is
 *    RETURNED, and the money is not spent again. Retrying a deterministic refusal only fills the DLQ slower.
 *
 * ⚠️ A refusal is a REFUSAL, never a `ParsedLine` with empty fields. The comparator must be able to tell "the
 * LLM had no opinion" from "the LLM read the line and found no food" — the second is a legitimate answer
 * about a heading, and treating the first as the second would silently hand every field to the CRF while
 * reporting agreement.
 *
 * ## ⛔ NOTHING AFTER THE MONEY IS SPENT MAY FAIL THIS FUNCTION
 *
 * Once `converse` has returned, the call is billed. A throw from the settlement would redeliver the message,
 * which would reserve and call AGAIN — spending twice for one line because a bookkeeping write did not land.
 * The settlement is therefore metered and swallowed, and the standing reservation OVER-counts, which is
 * ADR-0024's explicitly accepted direction.
 *
 * ## ⚠️ ONE ARGUED DEPARTURE FROM PLAN U18's LITERAL WORDING — the settlement of a malformed answer
 *
 * U18 says a `malformed_model_output` stop reason takes "the same fail-closed route as
 * `ServiceUnavailableException`", and its scenario list says a malformed response "refunds in full". The
 * OUTCOME is identical here — fail closed, no parse, no in-place retry. The MONEY is not, and cannot be:
 * `ServiceUnavailableException` refunds because AWS never ran the model, while a malformed answer means the
 * model DID run and reported `usage`. Refunding a billed response in full is precisely the silent under-count
 * reserve-then-settle exists to prevent, and ADR-0024 keys the refund on "any outcome with **no billed
 * response**", not on whether the answer was useful. `verifyLine.ts` already settles an unreadable verdict
 * from its `usage` for the same reason. Full refunds here are reserved for the throw path, where the client's
 * `settlement` field says nothing was billed.
 */
import {
    actualCostMicros,
    planReservation,
    INGREDIENT_PARSE_CALL_SITE,
    type PricedReservation,
} from '@kitchensink/recipe-core/spend/spend-arithmetic';
import {
    MAX_PARSE_PROMPT_CHARS,
    PARSE_MAX_INPUT_TOKENS,
    PARSE_MAX_OUTPUT_TOKENS,
    PARSE_TEMPERATURE,
    buildParsePrompt,
    isParsePromptTooLargeError,
} from '@kitchensink/recipe-core/parsing/parse-prompt';
import type { LlmParse } from '@kitchensink/recipe-core/parsing/parse-answer';
import { isBedrockClientError, type BedrockConverseClient } from '@kitchensink/bedrock-client';

import { logger } from '../common/logger.js';
import type { EmfMetric } from '../common/metrics.js';
import { SETTLE_FAILURE_METRIC_NAME, SPEND_METRIC_NAME, SPEND_METRIC_NAMESPACE } from '../common/spendMetrics.js';
import { isSpendGated, type SpendLedger } from '../common/verificationSpend.js';
import { readParseAnswer, type ParseRefusal } from './readParseAnswer.js';

/**
 * The operator-controlled settings this leg needs.
 *
 * ⛔ The CEILING is the same $100/month figure the verification gate reads — ONE global pool (KTD-17), not a
 * share of one. The MODEL is not necessarily the same: the gate and the parse leg are different tasks, were
 * measured separately, and their SSM parameters may point at different models. That is why this is its own
 * narrow port rather than a reuse of `VerificationSettingsResolver` — which, being structurally identical,
 * remains assignable to it wherever an operator does want them wired to the same parameters.
 */
export interface LlmParseSettings {
    /** The monthly ceiling, in micro-dollars. Zero is a valid kill switch. */
    readonly ceilingMicros: number;
    /** The Bedrock model id. Must be one the rate table prices, or the leg fails closed. */
    readonly modelId: string;
}

/** How the settings are resolved. Replaced wholesale in tests. */
export interface LlmParseSettingsResolver {
    /**
     * The current settings.
     *
     * @returns The settings.
     * @throws When they cannot be read. FAIL CLOSED — no call is made, and the message retries.
     * @sideEffect May read SSM.
     */
    resolve(): Promise<LlmParseSettings>;
}

/**
 * Everything this leg talks to, injected.
 *
 * ⛔ FOUR PORTS AND TWO PRIMITIVES, AND THAT IS THE WHOLE SURFACE. Every member is infrastructure; none of
 * them can carry a reading of the line. Adding a member that could — `crf`, `hint`, `priorParse` — breaks the
 * type-level assertion in the unit suite, which is the point: see the file docstring on independence.
 */
export interface LlmParseDeps {
    /** The deploy stage — the ONLY input to the prod-only ceiling ruling (ADR-0024 §3). */
    readonly stage: string;
    readonly settings: LlmParseSettingsResolver;
    readonly ledger: SpendLedger;
    readonly bedrock: BedrockConverseClient;
    /** Metric sink, injected so the unit suite can read what was published. */
    readonly emit: (metric: EmfMetric) => void;
    /** Clock, injected so the period key is testable across a month boundary. */
    readonly now: () => Date;
}

/** Why this leg produced no reading. All TERMINAL; the queue must not retry any of them. */
export type LlmParseRefusal =
    /** The assembled prompt would breach layer 1's input cap. ⛔ REJECTED, never truncated. */
    'line-too-large' | ParseRefusal;

/** What the leg concluded about one line. */
export type LlmParseOutcome =
    | {
          readonly kind: 'parsed';
          readonly parse: LlmParse;
          /** ⛔ The model's IDENTITY (the registry key), not the id Bedrock was addressed with. */
          readonly modelId: string;
      }
    | {
          /** No reading, and deliberately not an empty one. See the file docstring. */
          readonly kind: 'refused';
          readonly refusal: LlmParseRefusal;
          /** Why. Diagnostic; never carries the response body or the source line. */
          readonly detail: string;
      };

/** A named refusal, spelled once so every branch below reads as one decision. */
const refuse = (refusal: LlmParseRefusal, detail: string): LlmParseOutcome => ({ kind: 'refused', refusal, detail });

/**
 * Publish the dollar metric, attributed to this leg.
 *
 * ⛔ The SAME namespace and metric name as the verification gate. ADR-0024 layer 4 alarms on ONE pool; a
 * consumer emitting under a name of its own would be invisible to the alarm the ceiling depends on. The
 * claimant rides on the `CallSite` DIMENSION and nowhere else — nothing about the reservation may learn about
 * it, or one pool silently becomes several of unstated size (KTD-17).
 *
 * @param deps - The leg's collaborators.
 * @param micros - The period's reserved total, or this call's actual cost where the counter is bypassed.
 * @sideEffect Emits one EMF line.
 */
function publishSpend(deps: LlmParseDeps, micros: number): void {
    deps.emit({
        namespace: SPEND_METRIC_NAMESPACE,
        name: SPEND_METRIC_NAME,
        // CloudWatch has no currency unit — see `common/metrics.ts`. The denomination is in the metric NAME.
        unit: 'None',
        stage: deps.stage,
        value: micros,
        dimensions: { CallSite: INGREDIENT_PARSE_CALL_SITE },
    });
}

/**
 * Settle, metering (and swallowing) a failure.
 *
 * ⛔ NEVER RETRIED, and never allowed to fail the leg. `reserved_micros + $delta` is not idempotent with a
 * negative delta, so a retried settle double-refunds and reintroduces exactly the silent under-count
 * reserve-then-settle exists to prevent; and a throw here would redeliver a message whose call was already
 * billed.
 *
 * @param deps - The leg's collaborators.
 * @param plan - The plan the reservation was taken under, carrying its captured period.
 * @param actualMicros - What the call cost. Zero ONLY for an outcome with no billed response.
 * @sideEffect Writes to `verification_spend`; emits a metric on failure.
 */
async function settleQuietly(deps: LlmParseDeps, plan: PricedReservation, actualMicros: number): Promise<void> {
    try {
        await deps.ledger.settle({ plan, actualMicros });
    } catch (error) {
        deps.emit({
            namespace: SPEND_METRIC_NAMESPACE,
            name: SETTLE_FAILURE_METRIC_NAME,
            unit: 'Count',
            stage: deps.stage,
            value: 1,
        });
        logger.error('ingredient parse settle failed; the reservation stands unrefunded', {
            period: plan.period,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

/**
 * Ask the model to read one ingredient line.
 *
 * ⛔ TWO PARAMETERS. See the file docstring: a third is the seam through which the CRF's reading would reach
 * the model, and the type system is the only reviewer that never misses one.
 *
 * @param deps - The leg's collaborators.
 * @param line - The source line, exactly as the source holds it. Sent verbatim, as third-party DATA.
 * @returns The model's reading, or a named terminal refusal.
 * @throws When the outcome is TRANSIENT and the message must return to the queue.
 * @sideEffect Reads settings, writes the spend counter, calls Bedrock, emits metrics.
 */
export async function parseLineWithLlm(deps: LlmParseDeps, line: string): Promise<LlmParseOutcome> {
    // 1. The prompt FIRST, so an over-long line costs nothing — not a settings read, not a reservation, not a
    //    call. ⛔ REJECTED, never truncated: a truncated line asks the model to parse text the source did not
    //    write, and the answer would be recorded against the whole line.
    let prompt: ReturnType<typeof buildParsePrompt>;

    try {
        prompt = buildParsePrompt(line);
    } catch (error) {
        if (isParsePromptTooLargeError(error)) {
            logger.warn('ingredient parse refused an over-cap line', {
                observedChars: error.observedChars,
                capChars: MAX_PARSE_PROMPT_CHARS,
            });

            return refuse('line-too-large', `the line exceeds the ${MAX_PARSE_PROMPT_CHARS}-character prompt cap`);
        }

        throw error;
    }

    // 2. Settings, then the price. Both TRANSIENT on failure — with no ceiling and no rate there is no worst
    //    case, so there is nothing to reserve and the call must not be made.
    const settings = await deps.settings.resolve();
    const plan = planReservation({
        modelId: settings.modelId,
        ceilingMicros: settings.ceilingMicros,
        maxInputTokens: PARSE_MAX_INPUT_TOKENS,
        maxOutputTokens: PARSE_MAX_OUTPUT_TOKENS,
        nowUtc: deps.now(),
    });

    if (plan.kind === 'unpriced') {
        // ⛔ Membership of the rate table IS authorization: with no rate there is no worst case, so an
        // unpriced model can only ever cost a denial, never uncounted spend.
        throw new Error(
            `ingredient parse model '${plan.modelId}' is not priced by the rate table; refusing to call it`,
        );
    }

    // 3. Reserve — PROD ONLY (ADR-0024 §3, owner ruling 2026-08-21). Sandbox and every pr-{N} call ungated,
    //    because ADR-0006 gives each PR its own logical database and Postgres cannot read across them.
    const gated = isSpendGated(deps.stage);

    if (gated) {
        const reservation = await deps.ledger.reserve(plan);

        if (reservation.kind === 'denied') {
            // ⛔ TRANSIENT. Not a judgement about this line, so no reading is recorded — the message retries
            // and, if the ceiling stays exhausted, drains to the DLQ where it is visible as queue depth.
            throw new Error(`ingredient parse ceiling reached for ${reservation.period}; the call was not made`);
        }

        publishSpend(deps, reservation.reservedMicros);
    }

    // 4. The call.
    let outcome: Awaited<ReturnType<BedrockConverseClient['converse']>>;

    try {
        outcome = await deps.bedrock.converse({
            // ⛔ THE ADDRESS, NOT THE IDENTITY (U35). `plan.modelId` is what the model IS — the registry key,
            // and what the reading below is recorded against. `plan.invocationId` is how Bedrock is REACHED,
            // which for a profile-only model is an `inference-profile` id that is not a model id at all.
            invocationId: plan.invocationId,
            systemPrompt: prompt.systemPrompt,
            userMessage: prompt.userMessage,
            maxOutputTokens: PARSE_MAX_OUTPUT_TOKENS,
            // ⛔ Part of the measured configuration, not a call-site default. See `parsePrompt.ts`.
            temperature: PARSE_TEMPERATURE,
            // ⛔ THE SYSTEM PROMPT IS 99% OF THE BILL — 5,025 tokens against 13 of line and 37 of answer.
            // Uncached, every call pays all 5,025 as fresh input; cached they are reads at 25% of that rate
            // and Nova bills the write at zero. Measured: $0.000521/line cached against $0.001764 without.
            cachePrompt: true,
            // ⛔ HALF PRICE, AND IT KEEPS THE CACHE. Batch is also 50% off but AWS documents prompt caching as
            // on-demand-only and "not supported with the batch inference API", so batch would surrender the
            // 75% cache discount to buy a 50% one and cost MORE on a prompt this size. flex does neither.
            // ⚠️ flex is a relaxed-scheduling tier: this leg is an SQS consumer with maxReceiveCount + DLQ,
            // so it already tolerates latency and retry. A latency-sensitive caller must NOT copy this.
            serviceTier: 'flex',
        });
    } catch (error) {
        if (gated && isBedrockClientError(error) && error.settlement === 'refund-full') {
            await settleQuietly(deps, plan, 0);
        }

        // ⛔ TRANSIENT, and NO reading. A provider outage would otherwise strip the second opinion from every
        // line in flight, for a reason that is about AWS rather than about any recipe — and the comparator
        // would record a CRF-only parse as if that were the design.
        throw error;
    }

    // 5. Settle from what was actually billed, BEFORE reading anything. From here nothing may throw.
    const usage = outcome.usage;

    if (gated) {
        if (usage === undefined) {
            // ⛔ COST UNKNOWN is not zero. Settling at zero here would refund a call that really spent;
            // leaving the worst case standing over-counts, which is ADR-0024's accepted direction.
            logger.warn('ingredient parse response carried no readable usage; the reservation stands', {
                period: plan.period,
            });
        } else {
            await settleQuietly(deps, plan, actualCostMicros(plan.rate, usage));
        }
    } else {
        // The dollar metric is emitted in EVERY stage — it costs one log line and it is the only visibility on
        // the ungated exposure ADR-0024 accepts.
        publishSpend(deps, usage === undefined ? 0 : actualCostMicros(plan.rate, usage));
    }

    // 6. Read the answer. Every path from here is TERMINAL.
    if (outcome.kind === 'unusable') {
        logger.warn('ingredient parse response was unusable', { reason: outcome.reason });

        return refuse('unreadable-answer', outcome.reason);
    }

    const reading = readParseAnswer(outcome.text, outcome.stopReason);

    if (reading.kind === 'refused') {
        // ⛔ Recorded rather than silently retried (plan U11/U18). A structured-output failure is a fact about
        // the MODEL and is counted apart from an answer that merely could not be believed.
        logger.warn('ingredient parse answer was not usable', {
            refusal: reading.refusal,
            detail: reading.detail,
        });

        return reading;
    }

    return { kind: 'parsed', parse: reading.parse, modelId: plan.modelId };
}
