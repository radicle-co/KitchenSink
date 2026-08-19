/**
 * Hand-checked expected output for the committed corpus slice in
 * `internationalJewishCookBook.txt` (Project Gutenberg #12350, public domain).
 *
 * Every `phrase` below was read out of that file by a human and is asserted to occur VERBATIM in the
 * committed slice before it is parsed — so this golden cannot quietly drift into fiction the way a
 * golden regenerated from the implementation would. The expected values are what the source text
 * SAYS, not what any library was observed to return.
 *
 * The slice is 1919 cookbook prose, which is exactly why it is the corpus: every quantity in it is
 * written in number WORDS, the notation `parse-ingredient` alone cannot read.
 */

/** One hand-checked ingredient phrase and the parse the source text calls for. */
export interface GoldenIngredient {
    /** The phrase as it appears in the committed corpus slice, joined across its source line break. */
    readonly phrase: string;
    readonly quantity: number | null;
    readonly unit: string | null;
    readonly name: string;
    readonly needsReview: boolean;
}

/** One hand-checked duration phrase and the integer minutes the source text calls for. */
export interface GoldenDuration {
    readonly phrase: string;
    readonly minutes: number | undefined;
    readonly needsReview: boolean;
}

/** One hand-checked yield phrase and the servings count the source text calls for. */
export interface GoldenServings {
    readonly phrase: string;
    readonly servings: number | undefined;
    readonly needsReview: boolean;
}

/** Ingredient phrases from SPICE CAKE, GREEN TREE LAYER CAKE, EGGLESS CAKE, APPLE JELLY CAKE, CREAM PUFFS. */
export const GOLDEN_INGREDIENTS: readonly GoldenIngredient[] = [
    // SPICE CAKE
    { phrase: 'one cup of brown sugar', quantity: 1, unit: 'cup', name: 'brown sugar', needsReview: false },
    { phrase: 'one-half cup of butter', quantity: 0.5, unit: 'cup', name: 'butter', needsReview: false },
    {
        phrase: 'one-half teaspoon of ground cloves',
        quantity: 0.5,
        unit: 'teaspoon',
        name: 'ground cloves',
        needsReview: false,
    },
    { phrase: 'one cup of sour milk', quantity: 1, unit: 'cup', name: 'sour milk', needsReview: false },
    { phrase: 'one teaspoon of baking-soda', quantity: 1, unit: 'teaspoon', name: 'baking-soda', needsReview: false },
    { phrase: 'two cups of flour', quantity: 2, unit: 'cup', name: 'flour', needsReview: false },
    { phrase: 'one cup of raisins chopped', quantity: 1, unit: 'cup', name: 'raisins chopped', needsReview: false },

    // GREEN TREE LAYER CAKE AND ICING
    {
        phrase: 'One cup of granulated sugar',
        quantity: 1,
        unit: 'cup',
        name: 'granulated sugar',
        needsReview: false,
    },
    { phrase: 'three eggs', quantity: 3, unit: null, name: 'eggs', needsReview: false },
    {
        phrase: 'two and one-half scant cups of sifted flour',
        quantity: 2.5,
        unit: null,
        name: 'scant cups of sifted flour',
        needsReview: false,
    },
    {
        phrase: 'one teaspoon of\nvanilla extract',
        quantity: 1,
        unit: 'teaspoon',
        name: 'vanilla extract',
        needsReview: false,
    },
    {
        phrase: 'two teaspoons of baking-powder',
        quantity: 2,
        unit: 'teaspoon',
        name: 'baking-powder',
        needsReview: false,
    },
    { phrase: 'two tablespoons of\ncocoa', quantity: 2, unit: 'tablespoon', name: 'cocoa', needsReview: false },
    { phrase: 'one teaspoon of vanilla', quantity: 1, unit: 'teaspoon', name: 'vanilla', needsReview: false },

    // EGGLESS, BUTTERLESS, MILKLESS CAKE
    {
        phrase: 'One package of seeded raisins',
        quantity: 1,
        unit: 'package',
        name: 'seeded raisins',
        needsReview: false,
    },
    { phrase: 'two cups of sugar', quantity: 2, unit: 'cup', name: 'sugar', needsReview: false },
    { phrase: 'one teaspoon of cinnamon', quantity: 1, unit: 'teaspoon', name: 'cinnamon', needsReview: false },
    { phrase: 'one teaspoon of cloves', quantity: 1, unit: 'teaspoon', name: 'cloves', needsReview: false },
    { phrase: 'two tablespoons\nof Crisco', quantity: 2, unit: 'tablespoon', name: 'Crisco', needsReview: false },
    {
        phrase: 'one-half teaspoon of\nsalt',
        quantity: 0.5,
        unit: 'teaspoon',
        name: 'salt',
        needsReview: false,
    },
    { phrase: 'three cups of flour', quantity: 3, unit: 'cup', name: 'flour', needsReview: false },

    // APPLE JELLY CAKE
    { phrase: 'four eggs', quantity: 4, unit: null, name: 'eggs', needsReview: false },
    { phrase: 'one cup of milk', quantity: 1, unit: 'cup', name: 'milk', needsReview: false },
    { phrase: 'three large apples', quantity: 3, unit: 'large', name: 'apples', needsReview: false },
    { phrase: 'one cup of sugar', quantity: 1, unit: 'cup', name: 'sugar', needsReview: false },

    // CREAM PUFFS
    { phrase: 'One cup of hot water', quantity: 1, unit: 'cup', name: 'hot water', needsReview: false },
    { phrase: 'one cup of sifted flour dry', quantity: 1, unit: 'cup', name: 'sifted flour dry', needsReview: false },
    { phrase: 'three eggs unbeaten', quantity: 3, unit: null, name: 'eggs unbeaten', needsReview: false },
    { phrase: 'one egg', quantity: 1, unit: null, name: 'egg', needsReview: false },
    { phrase: 'three\ntablespoons of flour', quantity: 3, unit: 'tablespoon', name: 'flour', needsReview: false },

    // Prose that is NOT an ingredient line. The import must preserve and flag these, never invent a
    // quantity for them -- this is the FR-020 half that a happy-path corpus would never exercise.
    { phrase: 'vanilla to flavor', quantity: null, unit: null, name: 'vanilla to flavor', needsReview: true },
    {
        phrase: 'a little of\nthe flour',
        quantity: null,
        unit: null,
        name: 'a little of the flour',
        needsReview: true,
    },
    {
        phrase: 'butter the size of a large egg',
        quantity: null,
        unit: null,
        name: 'butter the size of a large egg',
        needsReview: true,
    },
    {
        phrase: 'Cool and fill in cake.',
        quantity: null,
        unit: null,
        name: 'Cool and fill in cake.',
        needsReview: true,
    },
];

/** Duration phrases that appear verbatim in the slice. */
export const GOLDEN_DURATIONS: readonly GoldenDuration[] = [
    { phrase: 'three-quarters of an hour', minutes: 45, needsReview: false },
    { phrase: 'five minutes', minutes: 5, needsReview: false },
    { phrase: 'forty-five minutes', minutes: 45, needsReview: false },
    { phrase: 'twenty-five minutes', minutes: 25, needsReview: false },
    // Prose the source offers instead of a time. FR-021: leave empty, flag, never substitute.
    { phrase: 'until thick', minutes: undefined, needsReview: true },
    { phrase: 'for a long while', minutes: undefined, needsReview: true },
];

/** Yield phrases that appear verbatim in the slice. */
export const GOLDEN_SERVINGS: readonly GoldenServings[] = [
    { phrase: 'twelve puffs', servings: 12, needsReview: false },
    { phrase: 'two cakes in layer pans', servings: 2, needsReview: false },
];
