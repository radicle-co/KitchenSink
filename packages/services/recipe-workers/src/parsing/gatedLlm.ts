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
 *  - the dollar metric carries the call site (`ingredient-parse` / `foodness-validator`) — attribution on
 *    the METRIC only, one pool, no sub-budgets.
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
    INGREDIENT_PARSE_CALL_SITE,
    planReservation,
    actualCostMicros,
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

import { SPEND_METRIC_NAME, SPEND_METRIC_NAMESPACE } from '../common/spendMetrics.js';
import { isSpendGated, type SpendLedger } from '../common/verificationSpend.js';
import type { EmfMetric } from '../common/metrics.js';
import { logger } from '../common/logger.js';

/** Everything the gated legs talk to, injected. */
export interface GatedLlmDeps {
    readonly stage: string;
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

/** What a gated call produced: the answered text, or absence (with the transient path THROWING). */
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
    const plan = planReservation({
        modelId,
        ceilingMicros: settings.ceilingMicros,
        maxInputTokens: [...call.request.systemPrompt].length + [...call.request.userMessage].length + 400,
        maxOutputTokens: call.request.maxOutputTokens,
        nowUtc: deps.now(),
    });

    if (plan.kind === 'unpriced') {
        throw new Error(`parse leg model '${plan.modelId}' is not priced by the rate table; refusing to call it`);
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

    return outcome.kind === 'answered'
        ? { kind: 'answered', text: outcome.text, stopReason: outcome.stopReason }
        : { kind: 'unusable' };
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
                callSite: FOODNESS_VALIDATOR_CALL_SITE,
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
