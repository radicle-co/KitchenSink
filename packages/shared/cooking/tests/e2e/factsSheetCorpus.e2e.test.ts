/**
 * THE FACTS SHEET OVER A REAL RECIPE CORPUS (spec 027 FR-035, research R1). LOCAL e2e only.
 *
 * The corpus is a folder of recipes on the developer's machine, and its text never enters this repository. This test
 * builds the sheet of every recipe with the real duration reader and holds it to a hand-reviewed golden file that sits
 * beside the corpus. Two promises are checked:
 *
 *  1. Precision: every fact the sheet states is in the golden file, and a recipe the golden file says must be refused is
 *     refused. A wrong fact is worse than a missing one.
 *  2. Recall, per fact kind: the share of golden facts the sheet finds. It is kept as a floor that can only rise, in a
 *     file beside the corpus. A run that finds less than the floor fails, and a run that finds more raises it.
 *
 * Both files are required. A missing corpus or golden file throws, so the tier never passes by skipping.
 *
 * The ingredient names of a recipe are read from its ingredient lines by a plain rule below: the food words after the
 * amount and unit, cut at the first comma. It stands in for the parse the app does, and it is as good as that rule.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { leadingAmount } from '@kitchensink/recipe-core/parsing/measure-reader';
import { buildFactsSheet, type FactsSheetReaders } from '@kitchensink/recipe-core/step-writing/facts-sheet';
import type { FactsSheet } from '@kitchensink/recipe-core/step-writing/facts-sheet-types';
import { FactsSheetInvalidError } from '@kitchensink/recipe-core/step-writing/facts-sheet-input';
import { describe, expect, it } from 'vitest';

import { readDuration } from '../../src/duration.js';

const CORPUS_DIR =
    process.env['KITCHENSINK_IMPORT100_DIR'] ?? join(homedir(), '.local', 'state', 'kitchensink', 'import100');
const RECIPES_FILE = join(CORPUS_DIR, 'recipes.json');
const GOLDEN_FILE = join(CORPUS_DIR, 'factsGolden.json');
const FLOOR_FILE = join(CORPUS_DIR, 'factsRecallFloor.json');

const KINDS = ['actions', 'ingredients', 'amounts', 'temperatures', 'durations', 'safety'] as const;
type Kind = (typeof KINDS)[number];

interface CorpusRecipe {
    readonly slug: string;
    readonly ingredientGroups: readonly { readonly lines: readonly string[] }[];
    readonly steps: readonly string[];
}

/** What the golden file says about one recipe: the sheet must be refused at `refused`, or hold only the listed facts. */
interface GoldenRecipe extends Record<Kind, readonly string[]> {
    readonly refused?: string;
}

interface Floor {
    readonly recall: Record<Kind, number>;
    readonly refusedMax: number;
}

const UNITS_BEFORE_NAME =
    /^(?:cups?|tbsp|tablespoons?|tsp|teaspoons?|oz|ounces?|lbs?|pounds?|g|kg|ml|l|cans?|packages?|pinch|dash|cloves?|slices?|sticks?|large|medium|small|bunch|sprigs?)\.?$/iu;

/** The food words of an ingredient line: no brackets, no amount or unit, cut at the first comma. */
function nameOf(line: string): string {
    const tokens = (line.replaceAll(/\([^)]*\)/gu, ' ').split(',')[0] ?? '').trim().split(/\s+/u);
    const amount = leadingAmount(tokens.slice(0, 4));
    let rest = amount === undefined ? tokens : tokens.slice(amount.taken);

    if (amount !== undefined && rest.length > 1 && UNITS_BEFORE_NAME.test(rest[0] ?? '')) {
        rest = rest.slice(1);
    }

    if (rest[0]?.toLowerCase() === 'of') {
        rest = rest.slice(1);
    }

    return rest
        .join(' ')
        .replaceAll(/[^\p{L}\p{N} '’.,()&%°+/-]/gu, ' ')
        .trim();
}

const readers: FactsSheetReaders = {
    durations: (text) => {
        const reading = readDuration(text);

        return reading.kind === 'one'
            ? [{ minSeconds: reading.seconds, maxSeconds: reading.highSeconds ?? reading.seconds }]
            : [];
    },
};

/** Every fact of a sheet as a comparable key, per kind: `step:fact`. */
function factsOf(sheet: FactsSheet): Record<Kind, string[]> {
    const facts: Record<Kind, string[]> = {
        actions: [],
        ingredients: [],
        amounts: [],
        temperatures: [],
        durations: [],
        safety: [],
    };

    sheet.steps.forEach((step, index) => {
        facts.actions.push(...step.actions.map((fact) => `${index}:${fact}`));
        facts.ingredients.push(...step.ingredients.map((fact) => `${index}:${fact}`));
        facts.amounts.push(
            ...step.amounts.map(({ quantity, unit, ingredient }) => `${index}:${quantity}|${unit}|${ingredient}`),
        );
        facts.temperatures.push(...step.temperatures.map(({ value, scale }) => `${index}:${value}${scale}`));
        facts.durations.push(
            ...step.durations.map(({ minSeconds, maxSeconds }) => `${index}:${minSeconds}-${maxSeconds}`),
        );
        facts.safety.push(...step.safety.map(({ category, facts: keys }) => `${index}:${category}:${keys.join(',')}`));
    });

    return facts;
}

function readJson<T>(file: string, what: string): T {
    if (!existsSync(file)) {
        throw new Error(`${what} is missing: ${file}. This tier needs the local corpus and never skips.`);
    }

    return JSON.parse(readFileSync(file, 'utf8')) as T;
}

/** The sheet of one recipe, or the field that refused it. */
function sheetOrRefusal(recipe: CorpusRecipe): FactsSheet | { readonly refused: string } {
    const ingredientLines = recipe.ingredientGroups
        .flatMap((group) => group.lines)
        .map((line) => ({ displayText: nameOf(line) }))
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

describe('the facts sheet over the local recipe corpus', () => {
    const recipes = readJson<readonly CorpusRecipe[]>(RECIPES_FILE, 'The recipe corpus');
    const golden = readJson<Record<string, GoldenRecipe>>(GOLDEN_FILE, 'The reviewed golden file');
    const outcomes = recipes.map((recipe) => ({ recipe, outcome: sheetOrRefusal(recipe) }));

    it('has a golden entry for every recipe', () => {
        expect(recipes.filter((recipe) => golden[recipe.slug] === undefined).map((recipe) => recipe.slug)).toEqual([]);
    });

    it('states no fact the golden file does not hold, and refuses exactly the recipes the golden file refuses', () => {
        const wrong: string[] = [];

        for (const { recipe, outcome } of outcomes) {
            const expected = golden[recipe.slug];

            if (expected === undefined) {
                continue;
            }

            if ('refused' in outcome || expected.refused !== undefined) {
                const got = 'refused' in outcome ? outcome.refused : 'not refused';

                if (got !== (expected.refused ?? 'not refused')) {
                    wrong.push(`${recipe.slug}: refused at ${got}, golden says ${expected.refused ?? 'not refused'}`);
                }

                continue;
            }

            const stated = factsOf(outcome);

            for (const kind of KINDS) {
                wrong.push(
                    ...stated[kind]
                        .filter((fact) => !expected[kind].includes(fact))
                        .map((fact) => `${recipe.slug} ${kind} ${fact}`),
                );
            }
        }

        expect(wrong).toEqual([]);
    });

    it('finds at least the share of golden facts it found before, per fact kind, and raises that floor when it finds more', () => {
        const found: Record<Kind, number> = {
            actions: 0,
            ingredients: 0,
            amounts: 0,
            temperatures: 0,
            durations: 0,
            safety: 0,
        };
        const total: Record<Kind, number> = { ...found };
        let refused = 0;

        for (const { recipe, outcome } of outcomes) {
            const expected = golden[recipe.slug];

            if ('refused' in outcome) {
                refused += 1;
            }

            if (expected === undefined || expected.refused !== undefined || 'refused' in outcome) {
                continue;
            }

            const stated = factsOf(outcome);

            for (const kind of KINDS) {
                total[kind] += expected[kind].length;
                found[kind] += expected[kind].filter((fact) => stated[kind].includes(fact)).length;
            }
        }

        const recall = Object.fromEntries(
            KINDS.map((kind) => [kind, total[kind] === 0 ? 1 : found[kind] / total[kind]]),
        ) as Record<Kind, number>;

        console.info(`facts sheet corpus: ${refused} of ${recipes.length} refused, recall`, recall);

        // Required like the golden file: a floor that seeds itself from the run it judges can never fail that run.
        const floor = readJson<Floor>(FLOOR_FILE, 'The recall floor');

        for (const kind of KINDS) {
            expect(recall[kind], `recall of ${kind}`).toBeGreaterThanOrEqual(floor.recall[kind] - 1e-9);
        }

        expect(refused, 'recipes refused').toBeLessThanOrEqual(floor.refusedMax);

        // The floor only rises, and only on request, so a run never changes what the next run is held to.
        if (process.env['UPDATE_FACTS_RECALL_FLOOR'] !== '1') {
            return;
        }

        writeFileSync(
            FLOOR_FILE,
            `${JSON.stringify(
                {
                    recall: Object.fromEntries(KINDS.map((kind) => [kind, Math.max(recall[kind], floor.recall[kind])])),
                    refusedMax: Math.min(refused, floor.refusedMax),
                },
                null,
                2,
            )}\n`,
        );
    });
});
