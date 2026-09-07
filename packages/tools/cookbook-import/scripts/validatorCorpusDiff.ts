/**
 * THE VALIDATOR LOOP'S CORPUS-WIDE DIFF (plan U7's verification) — first attempt vs validated final,
 * over the full 1919 book.
 *
 * ⛔ A unit suite CANNOT verify this change (ADR-0026's own lesson: three food losses were found ONLY by
 * a corpus-wide diff), so this runner is the check any future change to the loop owes. It runs the REAL
 * decorated engine over the real corpus ONCE, records every line's FIRST attempt beside its FINAL
 * validated answer, and reports: food losses (a first attempt with foods whose final is empty —
 * `not_a_food` exhaustion is listed, not hidden), name/measure changes, retry-rate, and the validator
 * verdict census.
 *
 * ⛔ Spends real money on developer credentials (ADR-0024 §4a's operator path). `--limit` first.
 *
 * Usage:
 *   AWS_REGION=us-east-1 npx tsx scripts/validatorCorpusDiff.ts --book /tmp/pg12350.txt \
 *       [--limit 50] [--concurrency 6] --out /tmp/u7diff.json
 *
 * @sideEffect Bedrock calls (parse + validators + retries); writes the JSON report.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { createBedrockConverseClient, createBedrockTransport } from '@kitchensink/bedrock-client';
import { NOVA_2_LITE_MODEL_ID } from '@kitchensink/recipe-core/spend/spend-arithmetic';
import { createValidatedLlmEngine, type EngineAnswer, type ParseEnginePort } from '@kitchensink/recipe-import-core';

import { buildParseCorpus, harvestSourceTexts } from '../src/parseComparison/parseCorpus.js';
import { toCandidateRecipe, type RecipeCandidateOutcome } from '../src/proseRecipe.js';
import { segmentCookbook, stripGutenbergBoilerplate } from '../src/gutenbergBook.adapter.js';
import { COOKBOOKS, assertPublicDomain } from '../src/cookbooks.js';
import { createLlmEngine } from '../src/parsing/llmEngine.js';
import { createFoodnessValidator, createMeasurementValidator } from '../src/parsing/validators.js';

const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
        book: { type: 'string' },
        limit: { type: 'string' },
        concurrency: { type: 'string' },
        region: { type: 'string' },
        out: { type: 'string' },
    },
});

if (values.book === undefined || values.out === undefined) {
    throw new Error('--book and --out are required (nothing here fetches Project Gutenberg — ADR-0023)');
}

const region = values.region ?? process.env['AWS_REGION'] ?? 'us-east-1';
const limit = values.limit === undefined ? Number.POSITIVE_INFINITY : Number(values.limit);

const BOOK = COOKBOOKS['international-jewish'];

if (BOOK === undefined) {
    throw new Error('no cookbook registered');
}

const raw = readFileSync(values.book, 'utf8');
assertPublicDomain(raw, BOOK);
const blocks: readonly RecipeCandidateOutcome[] = segmentCookbook(stripGutenbergBoilerplate(raw)).map((block) =>
    toCandidateRecipe(block, BOOK),
);
const corpus = buildParseCorpus(harvestSourceTexts(blocks).clauses).slice(0, limit);

process.stderr.write(`corpus: ${String(corpus.length)} lines\n`);

const client = createBedrockConverseClient(createBedrockTransport({ region }).send);
const inner = createLlmEngine({
    client,
    modelId: NOVA_2_LITE_MODEL_ID,
    concurrency: values.concurrency === undefined ? 6 : Number(values.concurrency),
});

/** Record each line's FIRST attempt on the way through, so the diff needs only one run. */
const firstByLine = new Map<string, EngineAnswer>();
const recordingInner: ParseEnginePort<'llm'> = {
    engine: inner.engine,
    engineVersion: inner.engineVersion,
    async parse(lines) {
        const answers = await inner.parse(lines);

        for (const [index, line] of lines.entries()) {
            const answer = answers[index];

            if (answer !== undefined && !firstByLine.has(line)) {
                firstByLine.set(line, answer);
            }
        }

        return answers;
    },
};

const foodness = createFoodnessValidator(client);
const measurement = createMeasurementValidator(client, NOVA_2_LITE_MODEL_ID);
const validated = createValidatedLlmEngine({
    inner: recordingInner,
    retry: { parse: (line, failures) => inner.retry(line, failures) },
    foodness,
    measurement,
});

const CHUNK = 40;
const finals: EngineAnswer[] = [];

for (let start = 0; start < corpus.length; start += CHUNK) {
    const chunk = corpus.slice(start, start + CHUNK).map((line) => line.text);
    finals.push(...(await validated.parse(chunk)));
    process.stderr.write(`  ${String(Math.min(start + CHUNK, corpus.length))}/${String(corpus.length)}\n`);
}

interface DiffRow {
    readonly line: string;
    readonly firstFoods: readonly string[];
    readonly finalFoods: readonly string[];
    readonly attempts: number | null;
    readonly kind: 'unchanged' | 'retried-changed' | 'food-loss' | 'not-a-food' | 'unavailable';
}

const rows: DiffRow[] = corpus.map((line, index) => {
    const final = finals[index];
    const first = firstByLine.get(line.text);
    const foodsOf = (answer: EngineAnswer | undefined): readonly string[] =>
        answer === undefined || 'unavailable' in answer ? [] : answer.foods.map((food) => food.name);
    const firstFoods = foodsOf(first);
    const finalFoods = foodsOf(final);
    const attempts = final !== undefined && !('unavailable' in final) ? (final.llmAttempts ?? null) : null;

    let kind: DiffRow['kind'] = 'unchanged';

    if (final === undefined || 'unavailable' in final) {
        kind = 'unavailable';
    } else if (final.reviewReasons.includes('not_a_food')) {
        kind = 'not-a-food';
    } else if (firstFoods.length > 0 && finalFoods.length === 0) {
        kind = 'food-loss';
    } else if ((attempts ?? 1) > 1) {
        kind = 'retried-changed';
    }

    return { line: line.text, firstFoods, finalFoods, attempts, kind };
});

const census = rows.reduce<Record<string, number>>((tally, row) => {
    tally[row.kind] = (tally[row.kind] ?? 0) + 1;

    return tally;
}, {});

const spentMicros = inner.spentMicros() + foodness.spentMicros() + measurement.spentMicros();

writeFileSync(values.out, JSON.stringify({ census, spentMicros, rows }, null, 1));
process.stderr.write(`census: ${JSON.stringify(census)}  spent: $${(spentMicros / 1e6).toFixed(2)}\n`);
process.stderr.write(`report -> ${values.out}\n`);
