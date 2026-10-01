/**
 * @module validators — the in-loop validator ADAPTERS for the operator CLI leg (plan U7, D6).
 *
 * Both validators reuse SHIPPED machinery as a library and add only transport + cost accounting:
 *
 *  - **foodness** — U6's pinned champion (`buildFoodnessPrompt` + `readFoodnessAnswer`), through this
 *    leg's own Bedrock client with the measured few-shot turns.
 *  - **measurement** — the verifyLine GATE's machinery (`buildVerificationPrompt(aspects: ['quantity'])`
 *    + `readVerdict`), per R7: no second measurement LLM, no reworded question.
 *
 * ⛔ UNGATED, like `llmEngine.ts`, and under the same rule: ADR-0024 §4a sanctions the operator path by
 * name, the cost is counted HERE on the adapter, and nothing in this file may ever acquire a Lambda, a
 * CDK construct or an IAM grant.
 */
import { isBedrockClientError, type BedrockConverseClient } from '@kitchensink/bedrock-client';
import {
    FOODNESS_MAX_OUTPUT_TOKENS,
    FOODNESS_MODEL_ID,
    buildFoodnessPrompt,
    isFoodnessNameTooLargeError,
} from '@kitchensink/recipe-core/parsing/foodness-prompt';
import { readFoodnessAnswer, type FoodnessReading } from '@kitchensink/recipe-core/parsing/foodness-answer';
import {
    VERIFICATION_MAX_OUTPUT_TOKENS,
    buildVerificationPrompt,
    isPromptTooLargeError,
} from '@kitchensink/recipe-core/resolution/verification-prompt';
import { readVerdict } from '@kitchensink/recipe-core/resolution/verification-verdict';
import {
    actualCostMicros,
    rateFor,
    registryEntryFor,
    worstCaseMicros,
} from '@kitchensink/recipe-core/spend/spend-arithmetic';
import type { FoodnessValidatorPort, MeasurementValidatorPort } from '@kitchensink/recipe-import-core';
import type { ParsedLine } from '@kitchensink/recipe-import-core';

/** A validator adapter plus the running total of what it has spent — the `LlmEnginePort` discipline. */
export interface CostedFoodnessValidator extends FoodnessValidatorPort {
    spentMicros(): number;
}

/** See {@link CostedFoodnessValidator}. */
export interface CostedMeasurementValidator extends MeasurementValidatorPort {
    spentMicros(): number;
}

/** Resolve a model's invocation id + rate, refusing an unpriced id BEFORE any call. */
function priced(modelId: string): { invocationId: string; rate: NonNullable<ReturnType<typeof rateFor>> } {
    const entry = registryEntryFor(modelId);
    const rate = rateFor(modelId);

    if (entry === undefined || rate === undefined) {
        throw new Error(`validators: ${modelId} is not in BEDROCK_MODEL_REGISTRY, so it may not be called`);
    }

    return { invocationId: entry.invocation.invocationId, rate };
}

/**
 * Build the foodness validator over this leg's client.
 *
 * @param client - The Bedrock client (operator transport).
 * @returns The port, with its spend counter.
 */
export function createFoodnessValidator(client: BedrockConverseClient): CostedFoodnessValidator {
    const { invocationId, rate } = priced(FOODNESS_MODEL_ID);
    let spent = 0;

    return {
        spentMicros: () => spent,
        async judge(name: string): Promise<FoodnessReading> {
            let prompt;

            try {
                prompt = buildFoodnessPrompt(name);
            } catch (error) {
                if (isFoodnessNameTooLargeError(error)) {
                    // Over-cap is REJECTED, never truncated — and rejection is absence, not a verdict.
                    return { kind: 'could-not-judge', reason: 'bad-shape' };
                }

                throw error;
            }

            const inputCeiling = [...prompt.systemPrompt].length + [...prompt.userMessage].length + 200;
            let outcome;

            try {
                outcome = await client.converse({
                    invocationId,
                    systemPrompt: prompt.systemPrompt,
                    userMessage: prompt.userMessage,
                    fewShotTurns: prompt.fewShotTurns,
                    maxOutputTokens: prompt.maxOutputTokens,
                    temperature: prompt.temperature,
                });
            } catch (error) {
                if (!(isBedrockClientError(error) && error.settlement === 'refund-full')) {
                    spent += worstCaseMicros(rate, inputCeiling, FOODNESS_MAX_OUTPUT_TOKENS);
                }

                return { kind: 'could-not-judge', reason: 'no-json' };
            }

            if (outcome.kind === 'unusable') {
                spent +=
                    outcome.usage === undefined
                        ? worstCaseMicros(rate, inputCeiling, FOODNESS_MAX_OUTPUT_TOKENS)
                        : actualCostMicros(rate, outcome.usage);

                return { kind: 'could-not-judge', reason: 'no-json' };
            }

            spent += actualCostMicros(rate, outcome.usage);

            return readFoodnessAnswer(outcome.text, outcome.stopReason);
        },
    };
}

/**
 * Build the measurement validator — the gate's quantity machinery, as a library (R7).
 *
 * @param client - The Bedrock client (operator transport).
 * @param modelId - The bare model id (the parse leg's model — the gate machinery is model-agnostic).
 * @returns The port, with its spend counter.
 */
export function createMeasurementValidator(client: BedrockConverseClient, modelId: string): CostedMeasurementValidator {
    const { invocationId, rate } = priced(modelId);
    let spent = 0;

    return {
        spentMicros: () => spent,
        async judge(line: string, parse: ParsedLine): Promise<'pass' | 'fail' | 'could-not-judge'> {
            const quantity = parse.quantity;
            const quantityLow =
                quantity.kind === 'exact' ? quantity.value : quantity.kind === 'range' ? quantity.low : null;
            const quantityHigh = quantity.kind === 'range' ? quantity.high : null;
            let prompt;

            try {
                prompt = buildVerificationPrompt({
                    sourceLine: line,
                    // The gate's prompt wants the candidate identity; the loop judges an ATTEMPT, whose
                    // best identity statement is its own first food name. `(none)` when the attempt found
                    // no food — the quantity question still stands.
                    candidateFoodName: parse.foods[0]?.name ?? '(none)',
                    quantityLow,
                    quantityHigh,
                    unit: parse.unit,
                    aspects: ['quantity'],
                });
            } catch (error) {
                if (isPromptTooLargeError(error)) {
                    return 'could-not-judge';
                }

                throw error;
            }

            const inputCeiling = [...prompt.system].length + [...prompt.user].length + 200;
            let outcome;

            try {
                outcome = await client.converse({
                    invocationId,
                    systemPrompt: prompt.system,
                    userMessage: prompt.user,
                    maxOutputTokens: VERIFICATION_MAX_OUTPUT_TOKENS,
                    temperature: 0,
                });
            } catch (error) {
                if (!(isBedrockClientError(error) && error.settlement === 'refund-full')) {
                    spent += worstCaseMicros(rate, inputCeiling, VERIFICATION_MAX_OUTPUT_TOKENS);
                }

                return 'could-not-judge';
            }

            if (outcome.kind === 'unusable') {
                spent +=
                    outcome.usage === undefined
                        ? worstCaseMicros(rate, inputCeiling, VERIFICATION_MAX_OUTPUT_TOKENS)
                        : actualCostMicros(rate, outcome.usage);

                return 'could-not-judge';
            }

            spent += actualCostMicros(rate, outcome.usage);
            const reading = readVerdict(outcome.text, outcome.stopReason);

            if (reading.kind === 'unreadable') {
                return 'could-not-judge';
            }

            if (reading.outcome.verdict === 'agree') {
                return 'pass';
            }

            if (reading.outcome.verdict === 'disagree') {
                return 'fail';
            }

            // `abstain` is the model's own could-not-judge.
            return 'could-not-judge';
        },
    };
}
