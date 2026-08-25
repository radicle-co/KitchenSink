/**
 * @module llmEngine — the Bedrock parse leg, as a {@link ParseEnginePort} (plan U22, phase 5).
 *
 * DESIGN PATTERN: **Command over an injected Adapter**, the same shape `runParseTrial.ts` uses — the client
 * arrives as a parameter, so every outcome this file can produce is driven from a fake `ConverseTransport`
 * with no network and no spend.
 *
 * ## ⛔ IT IS NOT BUILT ON `runParseTrial`, AND THAT IS DELIBERATE
 *
 * The obvious move is to wrap the bake-off's own command. It is wrong twice over. `runParseTrial` calls
 * `parseComparison/parseAgreement.ts`'s `compareParses` — a DIFFERENT function from U19's
 * `domain/parseComparator.ts`, which is the one this pipeline adjudicates with — so wrapping it would run the
 * measurement comparator inside the import path. And its return type is a `ParseTrial`: a stop-reason census,
 * a cost, a `recovered` flag and a shape detail, none of which a parse pipeline has any use for. What is
 * genuinely shared IS shared, and only that: the prompt, the response classifier, the answer normalizer and
 * the rate table.
 *
 * ## ⛔ IT IS UNGATED, AND MUST NEVER ACQUIRE A LAMBDA, A CDK CONSTRUCT OR AN IAM GRANT
 *
 * ADR-0024 §4b grants `bedrock:InvokeModel` to exactly ONE Lambda execution role, guard-tested by set
 * equality, and §4a sanctions this path by name: "the runner is an operator script that already sits outside
 * this ceiling by design." That is why `recipe-workers`' `parseLineWithLlm` is NOT reused here and why the
 * orchestration was hoisted while the gated leg was not — a shared gated leg makes a second, ungated grantee
 * the natural next step, which is precisely the bypass layer 4 cannot detect, because the spend metric is
 * emitted BY the gated path.
 *
 * ⚠️ So the cost is counted HERE, on the adapter, and never inside the pipeline. ADR-0026's residual risk is
 * that "a large import can starve the verification gate" out of one shared $100 pool, so an operator needs to
 * see what a run spent — and the pipeline must not learn about spend, the mirror of ADR-0024's rule that
 * "nothing about the reservation … may learn about the call site".
 *
 * ## ⚠️ NO RETRY, on purpose
 *
 * `createBedrockTransport` pins `maxAttempts: 1` so an SDK retry cannot spend a second time invisibly, and
 * this file does not reintroduce one. A throttled call becomes an unavailable LINE — never a `ParsedLine`
 * with empty fields, because "the model had no opinion" and "the model read the line and found no food" are
 * different facts and the second is a legitimate answer about a heading.
 */
import { isBedrockClientError, type BedrockConverseClient } from '@kitchensink/bedrock-client';
import { normalizeParseAnswer } from '@kitchensink/recipe-core/parsing/parse-answer';
import {
    actualCostMicros,
    rateFor,
    registryEntryFor,
    worstCaseMicros,
} from '@kitchensink/recipe-core/spend/spend-arithmetic';
import { promoteLlmParse, type EngineAnswer, type ParseEnginePort } from '@kitchensink/recipe-import-core';
import pLimit from 'p-limit';

import { PARSE_MAX_OUTPUT_TOKENS, PARSE_PROMPT_VERSION, buildParsePrompt } from '../parseComparison/parsePrompt.js';
import { classifyParseResponse, recoverableParse } from '../parseComparison/parseResponse.js';

/** The marker the pipeline reads as "this engine produced no answer at all". */
const UNAVAILABLE: EngineAnswer = { unavailable: true };

/** What {@link createLlmEngine} needs. */
export interface LlmEngineOptions {
    /** The Bedrock client. Injected, so the unit tier drives every outcome with no network and no spend. */
    readonly client: BedrockConverseClient;
    /** The BARE model id. The invocation id is resolved from the registry, never passed in. */
    readonly modelId: string;
    /**
     * Calls in flight at once.
     *
     * ⚠️ A ceiling on OUR side of a shared quota, not a throughput target. `runParseTrial`'s own note applies:
     * a throttled call is a lost line, and the repair is to re-run at lower concurrency rather than to add a
     * retry that spends twice.
     */
    readonly concurrency?: number;
}

/** The LLM leg, plus the running total of what it has spent. */
export interface LlmEnginePort extends ParseEnginePort<'llm'> {
    /**
     * Micro-dollars this adapter has spent so far.
     *
     * ⚠️ On the ADAPTER, never on the port the pipeline sees — see the module header.
     */
    spentMicros(): number;
}

/**
 * Build the model leg of the parse pipeline.
 *
 * @param options - The client, the bare model id and the concurrency ceiling.
 * @returns A port that reads a batch line by line, bounded by the ceiling.
 * @throws When the model is not in the rate table. ⛔ Thrown BEFORE any call: `BEDROCK_MODEL_REGISTRY`'s own
 *   docstring says membership is authorization, so an unpriced id must not be spent on and then reported with
 *   an invented cost.
 */
export function createLlmEngine(options: LlmEngineOptions): LlmEnginePort {
    const entry = registryEntryFor(options.modelId);
    const rate = rateFor(options.modelId);

    if (entry === undefined || rate === undefined) {
        throw new Error(`llmEngine: ${options.modelId} is not in BEDROCK_MODEL_REGISTRY, so it may not be called`);
    }

    // Bound after the guard, because a narrowing on a `let`-scoped outer binding does not survive into the
    // closure below — and the guard is the authorization, so it must be the only way past this point.
    const invocationId = entry.invocation.invocationId;
    const priced = rate;
    const gate = pLimit(options.concurrency ?? 8);
    let spent = 0;

    /**
     * Read one line, or report that this leg could not.
     *
     * @param line - The source line, byte-identical.
     * @returns The model's parse, or absence.
     * @sideEffect Calls Amazon Bedrock. Billed.
     */
    async function readLine(line: string): Promise<EngineAnswer> {
        const prompt = buildParsePrompt(line);
        // One token per code point is an upper bound for every tokenizer in the roster — the same reasoning
        // `MAX_PARSE_PROMPT_CHARS` rests on. Used only to cost a call whose `usage` never arrived.
        const inputCeiling = [...prompt.systemPrompt].length + [...prompt.userMessage].length;
        let outcome;

        try {
            outcome = await options.client.converse({
                invocationId,
                systemPrompt: prompt.systemPrompt,
                userMessage: prompt.userMessage,
                maxOutputTokens: PARSE_MAX_OUTPUT_TOKENS,
                temperature: 0,
            });
        } catch (error) {
            // ⛔ The cost of a call that never arrived is a DECISION, and it is the client's: `refund-full`
            // names the refusals AWS documents as happening before inference. Anything else kept its charge
            // with no `usage` to cost it from, so it is charged the WORST CASE — the same direction ADR-0024's
            // settle takes, because a run that quietly under-reports its own spend is the one shape a spend
            // report must not have.
            if (!(isBedrockClientError(error) && error.settlement === 'refund-full')) {
                spent += worstCaseMicros(priced, inputCeiling, PARSE_MAX_OUTPUT_TOKENS);
            }

            return UNAVAILABLE;
        }

        if (outcome.kind === 'unusable') {
            // ⛔ Worst case, NOT zero. The response ARRIVED, so it was billed; absent `usage` means "cost
            // unknown, keep the reservation" and never "this call was free".
            spent +=
                outcome.usage === undefined
                    ? worstCaseMicros(priced, inputCeiling, PARSE_MAX_OUTPUT_TOKENS)
                    : actualCostMicros(priced, outcome.usage);

            return UNAVAILABLE;
        }

        spent += actualCostMicros(priced, outcome.usage);

        const reading = classifyParseResponse(outcome.text, outcome.stopReason);
        // ⚠️ Recovery is consulted for a NON-compliant response only, and it is the right call HERE where the
        // bake-off deliberately kept the two apart: that harness measures how often the shipped reader would
        // have to change, while this one is the reader. `recoverableParse`'s own warning — "nothing extracted
        // from prose is ever … put back into a prompt" — is honoured: nothing here reaches a prompt.
        const answer = reading.kind === 'valid' ? reading.parse : recoverableParse(outcome.text);

        return answer === undefined ? UNAVAILABLE : promoteLlmParse(normalizeParseAnswer(answer), line);
    }

    return {
        engine: 'llm',
        engineVersion: `${options.modelId}@${PARSE_PROMPT_VERSION}`,
        spentMicros: () => spent,
        async parse(lines): Promise<readonly EngineAnswer[]> {
            // ⛔ EXACTLY one answer per line, in order — `Promise.all` over `map`, so a line that could not be
            // read still occupies its position. A `flatMap` that dropped it would mispair every line after it,
            // which `crfProcess.ts` records as the failure that "corrupts the headline result silently and
            // totally"; the pipeline throws on a length mismatch for the same reason.
            return Promise.all(lines.map(async (line) => gate(async () => readLine(line))));
        },
    };
}
