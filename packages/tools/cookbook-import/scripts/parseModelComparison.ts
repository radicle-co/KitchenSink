/**
 * THE PARSE COMPARISON RUNNER — three models, one CRF parser, one corpus of real 1919 ingredient lines.
 *
 * DESIGN PATTERN: **decide/evaluate split.** Every number this prints is computed by a pure, unit-tested
 * module under `src/parseComparison/`; this file does the reading, the calling and the printing, and
 * nothing else. That is deliberate and it is the same split `verificationBakeOff.ts` uses: an arithmetic
 * error found after a billed run costs the run again.
 *
 * ## ⛔⛔ BEFORE YOU RUN THIS
 *
 * 1. **It spends real money on developer credentials and NOTHING stops it.** ADR-0024's reserve-then-settle
 *    counter guards the recipe worker, not a script. `--limit` exists so a first run is 20 lines. A
 *    worst-case estimate is printed BEFORE the first call; read it.
 * 2. **The book is not in this repository and must not be.** ADR-0023: nothing we ship fetches Project
 *    Gutenberg, whose terms bar automated access however permissive its `robots.txt` looks. Download it by
 *    hand once (`README.md` step 1) and pass `--book`. This script never fetches anything.
 * 3. **Nova Pro's on-demand quota is 250 requests/minute against 2,000 for Micro and Lite.** A previous run
 *    of a sibling harness came back 83.6% throttled and produced numbers that meant nothing.
 *    {@link CONCURRENCY_CEILING} caps it; do not raise it without reading the stop-reason census afterwards.
 * 4. **Read the stop-reason census FIRST.** `maxAttempts: 1` is pinned in the transport and this script adds
 *    no retry, so a throttled call arrives as a recorded `callFailed`. If that count is not ~0, lower
 *    `--concurrency` and run again rather than believing the rates.
 * 5. **This measures a PARSE, not a verification.** `docs/reports/2026-08-23-001-verification-bake-off.md`
 *    asked models whether OUR parse matched OUR candidate, which anchors the answer on ours. None of its
 *    figures carry over, and the two must not be tabulated together.
 *
 * ## Usage
 *
 * ```
 * curl -fL -o /tmp/pg12350.txt https://www.gutenberg.org/cache/epub/12350/pg12350.txt   # by hand, once
 * AWS_REGION=us-east-1 npx tsx scripts/parseModelComparison.ts \
 *   --book /tmp/pg12350.txt --limit 20 --variant v1 --out /tmp/parseTrials.json
 * ```
 *
 * ## The prompt arm
 *
 * `--variant v1|v2|v3|v4` selects which wording is measured and defaults to `v1`, the SHIPPED prompt. The
 * four are defined in `src/parseComparison/promptVariant.ts`, and each run measures exactly ONE — a
 * bake-off is four invocations over the same corpus with the same model, never one invocation that
 * interleaves them, because a shared run would have to keep four contract censuses apart inside one
 * reducer for no gain.
 *
 * ⚠️ **Arms are compared only WITHIN one sitting.** `temperature: 0` is not determinism — the three-arm run
 * measured 72.5-95% byte-identical answers on a repeated pass — so a candidate compared against a figure
 * frozen in an earlier report would charge run-to-run variance to the prompt. Re-measure every arm a table
 * puts side by side, which is why §16's four-arm table re-ran v1, v2 and v3 rather than citing §15's.
 *
 * ⛔ v3 reports its UNIT directly instead of leaving it to be derived from the measure phrase, so its
 * unit and measure figures are not produced the same way as v1's, v2's and v4's. The arm's `unitSource` is
 * printed at launch and carried in the JSON precisely so that no table can present the four as one
 * column without saying so.
 *
 * @sideEffect Reads a file, spawns Python, calls Amazon Bedrock (billed), may write a file, writes stdout.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { createBedrockConverseClient, createBedrockTransport } from '@kitchensink/bedrock-client';
import {
    NOVA_LITE_MODEL_ID,
    NOVA_MICRO_MODEL_ID,
    NOVA_PRO_MODEL_ID,
    rateFor,
    worstCaseMicros,
} from '@kitchensink/recipe-core/spend/spend-arithmetic';
import pLimit from 'p-limit';

import { COOKBOOKS, assertPublicDomain } from '../src/cookbooks.js';
import { segmentCookbook, stripGutenbergBoilerplate } from '../src/gutenbergBook.adapter.js';
import type { CrfParse } from '../src/parseComparison/crfParse.js';
import { parseLinesWithCrf } from '../src/parseComparison/crfProcess.js';
import {
    buildParseCorpus,
    determinismSample,
    harvestSourceTexts,
    plannedCalls,
} from '../src/parseComparison/parseCorpus.js';
import type { ParseCorpusLine } from '../src/parseComparison/parseCorpus.js';
import {
    pairDeterminism,
    summarizeDeterminism,
    summarizeParseComparison,
} from '../src/parseComparison/parseComparisonReport.js';
import type { DeterminismPair, DeterminismPass } from '../src/parseComparison/parseComparisonReport.js';
import { MAX_PARSE_PROMPT_CHARS, PARSE_MAX_OUTPUT_TOKENS } from '../src/parseComparison/parsePrompt.js';
import { resolveParseVariant } from '../src/parseComparison/promptVariant.js';
import type { ParseVariant } from '../src/parseComparison/promptVariant.js';
import { runParseTrial, type ParseTrialRecord } from '../src/parseComparison/runParseTrial.js';
import { toCandidateRecipe, type RecipeCandidateOutcome } from '../src/proseRecipe.js';

/**
 * The roster: the whole priced Nova family.
 *
 * ⛔ Claude Haiku 4.5 is deliberately absent. This AWS account has not submitted Anthropic's use-case
 * attestation, so every call returns `ResourceNotFoundException` — see
 * `docs/reports/2026-08-23-001-verification-bake-off.md` §1. It is unmeasured, not rejected.
 *
 * ⛔ Gemini is not on the roster and cannot be: it is not available on Bedrock at all (only Gemma is), and
 * naming it would break every premise ADR-0024 §4a chose Bedrock for.
 *
 * ⚠️ Membership here is NOT the authorization — `runParseTrial` refuses any id absent from
 * `BEDROCK_MODEL_REGISTRY`, which is the single authority. This is only the default selection.
 */
const DEFAULT_MODELS: readonly string[] = Object.freeze([NOVA_MICRO_MODEL_ID, NOVA_LITE_MODEL_ID, NOVA_PRO_MODEL_ID]);

/**
 * The most concurrent calls each model tolerates on on-demand throughput.
 *
 * ⚠️ Nova Pro's default on-demand quota is 250 requests/minute; Micro and Lite are at 2,000. At ~400 ms per
 * call, 3 in flight is ~450 RPM and 2 is ~300 — so Pro's ceiling is 2 and even that leans on latency. This
 * is a fact about the SERVICE quota, not about the model's quality, and it is the difference between a
 * comparable column and the 83.6%-throttled one a sibling harness produced.
 */
const CONCURRENCY_CEILING: Readonly<Record<string, number>> = Object.freeze({
    [NOVA_MICRO_MODEL_ID]: 8,
    [NOVA_LITE_MODEL_ID]: 8,
    [NOVA_PRO_MODEL_ID]: 2,
});

/** The one book this harness is registered for. Its licence header is re-checked against the actual bytes. */
const BOOK = COOKBOOKS['international-jewish'];

async function main(): Promise<void> {
    const { values } = parseArgs({
        options: {
            book: { type: 'string' },
            models: { type: 'string' },
            limit: { type: 'string' },
            concurrency: { type: 'string' },
            'determinism-sample': { type: 'string' },
            region: { type: 'string' },
            out: { type: 'string' },
            variant: { type: 'string' },
        },
    });

    if (values.book === undefined) {
        throw new Error('--book is required: nothing here fetches Project Gutenberg (ADR-0023, README step 1)');
    }

    // ⛔ Resolved BEFORE anything is read or spent: an unknown arm must fail on the command line, not
    // after a CRF pass and 2,500 billed calls have measured whatever a fallback happened to be.
    const variant = resolveParseVariant(values.variant ?? 'v1');
    const models = resolveModels(values.models);
    const limit = readCount('--limit', values.limit, Number.POSITIVE_INFINITY);
    const askedConcurrency = readCount('--concurrency', values.concurrency, 6);
    const sampleSize = readCount('--determinism-sample', values['determinism-sample'], 40);

    const harvest = harvestSourceTexts(readBlocks(values.book));
    const wholeCorpus = buildParseCorpus(harvest.clauses);
    const corpus = wholeCorpus.slice(0, limit);

    process.stderr.write(
        `corpus: ${corpus.length} of ${wholeCorpus.length} distinct lines ` +
            `(${corpus.filter((line) => line.origin === 'ingredient').length} ingredient, ` +
            `${corpus.filter((line) => line.origin === 'dropped').length} dropped), ` +
            `from ${harvest.acceptedBlocks} accepted blocks ` +
            `(${harvest.skippedBlocks} blocks skipped: ${JSON.stringify(harvest.skipReasons)}; ` +
            `${harvest.clauses.length} extracted clauses before de-duplication)\n`,
    );

    process.stderr.write(`prompt arm: ${variant.id} — ${variant.summary} (unit is ${variant.unitSource})\n`);
    estimateWorstCase(models, corpus.length, sampleSize, askedConcurrency, variant);

    process.stderr.write('parsing the corpus with the CRF model...\n');
    const crfByLine = await crfIndex(corpus);

    const client = createBedrockConverseClient(
        createBedrockTransport({ region: values.region ?? process.env['AWS_REGION'] ?? 'us-east-1' }).send,
    );
    const sample = determinismSample(corpus, sampleSize);
    const trials: ParseTrialRecord[] = [];
    const pairs: DeterminismPair[] = [];
    // ⛔ The repeat pass is billed exactly like the first, so its cost is accumulated here even though its
    // trials are deliberately kept OUT of `summarizeParseComparison` (they would double-weight the sampled
    // lines in the contract census). A run total that omitted it under-reported spend by two thirds on a
    // 20-line smoke run.
    let repeatPassCostMicros = 0;

    for (const modelId of models) {
        const concurrency = Math.min(askedConcurrency, CONCURRENCY_CEILING[modelId] ?? askedConcurrency);
        const gate = pLimit(concurrency);

        process.stderr.write(`${modelId}: pass 1 over ${corpus.length} lines at concurrency ${concurrency}...\n`);
        const first = await Promise.all(
            corpus.map((line) =>
                gate(() => runParseTrial({ client, modelId, line, crf: crfByLine.get(line.id), variant })),
            ),
        );

        trials.push(...first);

        process.stderr.write(`${modelId}: pass 2 over ${sample.length} sampled lines...\n`);
        const firstByLine = new Map(first.map((trial) => [trial.lineId, trial]));
        const second = await Promise.all(
            sample.map((line) =>
                gate(() => runParseTrial({ client, modelId, line, crf: crfByLine.get(line.id), variant })),
            ),
        );

        for (const repeat of second) {
            const original = firstByLine.get(repeat.lineId);

            repeatPassCostMicros += repeat.costMicros;

            if (original === undefined) {
                continue;
            }

            pairs.push(pairDeterminism(modelId, asPass(original), asPass(repeat), variant.readAnswer));
        }
    }

    const report = {
        // ⛔ The arm is part of the RESULT, not of the invocation. A JSON report that did not name the
        // prompt it measured is indistinguishable from one that measured a different prompt, and four
        // arms of one bake-off are four files that would otherwise be told apart only by their names.
        variant: {
            id: variant.id,
            summary: variant.summary,
            unitSource: variant.unitSource,
            systemPromptChars: [...variant.systemPrompt].length,
        },
        corpus: {
            book: `${BOOK.title} (Project Gutenberg #${BOOK.ebookId})`,
            lines: corpus.length,
            distinctLines: wholeCorpus.length,
            truncatedByLimit: corpus.length !== wholeCorpus.length,
            ingredientLines: corpus.filter((line) => line.origin === 'ingredient').length,
            droppedLines: corpus.filter((line) => line.origin === 'dropped').length,
            acceptedBlocks: harvest.acceptedBlocks,
            skippedBlocks: harvest.skippedBlocks,
            skipReasons: harvest.skipReasons,
            extractedClauses: harvest.clauses.length,
        },
        promptChars: variant.promptCharCap ?? MAX_PARSE_PROMPT_CHARS,
        maxOutputTokens: variant.maxOutputTokens ?? PARSE_MAX_OUTPUT_TOKENS,
        models: summarizeParseComparison(trials, models),
        determinism: summarizeDeterminism(pairs, models),
        firstPassCostMicros: trials.reduce((sum, trial) => sum + trial.costMicros, 0),
        repeatPassCostMicros,
        totalCostMicros: trials.reduce((sum, trial) => sum + trial.costMicros, 0) + repeatPassCostMicros,
    };

    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

    if (values.out !== undefined) {
        writeFileSync(
            values.out,
            `${JSON.stringify({ corpus, crf: [...crfByLine], trials, pairs }, null, 2)}\n`,
            'utf8',
        );
        process.stderr.write(`raw trials written to ${values.out} (⛔ scratch only — do not commit)\n`);
    }
}

/**
 * Read the book and segment it into blocks, each judged by the importer's own mapper.
 *
 * @sideEffect Reads a file.
 */
function readBlocks(path: string): readonly RecipeCandidateOutcome[] {
    const raw = readFileSync(path, 'utf8');

    // Re-checks the licence header against the ACTUAL BYTES, not the filename: a copyrighted Gutenberg text
    // must never be measured under a public-domain attribution.
    assertPublicDomain(raw, BOOK);

    return segmentCookbook(stripGutenbergBoilerplate(raw)).map((block) => toCandidateRecipe(block, BOOK));
}

/**
 * Read a non-negative count from the command line.
 *
 * @throws When the value is not a non-negative whole number.
 */
function readCount(flag: string, raw: string | undefined, fallback: number): number {
    if (raw === undefined) {
        return fallback;
    }

    const value = Number(raw);

    if (!Number.isInteger(value) || value < 0) {
        throw new Error(`${flag} must be a non-negative whole number, not ${JSON.stringify(raw)}`);
    }

    return value;
}

/**
 * Decide which models this run will spend on.
 *
 * @throws When any id is unpriced or the selection is empty.
 */
function resolveModels(requested: string | undefined): readonly string[] {
    const models = requested === undefined ? DEFAULT_MODELS : requested.split(',').map((id) => id.trim());

    for (const modelId of models) {
        if (rateFor(modelId) === undefined) {
            throw new Error(`parseComparison: ${modelId} is not priced in BEDROCK_MODEL_REGISTRY`);
        }
    }

    if (models.length === 0) {
        throw new Error('parseComparison: --models selected nothing');
    }

    return models;
}

/** A trial, as the determinism pairing sees it. An empty response is one that never arrived. */
function asPass(trial: ParseTrialRecord): DeterminismPass {
    return { lineId: trial.lineId, responded: trial.responseText !== '', responseText: trial.responseText };
}

/**
 * Parse every corpus line with the CRF model, keyed by line id.
 *
 * @sideEffect Spawns a Python process.
 */
async function crfIndex(corpus: readonly ParseCorpusLine[]): Promise<ReadonlyMap<string, CrfParse>> {
    const parses = await parseLinesWithCrf(corpus.map((line) => line.text));

    return new Map(corpus.map((line, index) => [line.id, parses[index]] as const).filter(hasParse));
}

function hasParse(entry: readonly [string, CrfParse | undefined]): entry is readonly [string, CrfParse] {
    return entry[1] !== undefined;
}

/**
 * Print what this run can possibly cost before spending anything.
 *
 * ⛔ The WORST case, from the same arithmetic ADR-0024's reservation uses: the full input cap charged at the
 * dearest input rate, plus the full output cap. The real bill is far lower — a corpus line is ~40 characters
 * against a 2,000-character cap — and that is the point: an estimate that could be exceeded is not a bound.
 *
 * @sideEffect Writes to stderr.
 */
function estimateWorstCase(
    models: readonly string[],
    lines: number,
    sampleSize: number,
    concurrency: number,
    variant: ParseVariant,
): void {
    const calls = plannedCalls(lines, sampleSize);
    let total = 0;

    for (const modelId of models) {
        const rate = rateFor(modelId);

        if (rate === undefined) {
            throw new Error(`parseComparison: ${modelId} is not priced in BEDROCK_MODEL_REGISTRY`);
        }

        // ⛔ The ARM's ceilings, so the printed bound actually bounds THIS run. v6's prompt is 1.8x the
        // shipped cap and its output budget 3x, and a stale figure here would under-state the spend.
        total +=
            calls *
            worstCaseMicros(
                rate,
                variant.promptCharCap ?? MAX_PARSE_PROMPT_CHARS,
                variant.maxOutputTokens ?? PARSE_MAX_OUTPUT_TOKENS,
            );
    }

    process.stderr.write(
        `⛔ worst case: ${calls} calls x ${models.length} models = $${(total / 1_000_000).toFixed(4)} ` +
            `(asked concurrency ${concurrency}; per-model ceilings apply)\n`,
    );
}

await main();
