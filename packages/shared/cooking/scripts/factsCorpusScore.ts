/**
 * The scoring behind `scripts/factsSheetCorpus.ts`, kept pure so it is unit tested without the corpus.
 *
 * Two promises are scored. Precision: every fact the sheet states is in the golden entry, and a refusal matches the
 * golden refusal. Recall, per fact kind: the share of golden facts the sheet found, held to a floor that only rises.
 */
import { leadingAmount } from '@kitchensink/recipe-core/parsing/measure-reader';
import type { FactsSheet } from '@kitchensink/recipe-core/step-writing/facts-sheet-types';

export const KINDS = ['actions', 'ingredients', 'amounts', 'temperatures', 'durations', 'safety'] as const;
export type Kind = (typeof KINDS)[number];

/** What the golden file says about one recipe: the sheet is refused at `refused`, or holds only the listed facts. */
export interface GoldenRecipe extends Record<Kind, readonly string[]> {
    readonly refused?: string;
}

/** The lowest recall per kind and the most refused recipes a run may show. */
export interface Floor {
    readonly recall: Record<Kind, number>;
    readonly refusedMax: number;
}

export type Refusal = { readonly refused: string };

/** One recipe's result, with the golden entry that judges it. */
export interface Scored {
    readonly outcome: FactsSheet | Refusal;
    readonly expected: GoldenRecipe;
}

const FLOOR_EPSILON = 1e-9;

/** Every fact of a sheet as a comparable key, per kind: `step:fact`. Pure. */
export function factsOf(sheet: FactsSheet): Record<Kind, string[]> {
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

/** Whether the outcome is a refusal. Pure. */
export const isRefusal = (outcome: FactsSheet | Refusal): outcome is Refusal => 'refused' in outcome;

/**
 * What is wrong with one recipe's result: a stated fact the golden entry lacks, or a refusal that differs from the
 * golden one. Empty when the result is right. Pure.
 */
export function precisionFaults(slug: string, outcome: FactsSheet | Refusal, expected: GoldenRecipe): string[] {
    if (isRefusal(outcome) || expected.refused !== undefined) {
        const got = isRefusal(outcome) ? outcome.refused : 'not refused';
        const want = expected.refused ?? 'not refused';

        return got === want ? [] : [`${slug}: refused at ${got}, golden says ${want}`];
    }

    const stated = factsOf(outcome);

    return KINDS.flatMap((kind) =>
        stated[kind].filter((fact) => !expected[kind].includes(fact)).map((fact) => `${slug} ${kind} ${fact}`),
    );
}

/** The share of golden facts found per kind, over the recipes neither side refused. A kind with no facts reads 1. Pure. */
export function recallOf(results: readonly Scored[]): Record<Kind, number> {
    const found: Record<Kind, number> = {
        actions: 0,
        ingredients: 0,
        amounts: 0,
        temperatures: 0,
        durations: 0,
        safety: 0,
    };
    const total: Record<Kind, number> = { ...found };

    for (const { outcome, expected } of results) {
        if (isRefusal(outcome) || expected.refused !== undefined) {
            continue;
        }

        const stated = factsOf(outcome);

        for (const kind of KINDS) {
            total[kind] += expected[kind].length;
            found[kind] += expected[kind].filter((fact) => stated[kind].includes(fact)).length;
        }
    }

    return Object.fromEntries(KINDS.map((kind) => [kind, total[kind] === 0 ? 1 : found[kind] / total[kind]])) as Record<
        Kind,
        number
    >;
}

/** What a run breaks of the floor: a kind below its floor, and more refusals than the ceiling. Pure. */
export function floorFaults(recall: Record<Kind, number>, refused: number, floor: Floor): string[] {
    const low = KINDS.filter((kind) => recall[kind] < floor.recall[kind] - FLOOR_EPSILON).map(
        (kind) => `recall of ${kind} is ${recall[kind]}, below the floor ${floor.recall[kind]}`,
    );

    return refused > floor.refusedMax
        ? [...low, `recipes refused: ${refused}, more than the ceiling ${floor.refusedMax}`]
        : low;
}

/** The floor after a run: each recall floor only rises, and the refusal ceiling only falls. Pure. */
export function raisedFloor(recall: Record<Kind, number>, refused: number, floor: Floor): Floor {
    return {
        recall: Object.fromEntries(KINDS.map((kind) => [kind, Math.max(recall[kind], floor.recall[kind])])) as Record<
            Kind,
            number
        >,
        refusedMax: Math.min(refused, floor.refusedMax),
    };
}

const UNITS_BEFORE_NAME =
    /^(?:cups?|tbsp|tablespoons?|tsp|teaspoons?|oz|ounces?|lbs?|pounds?|g|kg|ml|l|cans?|packages?|pinch|dash|cloves?|slices?|sticks?|large|medium|small|bunch|sprigs?)\.?$/iu;

/**
 * The food words of an ingredient line: no brackets, no amount or unit, cut at the first comma. It stands in for the
 * parse the app does, and it is as good as this rule. Pure.
 */
export function ingredientNameOf(line: string): string {
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
