/**
 * THE FACTS SHEET OVER A PRIVATE RECIPE CORPUS (spec 027 FR-035, research R1). An operator script, run by hand:
 * `npm run corpus:facts --workspace=packages/shared/cooking`. It is not a test tier.
 *
 * The corpus, its hand-reviewed golden file and the recall floor all sit in `KITCHENSINK_IMPORT100_DIR`, outside the
 * repository, and nothing derived from them is ever written back into it. The script builds the sheet of every recipe
 * with the real duration reader, scores it with `factsCorpusScore.ts`, and exits 1 on a wrong fact or a recall below
 * the floor. The floor only rises, and only when `UPDATE_FACTS_RECALL_FLOOR=1`. A missing file exits 1.
 *
 * @sideEffect Reads and may write files in the corpus folder; writes to the console and sets the exit code.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { buildFactsSheet, type FactsSheetReaders } from '@kitchensink/recipe-core/step-writing/facts-sheet';
import { FactsSheetInvalidError } from '@kitchensink/recipe-core/step-writing/facts-sheet-input';
import type { FactsSheet } from '@kitchensink/recipe-core/step-writing/facts-sheet-types';

import { readDuration } from '../src/duration.js';

import {
    type GoldenRecipe,
    type Refusal,
    floorFaults,
    isFloor,
    ingredientNameOf,
    isRefusal,
    precisionFaults,
    raisedFloor,
    recallOf,
} from './factsCorpusScore.js';

const CORPUS_DIR =
    process.env['KITCHENSINK_IMPORT100_DIR'] ?? join(homedir(), '.local', 'state', 'kitchensink', 'import100');
const FLOOR_FILE = join(CORPUS_DIR, 'factsRecallFloor.json');

interface CorpusRecipe {
    readonly slug: string;
    readonly ingredientGroups: readonly { readonly lines: readonly string[] }[];
    readonly steps: readonly string[];
}

const readers: FactsSheetReaders = {
    durations: (text) => {
        const reading = readDuration(text);

        return reading.kind === 'one'
            ? [{ minSeconds: reading.seconds, maxSeconds: reading.highSeconds ?? reading.seconds }]
            : [];
    },
};

function readJson(name: string, what: string): unknown {
    const file = join(CORPUS_DIR, name);

    if (!existsSync(file)) {
        throw new Error(`${what} is missing: ${file}`);
    }

    return JSON.parse(readFileSync(file, 'utf8'));
}

/** The sheet of one recipe, or the field that refused it. */
function sheetOrRefusal(recipe: CorpusRecipe): FactsSheet | Refusal {
    const ingredientLines = recipe.ingredientGroups
        .flatMap((group) => group.lines)
        .map((line) => ({ displayText: ingredientNameOf(line) }))
        .filter((line) => line.displayText !== '');

    try {
        return buildFactsSheet(
            { language: 'en', ingredientLines, steps: recipe.steps.map((instruction) => ({ instruction })) },
            readers,
        );
    } catch (error) {
        if (error instanceof FactsSheetInvalidError) {
            return { refused: error.field };
        }

        throw error;
    }
}

function run(): string[] {
    const recipes = readJson('recipes.json', 'The recipe corpus') as readonly CorpusRecipe[];
    const golden = readJson('factsGolden.json', 'The reviewed golden file') as Record<string, GoldenRecipe>;
    const floor = readJson('factsRecallFloor.json', 'The recall floor');

    // A floor that cannot be compared would pass every run, so a malformed one stops the run.
    if (!isFloor(floor)) {
        throw new Error(`The recall floor is malformed: ${FLOOR_FILE}`);
    }

    const results = recipes.map((recipe) => ({ slug: recipe.slug, outcome: sheetOrRefusal(recipe) }));
    const missing = results
        .filter(({ slug }) => golden[slug] === undefined)
        .map(({ slug }) => `${slug}: no golden entry`);
    const scored = results.flatMap(({ slug, outcome }) => {
        const expected = golden[slug];

        return expected === undefined ? [] : [{ slug, outcome, expected }];
    });
    const refused = results.filter(({ outcome }) => isRefusal(outcome)).length;
    const recall = recallOf(scored);
    const faults = [
        ...missing,
        ...scored.flatMap(({ slug, outcome, expected }) => precisionFaults(slug, outcome, expected)),
        ...floorFaults(recall, refused, floor),
    ];

    console.info(`facts sheet corpus: ${refused} of ${recipes.length} refused, recall`, recall);

    if (faults.length === 0 && process.env['UPDATE_FACTS_RECALL_FLOOR'] === '1') {
        writeFileSync(FLOOR_FILE, `${JSON.stringify(raisedFloor(recall, refused, floor), null, 2)}\n`);
    }

    return faults;
}

try {
    const faults = run();

    faults.forEach((fault) => console.error(fault));
    process.exitCode = faults.length === 0 ? 0 : 1;
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
}
