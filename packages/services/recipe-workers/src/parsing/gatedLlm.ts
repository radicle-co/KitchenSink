/**
 * The GATED LLM legs of the service parse pipeline (plan U8, KTD-F) — parse, retry, foodness and
 * measurement, each a reserve-then-settle call under ADR-0024's shared pool.
 *
 * ⛔ HOSTED WHERE THE SINGLE BEDROCK GRANTEE LIVES: these run in the recipe-workers Lambda under the SAME
 * execution role as the verification gate — no second grantee, `llmSpendGuards` stays green (D6).
 *
 * ## One helper, four call shapes
 *
 * `gatedConverse` is the reserve → converse → settle spine shared by all four legs. It deliberately does
 * NOT refactor `verifyLine.ts` onto itself: that handler's ordering is measured, pinned and guarded, and
 * a refactor there buys nothing but risk. The spine's rules are the gate's, restated once for the new
 * consumers:
 *
 *  - settings + price are TRANSIENT on failure (nothing to reserve → the call is not made);
 *  - an unpriced model refuses BEFORE any call (membership of the rate table is authorization);
 *  - a ceiling denial THROWS — transient, the message redelivers, and KTD-F's amplification bound is the
 *    parse CACHE: a redelivered message re-reads `ingredient_parse_cache` before any Bedrock call, so a
 *    redelivery re-pays only uncached attempts;
 *  - settle is NEVER retried, and any outcome with no billed response refunds in full;
 *  - the dollar metric carries the call site — `ingredient-parse` for BOTH the first attempt and the retry,
 *    `foodness-validator`, `measurement-validator` (three of `SPEND_CALL_SITES`' four; the fourth,
 *    `verification-gate`, is `verifyLine.ts`'s) — attribution on the METRIC only, one pool, no sub-budgets.
 */
import {
    FOODNESS_MAX_OUTPUT_TOKENS,
    FOODNESS_MODEL_ID,
    buildFoodnessPrompt,
    isFoodnessNameTooLargeError,
} from '@kitchensink/recipe-core/parsing/foodness-prompt';
import { readFoodnessAnswer } from '@kitchensink/recipe-core/parsing/foodness-answer';
import {
    PARSE_MAX_OUTPUT_TOKENS,
    PARSE_PROMPT_VERSION,
    PARSE_TEMPERATURE,
    buildParsePrompt,
    isParsePromptTooLargeError,
} from '@kitchensink/recipe-core/parsing/parse-prompt';
import { buildParseRetryPrompt } from '@kitchensink/recipe-core/parsing/parse-retry-prompt';
import { modelParseAnswerSchema, normalizeParseAnswer } from '@kitchensink/recipe-core/parsing/parse-answer';
import {
    VERIFICATION_MAX_OUTPUT_TOKENS,
    buildVerificationPrompt,
    isPromptTooLargeError,
} from '@kitchensink/recipe-core/resolution/verification-prompt';
import { readVerdict } from '@kitchensink/recipe-core/resolution/verification-verdict';
import {
    FOODNESS_VALIDATOR_CALL_SITE,
    MEASUREMENT_VALIDATOR_CALL_SITE,
    INGREDIENT_PARSE_CALL_SITE,
    planReservation,
    actualCostMicros,
    inputTokenBound,
    inputTokensBeyondBound,
    type SpendCallSite,
} from '@kitchensink/recipe-core/spend/spend-arithmetic';
import { isBedrockClientError, type BedrockConverseClient, type ConverseRequest } from '@kitchensink/bedrock-client';
import {
    promoteLlmParse,
    type EngineAnswer,
    type FoodnessValidatorPort,
    type MeasurementValidatorPort,
    type ParseEnginePort,
    type ParsedLine,
    type RetryParsePort,
} from '@kitchensink/recipe-import-core';

import {
    INPUT_BOUND_EXCEEDED_METRIC_NAME,
    RESIDENCY_REFUSED_METRIC_NAME,
    SPEND_METRIC_NAME,
    SPEND_METRIC_NAMESPACE,
} from '../common/spendMetrics.js';
import { ResidencyRefusedError } from '../common/residencyRefused.js';
import { isSpendGated, type SpendLedger } from '../common/verificationSpend.js';
import type { EmfMetric } from '../common/metrics.js';
import { logger } from '../common/logger.js';

/** Everything the gated legs talk to, injected. */
export interface GatedLlmDeps {
    readonly stage: string;
    /** The region these legs invoke Bedrock from — the residency half of the plan (ADR-0024 §4b). */
    readonly deployRegion: string;
    /** The parse model's settings: ceiling shared with the gate, model id resolved for the parse leg. */
    readonly settings: { resolve(): Promise<{ ceilingMicros: number; modelId: string }> };
    readonly ledger: SpendLedger;
    readonly bedrock: BedrockConverseClient;
    readonly emit: (metric: EmfMetric) => void;
    readonly now: () => Date;
}

/** One gated call's request, minus what the spine derives. */
interface GatedCall {
    readonly callSite: SpendCallSite;
    /** Bare model id override — the foodness validator pins its own; absent uses the settings model. */
    readonly modelId?: string;
    readonly request: Omit<ConverseRequest, 'invocationId'>;
}

/**
 * What a gated call produced: the answered text, or absence (with the transient path THROWING).
 *
 * ⛔ A RESIDENCY REFUSAL IS DELIBERATELY NOT A MEMBER HERE. Adding one — or reusing `unusable` — would make
 * every port answer absence, and `processParseLine` reads engine absence as a DETERMINISTIC PER-LINE FACT
 * that it is safe to land permanently. A refusal is a deployment fault, so it leaves through
 * {@link ResidencyRefusedError} instead; see `common/residencyRefused.ts` for the full argument and for the
 * defect (a CRF outage landing as an ingredient's permanent answer) that settles it.
 */
type GatedOutcome =
    { readonly kind: 'answered'; readonly text: string; readonly stopReason: string } | { readonly kind: 'unusable' };

/**
 * The reserve → converse → settle spine.
 *
 * @throws On a ceiling denial or transport failure — TRANSIENT, the message redelivers.
 * @sideEffect Reads SSM (through settings), writes the spend counter, calls Bedrock, emits metrics.
 */
export async function gatedConverse(deps: GatedLlmDeps, call: GatedCall): Promise<GatedOutcome> {
    const settings = await deps.settings.resolve();
    const modelId = call.modelId ?? settings.modelId;
    const inputBound = inputTokenBound(turnsOf(call.request));
    const plan = planReservation({
        modelId,
        ceilingMicros: settings.ceilingMicros,
        // ⛔ EVERY TURN, IN BYTES. This was `[...system].length + [...user].length + 400`: code points (not a
        // bound on a byte-fallback tokenizer, which spends up to four tokens on one unknown code point), a
        // bare `400` with no provenance, and — the concrete defect — NO count of `fewShotTurns`, so the
        // foodness validator's six example messages were reserved for at zero. See `inputTokenBound`.
        maxInputTokens: inputBound,
        maxOutputTokens: call.request.maxOutputTokens,
        nowUtc: deps.now(),
        deployRegion: deps.deployRegion,
    });

    if (plan.kind === 'unpriced') {
        throw new Error(`parse leg model '${plan.modelId}' is not priced by the rate table; refusing to call it`);
    }

    if (plan.kind === 'residency-unapproved') {
        // ⛔ THROWN, NOT RETURNED AS ABSENCE, and the choice is the opposite of the obvious one. Returning
        // absence here reads correct — the LLM did not answer, and `single-engine` is a modelled outcome —
        // but `processParseLine` treats engine absence as a DETERMINISTIC PER-LINE FACT and lands it as the
        // line's permanent answer. That is precisely the defect that handler was repaired for, one engine
        // over: "a line parsed during a CRF outage landed the LLM's single-engine reading as its PERMANENT
        // answer." A residency refusal is a deployment fault, not a fact about this ingredient.
        //
        // ⚠️ Throwing does NOT make it transient. `processParseLine` catches this error BY NAME, ahead of the
        // branch that re-throws everything else, and lands nothing without redelivering — see
        // `common/residencyRefused.ts`, which carries the whole argument.
        //
        // ⚠️ WHY THIS CANNOT SILENTLY DEGRADE THE SHIPPED PIPELINE ANYWAY: the parse leg's model is a
        // compile-time constant (`PARSE_LEG_MODEL_ID`), not an SSM value, and `parseLine.test.ts` asserts
        // that every model this handler pins is residency-clear. Reaching this branch in the shipped
        // configuration takes a code change that fails that test.
        // ⚠️ THE METRIC IS THE ALERT, NOT THE LOG — `recipe-workers` has no log drain (see
        // `spendMetrics.ts`'s `RESIDENCY_REFUSED_METRIC_NAME`). Attributed, because which leg went dark is
        // the diagnostic and the four legs do not all pin the same model.
        deps.emit({
            namespace: SPEND_METRIC_NAMESPACE,
            name: RESIDENCY_REFUSED_METRIC_NAME,
            unit: 'Count',
            stage: deps.stage,
            value: 1,
            dimensions: { CallSite: call.callSite },
        });
        logger.error('parse-leg model is not cleared for residency; the LLM leg was not called', {
            callSite: call.callSite,
            modelId: plan.modelId,
            deployRegion: plan.deployRegion,
            reachedRegions: plan.reachedRegions,
        });

        throw new ResidencyRefusedError(plan);
    }

    const gated = isSpendGated(deps.stage);

    if (gated) {
        const reservation = await deps.ledger.reserve(plan);

        if (reservation.kind === 'denied') {
            // ⛔ TRANSIENT — the message redelivers under maxReceiveCount, and the parse CACHE bounds the
            // amplification (KTD-F): replayed attempts re-read the cache before any Bedrock call.
            throw new Error(`parse-leg ceiling reached for ${reservation.period}; the call was not made`);
        }
    }

    let outcome;

    try {
        outcome = await deps.bedrock.converse({ ...call.request, invocationId: plan.invocationId });
    } catch (error) {
        if (gated && isBedrockClientError(error) && error.settlement === 'refund-full') {
            await settleQuietly(deps, plan, 0);
        }

        throw error;
    }

    const usage = outcome.usage;

    if (gated) {
        if (usage !== undefined) {
            await settleQuietly(deps, plan, actualCostMicros(plan.rate, usage));
        } else {
            logger.warn('parse-leg response carried no readable usage; the reservation stands', {
                period: plan.period,
            });
        }
    }

    deps.emit({
        namespace: SPEND_METRIC_NAMESPACE,
        name: SPEND_METRIC_NAME,
        unit: 'None',
        stage: deps.stage,
        value: usage === undefined ? plan.worstMicros : actualCostMicros(plan.rate, usage),
        dimensions: { CallSite: call.callSite },
    });

    // ⛔ DID LAYER 1's BOUND HOLD? The counter cannot say — an overshoot is charged by the unclamped settle
    // delta and vanishes into the month's total. Emitted in every stage, for the same reason the gate does.
    if (usage !== undefined) {
        const overrun = inputTokensBeyondBound(inputBound, usage);

        if (overrun > 0) {
            deps.emit({
                namespace: SPEND_METRIC_NAMESPACE,
                name: INPUT_BOUND_EXCEEDED_METRIC_NAME,
                unit: 'Count',
                stage: deps.stage,
                value: overrun,
                dimensions: { CallSite: call.callSite },
            });
            logger.warn('parse-leg billed MORE input tokens than the reservation was priced for', {
                callSite: call.callSite,
                bound: inputBound,
                overrun,
            });
        }
    }

    return outcome.kind === 'answered'
        ? { kind: 'answered', text: outcome.text, stopReason: outcome.stopReason }
        : { kind: 'unusable' };
}

/**
 * Every text segment a request carries, in the order the transport sends them.
 *
 * ⛔ `fewShotTurns` INCLUDED. The foodness validator sends six example messages between the system prompt and
 * the user message; a bound taken over `system + user` alone under-prices every one of its calls by the whole
 * weight of those examples — and its retry loop fires it up to twice per parse attempt, four attempts a line.
 *
 * @param request - The converse request, minus the invocation id the spine supplies.
 * @returns The turns, in wire order. Pure.
 */
function turnsOf(request: Omit<ConverseRequest, 'invocationId'>): readonly string[] {
    return [
        request.systemPrompt,
        ...(request.fewShotTurns ?? []).flatMap((turn) => [turn.user, turn.assistant]),
        request.userMessage,
    ];
}

/** Settle without ever failing the handler — the gate's own rule, restated for the new consumers. */
async function settleQuietly(
    deps: GatedLlmDeps,
    plan: Parameters<SpendLedger['settle']>[0]['plan'],
    actualMicros: number,
): Promise<void> {
    try {
        await deps.ledger.settle({ plan, actualMicros });
    } catch (error) {
        logger.error('parse-leg settle failed; the reservation stands unrefunded', {
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

/** A fenced or bare JSON document, or `undefined` — the cookbook adapter's reader, restated. */
function readParseJson(text: string): unknown {
    const trimmed = text.trim();
    const fenced = /```(?:json)?\s*([\s\S]*?)```/u.exec(trimmed)?.[1]?.trim() ?? trimmed;

    try {
        return JSON.parse(fenced);
    } catch {
        return undefined;
    }
}

/** Read one answered parse into an engine answer, or absence. */
function toEngineAnswer(outcome: GatedOutcome, line: string): EngineAnswer {
    if (outcome.kind !== 'answered' || outcome.stopReason === 'max_tokens') {
        return { unavailable: true };
    }

    const parsed = modelParseAnswerSchema.safeParse(readParseJson(outcome.text));

    return parsed.success ? promoteLlmParse(normalizeParseAnswer(parsed.data), line) : { unavailable: true };
}

/**
 * The gated first-attempt engine port.
 *
 * @param deps - The spine's collaborators.
 * @param modelId - The parse model's BARE id (also the engine-version identity).
 */
export function createGatedLlmEngine(deps: GatedLlmDeps, modelId: string): ParseEnginePort<'llm'> {
    return {
        engine: 'llm',
        engineVersion: `${modelId}@${PARSE_PROMPT_VERSION}`,
        async parse(lines) {
            const answers: EngineAnswer[] = [];

            for (const line of lines) {
                let prompt;

                try {
                    prompt = buildParsePrompt(line);
                } catch (error) {
                    if (isParsePromptTooLargeError(error)) {
                        answers.push({ unavailable: true });
                        continue;
                    }

                    throw error;
                }

                const outcome = await gatedConverse(deps, {
                    callSite: INGREDIENT_PARSE_CALL_SITE,
                    modelId,
                    request: {
                        systemPrompt: prompt.systemPrompt,
                        userMessage: prompt.userMessage,
                        maxOutputTokens: PARSE_MAX_OUTPUT_TOKENS,
                        temperature: PARSE_TEMPERATURE,
                        cachePrompt: true,
                    },
                });
                answers.push(toEngineAnswer(outcome, line));
            }

            return answers;
        },
    };
}

/** The gated retry port (plan U7's contract), sharing the spine. */
export function createGatedRetryPort(deps: GatedLlmDeps, modelId: string): RetryParsePort {
    return {
        async parse(line, failures) {
            const prompt = buildParseRetryPrompt(line, failures);
            const outcome = await gatedConverse(deps, {
                callSite: INGREDIENT_PARSE_CALL_SITE,
                modelId,
                request: {
                    systemPrompt: prompt.systemPrompt,
                    userMessage: prompt.userMessage,
                    maxOutputTokens: PARSE_MAX_OUTPUT_TOKENS,
                    temperature: PARSE_TEMPERATURE,
                },
            });

            return toEngineAnswer(outcome, line);
        },
    };
}

/** The gated foodness validator (U6's pinned champion; its OWN model pin rides `buildFoodnessPrompt`). */
export function createGatedFoodnessValidator(deps: GatedLlmDeps): FoodnessValidatorPort {
    return {
        async judge(name) {
            let prompt;

            try {
                prompt = buildFoodnessPrompt(name);
            } catch (error) {
                if (isFoodnessNameTooLargeError(error)) {
                    return { kind: 'could-not-judge', reason: 'bad-shape' };
                }

                throw error;
            }

            const outcome = await gatedConverse(deps, {
                callSite: FOODNESS_VALIDATOR_CALL_SITE,
                // U6's champion is measured ON Nova Micro; the prompt module owns that pin.
                modelId: FOODNESS_MODEL_ID,
                request: {
                    systemPrompt: prompt.systemPrompt,
                    userMessage: prompt.userMessage,
                    fewShotTurns: prompt.fewShotTurns,
                    maxOutputTokens: FOODNESS_MAX_OUTPUT_TOKENS,
                    temperature: prompt.temperature,
                },
            });

            if (outcome.kind !== 'answered') {
                return { kind: 'could-not-judge', reason: 'no-json' };
            }

            return readFoodnessAnswer(outcome.text, outcome.stopReason);
        },
    };
}

/** The gated measurement validator — the gate's machinery as a library (R7). */
export function createGatedMeasurementValidator(deps: GatedLlmDeps, modelId: string): MeasurementValidatorPort {
    return {
        async judge(line: string, parse: ParsedLine) {
            const quantity = parse.quantity;
            let prompt;

            try {
                prompt = buildVerificationPrompt({
                    sourceLine: line,
                    candidateFoodName: parse.foods[0]?.name ?? '(none)',
                    quantityLow:
                        quantity.kind === 'exact' ? quantity.value : quantity.kind === 'range' ? quantity.low : null,
                    quantityHigh: quantity.kind === 'range' ? quantity.high : null,
                    unit: parse.unit,
                    aspects: ['quantity'],
                });
            } catch (error) {
                if (isPromptTooLargeError(error)) {
                    return 'could-not-judge';
                }

                throw error;
            }

            const outcome = await gatedConverse(deps, {
                callSite: MEASUREMENT_VALIDATOR_CALL_SITE,
                modelId,
                request: {
                    systemPrompt: prompt.system,
                    userMessage: prompt.user,
                    maxOutputTokens: VERIFICATION_MAX_OUTPUT_TOKENS,
                    temperature: 0,
                },
            });

            if (outcome.kind !== 'answered') {
                return 'could-not-judge';
            }

            const reading = readVerdict(outcome.text, outcome.stopReason);

            if (reading.kind === 'unreadable') {
                return 'could-not-judge';
            }

            if (reading.outcome.verdict === 'agree') {
                return 'pass';
            }

            return reading.outcome.verdict === 'disagree' ? 'fail' : 'could-not-judge';
        },
    };
}
