/**
 * ONE CALL — ask one model to parse one line, and record what came back.
 *
 * DESIGN PATTERN: **Command over an injected Adapter.** The Bedrock client arrives as a parameter, so every
 * outcome this file can produce — a compliant answer, a wrapped one, a truncated one, an unreadable
 * envelope, a call that never arrived — is driven from a fake `ConverseTransport` in the unit tier, with no
 * network and no spend. The billed runner adds only the real transport, the corpus and the concurrency.
 *
 * ## ⛔ THIS FUNCTION SPENDS REAL MONEY AND SITS OUTSIDE ADR-0024's COUNTER
 *
 * The reserve-then-settle counter guards the WORKER. This is a script running on a developer's own
 * credentials, exactly like `verificationBakeOff.ts`, and nothing stops it at a dollar threshold. ⛔ It must
 * never acquire a Lambda, a CDK construct or an IAM grant: `packages/infra/global/__tests__/llmSpendGuards`
 * asserts `bedrock:InvokeModel` on exactly ONE role by set equality, and a second grantee is precisely the
 * bypass that assertion exists to catch.
 *
 * ## ⛔ WHY A FAILED CALL IS NOT A CONTRACT FAILURE, AND A WRAPPED ANSWER IS NOT A CRF DISAGREEMENT
 *
 * Three measurements share one call and must not contaminate each other:
 *
 *  - A call that never ARRIVED (`callFailed`) is our transport — concurrency, a quota — and says nothing
 *    about the model. It is kept out of the contract denominator, and out of the CRF comparison.
 *  - A response that arrived but was NOT compliant produces no reading the consumer would ever see, so it
 *    is not compared with the CRF. Comparing it would fold the contract census into the agreement rate and
 *    report one defect as two.
 *  - Whether a conformant parse was nonetheless RECOVERABLE from the wrapper is recorded separately,
 *    because it is the difference between a reader change and a model change.
 *
 * ⚠️ There is no retry, on purpose. `createBedrockTransport` pins `maxAttempts: 1` so an SDK retry cannot
 * spend a second time invisibly, and this file does not reintroduce one: a throttled call becomes a
 * recorded `callFailed`, and a run whose stop-reason census shows those is re-run at lower concurrency
 * rather than silently patched over.
 */
import { isBedrockClientError, type BedrockConverseClient } from '@kitchensink/bedrock-client';
import {
    actualCostMicros,
    rateFor,
    registryEntryFor,
    worstCaseMicros,
} from '@kitchensink/recipe-core/spend/spend-arithmetic';

import type { CrfParse } from './crfParse.js';
import { compareParses } from './parseAgreement.js';
import type { ParseCorpusLine } from './parseCorpus.js';
import { CALL_FAILED, UNUSABLE_RESPONSE, type ParseTrial } from './parseComparisonReport.js';
import { PARSE_MAX_OUTPUT_TOKENS, buildParsePrompt } from './parsePrompt.js';
import { classifyParseResponse, recoverableParse } from './parseResponse.js';

/**
 * An upper bound on a prompt's input tokens, with no tokenizer.
 *
 * One token per code point is an upper bound for every tokenizer in the roster, which is the same reasoning
 * `MAX_PARSE_PROMPT_CHARS` rests on. Used only to cost a call whose `usage` never arrived.
 */
function promptTokenCeiling(prompt: { readonly systemPrompt: string; readonly userMessage: string }): number {
    return [...prompt.systemPrompt].length + [...prompt.userMessage].length;
}

/** One trial, plus the raw text the determinism half needs. */
export interface ParseTrialRecord extends ParseTrial {
    /** The response verbatim. Empty when no response arrived. */
    readonly responseText: string;
}

/** What one call needs. */
export interface ParseTrialRequest {
    readonly client: BedrockConverseClient;
    /** The BARE model id. The invocation id is resolved from the registry, never passed in. */
    readonly modelId: string;
    readonly line: ParseCorpusLine;
    /** The CRF's reading of the same line, or `undefined` when it produced none. */
    readonly crf: CrfParse | undefined;
}

/**
 * Ask one model to parse one line.
 *
 * @param request - The client, the bare model id, the line and the CRF's reading of it.
 * @returns What came back, classified and costed.
 * @throws When the model is not in the rate table. ⛔ Thrown BEFORE the call: `BEDROCK_MODEL_REGISTRY`'s own
 *   docstring says membership is authorization, so an unpriced id must not be spent on and then reported
 *   with an invented cost.
 * @sideEffect Calls Amazon Bedrock. Billed.
 */
export async function runParseTrial(request: ParseTrialRequest): Promise<ParseTrialRecord> {
    const { client, modelId, line, crf } = request;
    const entry = registryEntryFor(modelId);
    const rate = rateFor(modelId);

    if (entry === undefined || rate === undefined) {
        throw new Error(`parseComparison: ${modelId} is not in BEDROCK_MODEL_REGISTRY, so it may not be called`);
    }

    const prompt = buildParsePrompt(line.text);
    const base = { modelId, lineId: line.id, origin: line.origin } as const;

    let outcome;

    try {
        outcome = await client.converse({
            invocationId: entry.invocation.invocationId,
            systemPrompt: prompt.systemPrompt,
            userMessage: prompt.userMessage,
            maxOutputTokens: PARSE_MAX_OUTPUT_TOKENS,
            temperature: 0,
        });
    } catch (error) {
        // ⛔ The cost of a call that never arrived is a DECISION, not a fact, and it is the client's:
        // `refund-full` names the refusals AWS documents as happening before inference. Anything else kept
        // its charge with no `usage` to cost it from, so it is charged the WORST CASE — the same direction
        // ADR-0024's settle takes, because a run that quietly under-reports its own spend is the one shape
        // a spend report must not have. Either way the model said nothing, so this is not a contract
        // observation and the trial is kept out of the compliance denominator.
        const refunded = isBedrockClientError(error) && error.settlement === 'refund-full';

        return {
            ...base,
            outcome: CALL_FAILED,
            stopReason: error instanceof Error ? error.name : 'UnknownError',
            costMicros: refunded ? 0 : worstCaseMicros(rate, promptTokenCeiling(prompt), PARSE_MAX_OUTPUT_TOKENS),
            recovered: false,
            shapeDetail: undefined,
            agreement: undefined,
            responseText: '',
        };
    }

    if (outcome.kind === 'unusable') {
        return {
            ...base,
            // ⛔ NOT `malformedJson`. Two of the client's three `unusable` causes are facts about the
            // envelope, not about what the model said, and one of them fires on a response whose text may
            // be perfectly compliant. Blaming the model would depress its headline figure for our transport.
            outcome: UNUSABLE_RESPONSE,
            stopReason: outcome.stopReason ?? UNUSABLE_RESPONSE,
            // ⛔ Worst case, NOT zero. The client is explicit that absent `usage` means "cost unknown, keep
            // the reservation" and never "this call was free" — the response ARRIVED, so it was billed.
            // Costing it at zero is the under-count the throw path fifteen lines above refuses to make.
            costMicros:
                outcome.usage === undefined
                    ? worstCaseMicros(rate, promptTokenCeiling(prompt), PARSE_MAX_OUTPUT_TOKENS)
                    : actualCostMicros(rate, outcome.usage),
            recovered: false,
            shapeDetail: undefined,
            agreement: undefined,
            responseText: '',
        };
    }

    const reading = classifyParseResponse(outcome.text, outcome.stopReason);

    return {
        ...base,
        outcome: reading.kind,
        stopReason: outcome.stopReason,
        costMicros: actualCostMicros(rate, outcome.usage),
        // ⚠️ Derived from whether a conformant parse could be READ, not from which bucket the response
        // landed in: a document followed by a stray `]` is bucketed `malformedJson` and its content is
        // nonetheless right there, so gating on `proseWrapper` under-reported what a reader change buys.
        recovered: reading.kind !== 'valid' && recoverableParse(outcome.text) !== undefined,
        shapeDetail: reading.kind === 'wrongShape' ? reading.detail : undefined,
        agreement: reading.kind === 'valid' && crf !== undefined ? compareParses(reading.parse, crf) : undefined,
        responseText: outcome.text,
    };
}
