/**
 * THE BAKE-OFF RUNNER (plan U11 / KTD-4) — Nova Micro against Claude Haiku 4.5, on our own corpus.
 *
 * ⛔⛔ THIS SCRIPT SPENDS REAL MONEY, AND IT HAS NEVER BEEN RUN. It is written, typechecked, linted and its
 * scoring is unit-tested; it has NOT been executed against live Bedrock. Do not treat a green test suite as
 * evidence that a bake-off happened. Read "Before you run this" below.
 *
 * DESIGN PATTERN: the impure half of the decide/evaluate split. Every number this produces is computed by the
 * pure `verification/bakeOff.ts`; this file does the calling, the reading and the printing, and it reuses the
 * SAME prompt builder, verdict parser and rate table the production gate uses — because a bake-off run
 * against a different prompt measures a model that will never ship.
 *
 * ## ⛔ BEFORE YOU RUN THIS
 *
 *  1. **It costs money and it is not gated by the ceiling.** The counter guards the WORKER; this is a script
 *     with its own credentials. Estimated at ~$0.09 for Nova and ~$2.70 for Haiku over 2,432 lines x 2 swap
 *     orders — small, but it is real spend with no reserve-then-settle behind it. `--limit` exists so the
 *     first run is 20 lines rather than 2,432.
 *  2. **The corpus is NOT in this repository, and must not be.** It is a labelled slice of user and imported
 *     recipe lines. Supply it as JSONL via `--corpus`, out of band.
 *  3. **Run the RESIDUAL slice too, and report both.** The plan is explicit that the gate sees a
 *     systematically different distribution: the full corpus is for comparability, but the committed
 *     thresholds come from the residual. Two runs, two reports, both recorded.
 *  4. **Read `inconclusiveRate` first.** A model that abstained on half the corpus has not been evaluated on
 *     that half, whatever its two error rates say.
 *  5. **The false-DISAGREE rate is the number that decides.** Not accuracy — there is deliberately no such
 *     field. A wrong agree passes data that would have shipped anyway; a wrong disagree withholds nutrition
 *     from a correct line.
 *  6. **Confirm Claude Haiku 4.5's Bedrock PRICE before believing its cost column.** ADR-0024 records that it
 *     could not be read from a primary source, so the rate table's figures are computed from Anthropic's
 *     first-party rates. The correctness columns are unaffected.
 *
 * ## ⚠️ SWAP AUGMENTATION
 *
 * Each line is judged TWICE — once with the candidate presented as-is and once with the parse and the
 * candidate swapped in the prompt's ordering — which doubles the call count and is included in the cost
 * figures above. Plan U11 sizes position bias at 10–15 points, and `swapDisagreements` in the report is what
 * turns that mitigation from an assertion into a measurement.
 *
 * ## Usage
 *
 * ```
 * AWS_REGION=us-east-1 npx tsx src/scripts/verificationBakeOff.ts \
 *   --corpus ./judgement-set.jsonl --limit 20
 * ```
 *
 * Each corpus line is `{"lineId","sourceLine","candidateFoodName","quantityLow","quantityHigh","unit",
 * "parseIsCorrect"}`.
 *
 * @sideEffect Calls Amazon Bedrock (billed), reads a file, writes to stdout.
 */
import { readFileSync } from 'node:fs';

import { createBedrockConverseClient, createBedrockTransport, isBedrockClientError } from '@kitchensink/bedrock-client';
import type { BedrockConverseClient } from '@kitchensink/bedrock-client';
import {
    CLAUDE_HAIKU_4_5_MODEL_ID,
    NOVA_MICRO_MODEL_ID,
    actualCostMicros,
    rateFor,
} from '@kitchensink/recipe-core/spend/spend-arithmetic';
import { bandFor } from '@kitchensink/recipe-core/resolution/confidence';

import { scoreBakeOff, type BakeOffReport, type BakeOffTrial } from '../verification/bakeOff.js';
import { VERIFICATION_MAX_OUTPUT_TOKENS, buildVerificationPrompt } from '../verification/prompt.js';
import { readVerdict } from '../verification/verdict.js';

/**
 * The roster.
 *
 * ⛔ TWO MODELS, AND GEMINI IS NOT ONE OF THEM. Gemini Flash-Lite is not available on Amazon Bedrock at all —
 * only Google's Gemma models are — so naming it would break every premise that chose Bedrock: no vendor
 * relationship, no secret in Secrets Manager, and no egress path of its own to review against ADR-0004.
 * Adding a third candidate is its own ADR, not a line in this array. If one is wanted, the in-boundary option
 * is a Gemma model.
 */
const ROSTER = [NOVA_MICRO_MODEL_ID, CLAUDE_HAIKU_4_5_MODEL_ID] as const;

/** One labelled line from the operator-supplied corpus. */
interface CorpusLine {
    readonly lineId: string;
    readonly sourceLine: string;
    readonly candidateFoodName: string;
    readonly quantityLow: number | null;
    readonly quantityHigh: number | null;
    readonly unit: string | null;
    /** GROUND TRUTH: was our parse actually right for this line? */
    readonly parseIsCorrect: boolean;
}

/** Read `--name value` from argv. */
function flag(name: string): string | undefined {
    const index = process.argv.indexOf(`--${name}`);

    return index >= 0 ? process.argv[index + 1] : undefined;
}

/**
 * Judge one line with one model, in one candidate ordering.
 *
 * ⚠️ It asks about BOTH aspects unconditionally, deliberately. The production gate narrows the question when
 * a curated mapping or a wide margin has already established identity — but the bake-off is measuring the
 * MODEL, and a model that only ever saw the narrowed prompt would be scored on a different task than the one
 * it will sometimes be given.
 *
 * @param client - The Bedrock client for this model.
 * @param modelId - The model.
 * @param line - The corpus line.
 * @param swapVariant - Which candidate ordering to present.
 * @returns The trial, including its measured cost.
 * @sideEffect One billed Bedrock call.
 */
async function judge(
    client: BedrockConverseClient,
    modelId: string,
    line: CorpusLine,
    swapVariant: 'original' | 'swapped',
): Promise<BakeOffTrial> {
    const rate = rateFor(modelId);

    if (rate === undefined) {
        throw new Error(`no rate table entry for ${modelId}; refusing to run an uncosted bake-off`);
    }

    const prompt = buildVerificationPrompt({
        sourceLine: line.sourceLine,
        candidateFoodName: line.candidateFoodName,
        quantityLow: line.quantityLow,
        quantityHigh: line.quantityHigh,
        unit: line.unit,
        // Swap augmentation: the two aspects are presented in both orders, so a model that favours whichever
        // question it is asked first is measurable rather than invisible.
        aspects: swapVariant === 'original' ? ['identity', 'quantity'] : ['quantity', 'identity'],
    });

    const base = { lineId: line.lineId, parseIsCorrect: line.parseIsCorrect, swapVariant };

    try {
        const outcome = await client.converse({
            modelId,
            systemPrompt: prompt.system,
            userMessage: prompt.user,
            maxOutputTokens: VERIFICATION_MAX_OUTPUT_TOKENS,
        });

        const costMicros = outcome.usage === undefined ? 0 : actualCostMicros(rate, outcome.usage);

        if (outcome.kind !== 'answered') {
            return { ...base, band: 'inconclusive', stopReason: outcome.stopReason ?? 'unusable', costMicros };
        }

        const reading = readVerdict(outcome.text, outcome.stopReason);

        return {
            ...base,
            band: reading.kind === 'read' ? bandFor(reading.outcome) : 'inconclusive',
            stopReason: outcome.stopReason,
            costMicros,
        };
    } catch (error) {
        // A failed call is not a verdict. It is recorded as inconclusive with a named cause so a run degraded
        // by throttling is legible as such rather than scored as model abstention.
        return {
            ...base,
            band: 'inconclusive',
            stopReason: isBedrockClientError(error) ? error.name : 'error',
            costMicros: 0,
        };
    }
}

/**
 * Run the whole roster and print a report per model.
 *
 * ⚠️ Strictly SERIAL, and not for tidiness: it mirrors the production gate's `reservedConcurrency = 1` so the
 * throughput this run measures is the throughput the gate will actually have, and it keeps the script from
 * tripping Bedrock's account-wide RPM quota — which would show up as throttling and be scored as
 * inconclusive.
 *
 * @sideEffect Reads the corpus file, calls Bedrock repeatedly, writes to stdout.
 */
async function main(): Promise<void> {
    const corpusPath = flag('corpus');

    if (corpusPath === undefined) {
        throw new Error('--corpus <path.jsonl> is required; the corpus is operator-supplied and not in this repo');
    }

    const limit = Number(flag('limit') ?? Number.MAX_SAFE_INTEGER);
    const region = process.env['AWS_REGION'] ?? 'us-east-1';

    const corpus: CorpusLine[] = readFileSync(corpusPath, 'utf8')
        .split('\n')
        .filter((row) => row.trim() !== '')
        .map((row) => JSON.parse(row) as CorpusLine)
        .slice(0, limit);

    const client = createBedrockConverseClient(createBedrockTransport({ region }).send);
    const reports: BakeOffReport[] = [];

    for (const modelId of ROSTER) {
        const trials: BakeOffTrial[] = [];

        for (const line of corpus) {
            for (const swapVariant of ['original', 'swapped'] as const) {
                trials.push(await judge(client, modelId, line, swapVariant));
            }
        }

        reports.push(scoreBakeOff(modelId, trials));
    }

    // Machine-readable, so the committed result is a file rather than a paraphrase of a terminal.
    console.log(JSON.stringify({ corpus: corpusPath, lines: corpus.length, reports }, null, 2));
}

await main();
