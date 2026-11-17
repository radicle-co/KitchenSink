/**
 * The facts sheet: everything the step writer is allowed to see (spec 027 FR-035, research R1).
 *
 * The writer sees facts for every recipe, and never step wording. This type is the whole of what the prompt
 * consumes, so a field that is not here cannot reach the model. `buildFactsSheet` (the sheet builder) produces
 * it, `buildStepPrompt` reads it, and the fact check extracts the same shape from the result and compares.
 *
 * Plain readonly data with no behaviour. Quantities, temperatures and durations are numbers. The sheet holds no
 * step text.
 */

/** The seven safety categories of spec 027 FR-041. The one authority: the lexicons and the check import this. */
export const SAFETY_CATEGORIES = [
    'internalTemperature',
    'rawFood',
    'hotOil',
    'pressureCanningFermenting',
    'flameAlcohol',
    'allergen',
    'warning',
] as const;

/** One of the seven safety categories. */
export type SafetyCategory = (typeof SAFETY_CATEGORIES)[number];

/** An amount in canonical form: a quantity and its unit, `null` for a count with no unit. */
export interface FactAmount {
    readonly quantity: number;
    readonly unit: string | null;
}

/** A temperature as the step states it. The check normalises to Celsius, the writer sees the stated scale. */
export interface FactTemperature {
    readonly value: number;
    readonly scale: 'C' | 'F';
}

/** A time as a range in seconds. A single time has `minSeconds` equal to `maxSeconds`. */
export interface FactDuration {
    readonly minSeconds: number;
    readonly maxSeconds: number;
}

/** A safety line: its category and the facts it carries, never its words. */
export interface FactSafety {
    readonly category: SafetyCategory;
    readonly facts: readonly string[];
}

/** The facts of one source step, in the source's order. A step with no facts has empty lists. */
export interface FactsStep {
    /** Verbs from the closed action lexicon. */
    readonly actions: readonly string[];
    readonly amounts: readonly FactAmount[];
    readonly temperatures: readonly FactTemperature[];
    readonly durations: readonly FactDuration[];
    /** Names from the recipe's ingredient lines that the step uses. */
    readonly ingredients: readonly string[];
    /** Items from the closed equipment list. */
    readonly equipment: readonly string[];
    readonly safety: readonly FactSafety[];
}

/** What the writer sees for one recipe. */
export interface FactsSheet {
    /** BCP 47 language of the recipe. The writer answers in it. */
    readonly language: string;
    /** The ingredient-line names of the whole recipe. */
    readonly ingredientNames: readonly string[];
    /** One entry per source step, in order. Indexes in an answer's `covers` point into this list. */
    readonly steps: readonly FactsStep[];
}
