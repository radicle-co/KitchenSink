/**
 * THE BAKE-OFF RUNNER (plan U11 / KTD-4) — one corpus, one prompt, any priced model, on our own corpus.
 *
 * ⚠️ ADR-0024 §4a's roster is Nova Micro against Claude Haiku 4.5, and that is still what a BARE invocation
 * runs ({@link DEFAULT_MODELS}). What `--models` may name is a wider question with a different answer — see
 * {@link resolveModels}.
 *
 * ⛔⛔ THIS SCRIPT SPENDS REAL MONEY. Its scoring is pure and unit-tested (`verification/bakeOff.ts`); this
 * file does the calling, the reading and the printing, and it reuses the SAME prompt builder, verdict parser
 * and rate table the production gate uses — because a bake-off run against a different prompt measures a model
 * that will never ship.
 *
 * ## ⛔ BEFORE YOU RUN THIS
 *
 *  1. **It costs money and it is not gated by the ceiling.** The counter guards the WORKER; this is a script
 *     with its own credentials. `--limit` exists so the first run is 20 lines rather than 2,432.
 *  2. **The corpus is NOT in this repository, and must not be.** Supply it via `--corpus`. A SYNTHETIC corpus
 *     can be generated from the seeded food catalog — see `generateBakeOffCorpus.ts`, and read its warnings:
 *     synthetic results are NOT COMPARABLE to U1's annotation protocol.
 *  3. **Both slices are reported from ONE run.** The full corpus is for comparability and the RESIDUAL slice
 *     (the near-miss identity contrasts plus their matching correct lines) is what the committed thresholds
 *     are calibrated on, because the earlier cascade tiers terminate on the easy cases and the gate therefore
 *     sees a systematically different distribution. The residual is a SUBSET of the same trials, so reporting
 *     it costs nothing extra — re-running it as a separate corpus would re-spend on lines already judged.
 *  4. **Read `inconclusiveRate` first.** A model that abstained on half the corpus has not been evaluated on
 *     that half, whatever its two error rates say.
 *  5. **The false-DISAGREE rate is the number that decides.** Not accuracy — there is deliberately no such
 *     field. A wrong agree passes data that would have shipped anyway; a wrong disagree withholds nutrition
 *     from a correct line.
 *  6. **Confirm Claude Haiku 4.5's Bedrock PRICE before believing its cost column.** ADR-0024 records that it
 *     could not be read from a primary source, so the rate table's figures are computed from Anthropic's
 *     first-party rates. The correctness columns are unaffected.
 *
 * ## ⛔ THE ID BEDROCK IS CALLED WITH IS NOT ALWAYS THE ID THE RATE TABLE KEYS ON
 *
 * Claude Haiku 4.5 reports `inferenceTypesSupported: ["INFERENCE_PROFILE"]`, and calling the bare model id
 * fails with `ValidationException: Invocation of model ID … with on-demand throughput isn't supported`. It
 * must be invoked through a cross-region inference profile — `us.anthropic.claude-haiku-4-5-…`. The rate table
 * (ADR-0024) keys on the BARE id, so the two are kept apart here: {@link INVOCATION_IDS} maps a roster entry
 * to what Bedrock is called with, and everything else — pricing, reporting, the report's model column — uses
 * the bare id. ⚠️ This is a latent gap in the SHIPPED gate too: `verifyLine` resolves its model id from SSM and
 * passes it straight to both `rateFor` and `converse`, so pointing SSM at Haiku would fail every call. That is
 * ADR territory, not a change to make from a bake-off script.
 *
 * ## ⚠️ SWAP AUGMENTATION
 *
 * Each line is judged TWICE — once with the candidate presented as-is and once with the parse and the
 * candidate swapped in the prompt's ordering — which doubles the call count and is included in the cost
 * figures. Plan U11 sizes position bias at 10–15 points, and `swapDisagreements` in the report is what turns
 * that mitigation from an assertion into a measurement.
 *
 * ## ⚠️ CONCURRENCY IS A PROPERTY OF THIS SCRIPT, NOT OF THE GATE
 *
 * The gate runs at `reservedConcurrency = 1`; this runner does not, because ~9,700 serialized calls is hours
 * and this is a local script with no ceiling behind it. Throttling is therefore a real risk, and it is NOT
 * retried: the transport pins `maxAttempts: 1`, a throttled call arrives as an `inconclusive` trial with
 * `stopReason=ThrottlingException`, and the stop-reason census in the report is what makes a run degraded by
 * throttling legible instead of scoring it as model abstention. If that count is not ~0, lower
 * `--concurrency` and run again rather than believing the rates.
 *
 * ## Usage
 *
 * ```
 * AWS_REGION=us-east-1 npx tsx src/scripts/verificationBakeOff.ts \
 *   --corpus ./corpus.jsonl --limit 20 --concurrency 8 --trials-out ./trials.jsonl
 * ```
 *
 * @sideEffect Calls Amazon Bedrock (billed), reads a file, may write a file, writes to stdout and stderr.
 */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import pLimit from 'p-limit';
import { createBedrockConverseClient, createBedrockTransport, isBedrockClientError } from '@kitchensink/bedrock-client';
import type { BedrockConverseClient, BedrockTokenUsage } from '@kitchensink/bedrock-client';
import {
    CLAUDE_HAIKU_4_5_MODEL_ID,
    NOVA_MICRO_MODEL_ID,
    actualCostMicros,
    rateFor,
} from '@kitchensink/recipe-core/spend/spend-arithmetic';
import { bandFor } from '@kitchensink/recipe-core/resolution/confidence';

import { scoreBakeOff, type BakeOffReport, type BakeOffTrial } from '../verification/bakeOff.js';
import { parseCorpusJsonl, type CorpusLine } from '../verification/corpus.js';
import { RESIDUAL_SLICE_CLASSES } from '../verification/corpusSynthesis.js';
import {
    VERIFICATION_MAX_OUTPUT_TOKENS,
    buildVerificationPrompt,
} from '@kitchensink/recipe-core/resolution/verification-prompt';
import { readVerdict } from '@kitchensink/recipe-core/resolution/verification-verdict';

/**
 * What a BARE invocation runs — ADR-0024 §4a's roster, and nothing else.
 *
 * ⛔ TWO MODELS, AND GEMINI IS NOT ONE OF THEM. Gemini Flash-Lite is not available on Amazon Bedrock at all —
 * only Google's Gemma models are — so naming it would break every premise that chose Bedrock: no vendor
 * relationship, no secret in Secrets Manager, and no egress path of its own to review against ADR-0004.
 * Adding a third candidate is its own ADR, not a line in this array. If one is wanted, the in-boundary option
 * is a Gemma model.
 *
 * ⚠️ THIS IS NO LONGER THE LIST OF WHAT MAY BE CALLED — see {@link resolveModels}. It is the default, which
 * is a different question, and the two were one list until pricing Nova Lite and Nova Pro made them diverge.
 */
export const DEFAULT_MODELS: readonly string[] = Object.freeze([NOVA_MICRO_MODEL_ID, CLAUDE_HAIKU_4_5_MODEL_ID]);

/**
 * Decide which models this run will spend on.
 *
 * ⛔ THE PERMITTED SET IS THE RATE TABLE, NOT A LIST IN THIS FILE. `BEDROCK_MODEL_REGISTRY`'s own docstring says
 * "membership is authorization", and a second roster beside it is a copy of that authority that can drift
 * from it — which is exactly what a `--models` id the runner accepts and `judge` then refuses would be. So
 * the check is `rateFor(...) !== undefined`, the same predicate the production gate fails closed on.
 *
 * ⚠️ The `us.`-prefixed inference-profile ids are therefore REFUSED here even though Bedrock would answer
 * them: the table keys on the bare id, so accepting a profile id would produce an uncosted run rather than a
 * broken one. {@link INVOCATION_IDS} is where a profile id belongs.
 *
 * @param requested - The raw `--models` value, or `undefined` for the default roster.
 * @returns The models to run, in the order asked for. Pure.
 * @throws If any id is unpriced, repeated, or the selection is empty.
 */
export function resolveModels(requested: string | undefined): readonly string[] {
    if (requested === undefined) {
        return DEFAULT_MODELS;
    }

    const named = requested
        .split(',')
        .map((name) => name.trim())
        .filter((name) => name.length > 0);

    if (named.length === 0) {
        throw new Error('--models named no model; omit it to run the default roster');
    }

    const unpriced = named.filter((name) => rateFor(name) === undefined);

    if (unpriced.length > 0) {
        throw new Error(
            `--models names a model the Bedrock rate table cannot price: ${unpriced.join(', ')}. ` +
                'Add it to BEDROCK_MODEL_REGISTRY with a price read from a primary source, or use the bare ' +
                'model id rather than a us.-prefixed inference profile.',
        );
    }

    const repeated = named.filter((name, index) => named.indexOf(name) !== index);

    if (repeated.length > 0) {
        // Not deduplicated silently: the corpus would be judged twice at twice the cost, and the report would
        // carry two entries with the same modelId — a comparison table comparing a model to itself.
        throw new Error(
            `--models names a model twice, which would double the spend: ${[...new Set(repeated)].join(', ')}`,
        );
    }

    return named;
}

/**
 * What each roster entry is actually INVOKED as.
 *
 * A model absent here is invoked by its own id. See the file docstring: this exists because Claude Haiku 4.5
 * supports inference profiles only, and the rate table keys on the bare model id.
 */
const INVOCATION_IDS: Readonly<Record<string, string>> = Object.freeze({
    [CLAUDE_HAIKU_4_5_MODEL_ID]: `us.${CLAUDE_HAIKU_4_5_MODEL_ID}`,
});

/** How many calls may be in flight. Conservative by default — see the concurrency note in the docstring. */
const DEFAULT_CONCURRENCY = 8;

/** How often progress is written to stderr, in completed calls. */
const PROGRESS_EVERY = 100;

/**
 * A trial, plus the raw verdict it came from.
 *
 * ⛔ WHY THE RAW VERDICT IS KEPT. `bandFor` collapses (verdict, certainty) into three bands, and the committed
 * confidence thresholds ARE that collapse — whether a `medium` disagreement withholds, or only a `high` one.
 * A run that recorded only the band could not calibrate the thing it was run to calibrate, and re-deriving it
 * costs the whole run again. It is an ADDITIVE record: `scoreBakeOff` reads only the fields it always read,
 * and no number in any report changes because these two are present.
 */
interface BakeOffObservation extends BakeOffTrial {
    readonly modelId: string;
    readonly verdict: string | undefined;
    readonly certainty: string | undefined;
    readonly contrastClass: string | undefined;
    /**
     * The raw token counts the cost was computed from.
     *
     * ⚠️ ADDITIVE, like {@link BakeOffObservation.verdict}: `scoreBakeOff` never reads it and no reported
     * number moves because it is present. It is here because ADR-0024 §5 ASSERTS that `cacheReadInputTokens`
     * and `cacheWriteInputTokens` are always zero at this prompt size — reasoning from Claude Haiku 4.5's
     * 4,096-token checkpoint minimum. Amazon Nova documents AUTOMATIC prompt caching "for all text prompts",
     * which is a different mechanism that assumption does not cover, and the counter costs cache reads at a
     * DERIVED rate that the Price List API contradicts. Recording usage turns "the ADR says zero" into
     * something a run can check for free.
     */
    readonly usage: BedrockTokenUsage | undefined;
}

/** One model's numbers, on both slices. */
interface ModelReport {
    readonly modelId: string;
    readonly full: BakeOffReport;
    /** The near-miss identity contrasts plus their matching correct lines. Empty for a corpus with no classes. */
    readonly residual: BakeOffReport;
}

/**
 * Judge one line with one model, in one candidate ordering.
 *
 * ⚠️ It asks about BOTH aspects unconditionally, deliberately. The production gate narrows the question when
 * a curated mapping or a wide margin has already established identity — but the bake-off is measuring the
 * MODEL, and a model that only ever saw the narrowed prompt would be scored on a different task than the one
 * it will sometimes be given.
 *
 * @param client - The Bedrock client.
 * @param modelId - The model, as the rate table and the report know it.
 * @param line - The corpus line.
 * @param swapVariant - Which candidate ordering to present.
 * @returns The observation, including its measured cost.
 * @sideEffect One billed Bedrock call.
 */
async function judge(
    client: BedrockConverseClient,
    modelId: string,
    line: CorpusLine,
    swapVariant: 'original' | 'swapped',
): Promise<BakeOffObservation> {
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

    const base = {
        lineId: line.lineId,
        parseIsCorrect: line.parseIsCorrect,
        swapVariant,
        modelId,
        contrastClass: line.contrastClass,
    };

    try {
        const outcome = await client.converse({
            invocationId: INVOCATION_IDS[modelId] ?? modelId,
            systemPrompt: prompt.system,
            userMessage: prompt.user,
            maxOutputTokens: VERIFICATION_MAX_OUTPUT_TOKENS,
        });

        const costMicros = outcome.usage === undefined ? 0 : actualCostMicros(rate, outcome.usage);

        if (outcome.kind !== 'answered') {
            return {
                ...base,
                band: 'inconclusive',
                stopReason: outcome.stopReason ?? 'unusable',
                costMicros,
                verdict: undefined,
                certainty: undefined,
                usage: outcome.usage,
            };
        }

        const reading = readVerdict(outcome.text, outcome.stopReason);

        return {
            ...base,
            band: reading.kind === 'read' ? bandFor(reading.outcome) : 'inconclusive',
            stopReason: outcome.stopReason,
            costMicros,
            verdict: reading.kind === 'read' ? reading.outcome.verdict : undefined,
            certainty: reading.kind === 'read' ? reading.outcome.certainty : undefined,
            usage: outcome.usage,
        };
    } catch (error) {
        // A failed call is not a verdict. It is recorded as inconclusive with a named cause so a run degraded
        // by throttling is legible as such rather than scored as model abstention.
        return {
            ...base,
            band: 'inconclusive',
            stopReason: isBedrockClientError(error) ? error.name : 'error',
            costMicros: 0,
            verdict: undefined,
            certainty: undefined,
            usage: undefined,
        };
    }
}

/** Read and validate the command line. */
function readOptions(): {
    corpus: string;
    limit: number;
    concurrency: number;
    models: readonly string[];
    trialsOut: string | undefined;
} {
    const { values } = parseArgs({
        options: {
            corpus: { type: 'string' },
            limit: { type: 'string' },
            concurrency: { type: 'string' },
            models: { type: 'string' },
            'trials-out': { type: 'string' },
        },
    });

    if (values.corpus === undefined) {
        throw new Error('--corpus <path.jsonl> is required; the corpus is operator-supplied and not in this repo');
    }

    return {
        corpus: values.corpus,
        limit: Number(values.limit ?? Number.MAX_SAFE_INTEGER),
        concurrency: Number(values.concurrency ?? DEFAULT_CONCURRENCY),
        models: resolveModels(values.models),
        trialsOut: values['trials-out'],
    };
}

/**
 * Score a model on both slices.
 *
 * @param modelId - The model.
 * @param observations - Every observation for that model.
 * @returns The full and residual reports. Pure.
 */
function reportFor(modelId: string, observations: readonly BakeOffObservation[]): ModelReport {
    const residual = observations.filter(
        (observation) =>
            observation.contrastClass !== undefined &&
            RESIDUAL_SLICE_CLASSES.includes(observation.contrastClass as (typeof RESIDUAL_SLICE_CLASSES)[number]),
    );

    return {
        modelId,
        full: scoreBakeOff(modelId, observations),
        residual: scoreBakeOff(modelId, residual),
    };
}

/**
 * Run the roster and print a report per model, per slice.
 *
 * @sideEffect Reads the corpus file, calls Bedrock repeatedly, may write a trials file, writes to stdout.
 */
async function main(): Promise<void> {
    const options = readOptions();
    const region = process.env['AWS_REGION'] ?? 'us-east-1';
    const corpus = parseCorpusJsonl(readFileSync(options.corpus, 'utf8')).slice(0, options.limit);

    if (options.trialsOut !== undefined) {
        writeFileSync(options.trialsOut, '', 'utf8');
    }

    const client = createBedrockConverseClient(createBedrockTransport({ region }).send);
    const reports: ModelReport[] = [];

    for (const modelId of options.models) {
        const limit = pLimit(options.concurrency);
        const started = Date.now();
        let done = 0;

        const observations = await Promise.all(
            corpus.flatMap((line) =>
                (['original', 'swapped'] as const).map((swapVariant) =>
                    limit(async () => {
                        const observation = await judge(client, modelId, line, swapVariant);

                        done += 1;

                        if (done % PROGRESS_EVERY === 0) {
                            const elapsed = (Date.now() - started) / 1000;

                            process.stderr.write(
                                `${modelId}: ${String(done)}/${String(corpus.length * 2)} in ${elapsed.toFixed(0)}s\n`,
                            );
                        }

                        return observation;
                    }),
                ),
            ),
        );

        if (options.trialsOut !== undefined) {
            // ⛔ Written BEFORE the next model runs. If the second model's run dies, the first model's raw
            // trials — the expensive part — are already on disk and can be re-scored without re-spending.
            appendFileSync(options.trialsOut, `${observations.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
        }

        reports.push(reportFor(modelId, observations));
    }

    // Machine-readable, so the committed result is a file rather than a paraphrase of a terminal.
    process.stdout.write(
        `${JSON.stringify({ corpus: options.corpus, lines: corpus.length, region, reports }, null, 2)}\n`,
    );
}

// ⛔ Guarded, so importing this module for one exported symbol does not start spending money.
if (import.meta.main) {
    await main();
}
