/**
 * Plan 001 §6's FREE measurement runs for the instruction gate (`readsAsInstruction`), before any production code:
 *
 * - `--nyt <csv>`: run 1, the NYT ingredient corpus (`.local-sandbox/corpora/nytIngredients.csv`, gitignored). Its
 *   `name` column is a person's label, so a skipped row with a name is a false refusal.
 * - `--book <txt>`: run 2, the 1919 clauses, with the local CRF (`scripts/crfParse.py`) as the oracle. A skipped
 *   clause the CRF named something in goes on the adjudication list.
 *
 * The ship gate is zero ADJUDICATED false refusals on both runs. Run 3 (the paid, CRF-enabled full pipeline) is not
 * here: it spends Bedrock with no ceiling and needs the owner's go-ahead first.
 *
 * Usage (the book is downloaded by hand; nothing here fetches Project Gutenberg — ADR-0023):
 *   npx tsx scripts/instructionGateCorpusDiff.ts --nyt <nytIngredients.csv> --book <pg12350.txt> --out <report.json>
 *
 * @sideEffect Reads the corpora, spawns the CRF sidecar for `--book`, and writes the report.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { parse } from 'csv-parse/sync';

import { readsAsInstruction } from '@kitchensink/recipe-import-core';

import { COOKBOOKS, assertPublicDomain } from '../src/cookbooks.js';
import { segmentCookbook, stripGutenbergBoilerplate } from '../src/gutenbergBook.adapter.js';
import { parseLinesWithCrf } from '../src/parseComparison/crfProcess.js';
import {
    gateOverClauses,
    gateOverLabelledRows,
    type ClauseReport,
    type LabelledRow,
    type LabelledRowReport,
} from '../src/parseComparison/instructionGate.js';
import { buildParseCorpus, harvestSourceTexts } from '../src/parseComparison/parseCorpus.js';
import { toCandidateRecipe } from '../src/proseRecipe.js';

const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
        nyt: { type: 'string' },
        book: { type: 'string' },
        out: { type: 'string' },
    },
});

if (values.out === undefined || (values.nyt === undefined && values.book === undefined)) {
    throw new Error('--out and at least one of --nyt or --book are required');
}

/**
 * Run 1 over the NYT CSV.
 *
 * @sideEffect Reads the file.
 */
function runNyt(path: string): LabelledRowReport {
    const records = parse(readFileSync(path, 'utf8'), { columns: true, skip_empty_lines: true }) as Record<
        string,
        string
    >[];
    const rows: LabelledRow[] = records.map((record) => ({ input: record['input'] ?? '', name: record['name'] ?? '' }));

    return gateOverLabelledRows(rows, readsAsInstruction);
}

/**
 * Run 2 over the 1919 book's harvested clauses, the CRF as oracle.
 *
 * @sideEffect Reads the book and spawns the CRF sidecar.
 */
async function runBook(path: string): Promise<ClauseReport> {
    const book = COOKBOOKS['international-jewish'];

    if (book === undefined) {
        throw new Error('no cookbook registered');
    }

    const raw = readFileSync(path, 'utf8');

    assertPublicDomain(raw, book);

    const blocks = segmentCookbook(stripGutenbergBoilerplate(raw)).map((block) => toCandidateRecipe(block, book));
    const clauses = buildParseCorpus(harvestSourceTexts(blocks).clauses).map((line) => line.text);
    const parses = await parseLinesWithCrf(clauses);
    const named = new Map(clauses.map((clause, index) => [clause, parses[index]?.names ?? []] as const));

    return gateOverClauses(clauses, readsAsInstruction, (clause) => named.get(clause) ?? []);
}

const report = {
    ...(values.nyt === undefined ? {} : { nyt: runNyt(values.nyt) }),
    ...(values.book === undefined ? {} : { book: await runBook(values.book) }),
};

writeFileSync(values.out, `${JSON.stringify(report, null, 4)}\n`);

if (report.nyt !== undefined) {
    process.stderr.write(
        `nyt: ${String(report.nyt.skipped)} of ${String(report.nyt.total)} skipped, ` +
            `${String(report.nyt.falseRefusals.length)} false refusals\n`,
    );
}

if (report.book !== undefined) {
    process.stderr.write(
        `book: ${String(report.book.skipped)} of ${String(report.book.total)} skipped, ` +
            `${String(report.book.toAdjudicate.length)} to adjudicate\n`,
    );
}
