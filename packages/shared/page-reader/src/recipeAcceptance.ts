/**
 * The gate: whether a recipe read from a page is good enough to send, as a plain yes or no.
 *
 * DESIGN PATTERN: **Specification**, a composite of named predicates (G1 to G8 in the table below), with the numbers a
 * predicate compares against held as data per tier in {@link ACCEPTANCE_BY_TIER} (a **Registry**). It is the ONE owner of
 * "is this good enough": a strategy finds candidates and knows nothing of it, and it knows a recipe and the tier that read
 * it, never the page. The verdict is black and white (owner ruling 2026-11-15): there is no review in the middle.
 *
 * | #  | Predicate                                                                                         | Reason                |
 * | -- | ------------------------------------------------------------------------------------------------- | --------------------- |
 * | G1 | the title passes `recipeTitleSchema`                                                              | `titleUnusable`       |
 * | G2 | at least the tier's minimum of ingredient lines                                                   | `noIngredients`       |
 * | G3 | at most `MAX_PARSE_JOB_LINES` lines, each at most `PARSE_JOB_LINE_MAX_CHARS`                      | `tooManyIngredientLines`, `ingredientLineTooLong` |
 * | G4 | no ingredient line over 200 characters, or with two sentence ends, a full stop then an uppercase letter (a blob, or steps in the list)  | `ingredientsNotSeparated` |
 * | G5 | at least one step, each at least 3 characters trimmed                                             | `noSteps`             |
 * | G6 | no step is an amount and a canonical unit in at most 8 words (an ingredient in the method)        | `ingredientsInSteps`  |
 * | G7 | no line is in both the ingredients and the steps (a range read twice)                             | `ingredientsInSteps`  |
 * | G8 | no title, ingredient line or step holds U+FFFD or a C1 control character (U+0080 to U+009F), and none of them is without a letter or digit (`\p{L}`, `\p{N}`) | `garbledText`         |
 * | G9 | no ingredient line is a heading in capitals: no digit, and every cased letter (two at least) a capital | `headingInIngredients` |
 *
 * The first predicate that fails, in table order, is the reason. Every predicate here is language-neutral except G6's unit
 * test, which reads English units: a page it cannot read gives no, never a wrong yes (precision first). The step LIMITS
 * (count and length) stay with the caller's `importRecipeSchema`, which owns those numbers.
 *
 * Only linear whitespace and newline splits run over page text, and no pattern can backtrack: a line is scanned one character
 * at a time.
 */
import { readCooksMeasure } from '@kitchensink/recipe-core/parsing/measure-reader';
import {
    MAX_PARSE_JOB_LINES,
    PARSE_JOB_LINE_MAX_CHARS,
    recipeTitleSchema,
    classifyUnit,
} from '@kitchensink/recipe-core';
import type { ExtractionTier, PageRecipe } from './pageRecipeCandidate.js';
import { folded } from './recipeSelection.js';

/** Why a recipe that was read is still not sent. */
export type AcceptanceReason =
    | 'titleUnusable'
    | 'noIngredients'
    | 'tooManyIngredientLines'
    | 'ingredientLineTooLong'
    | 'ingredientsNotSeparated'
    | 'noSteps'
    | 'ingredientsInSteps'
    | 'garbledText'
    | 'headingInIngredients';

/** The gate's answer. */
export type Acceptance = { readonly ok: true } | { readonly ok: false; readonly reason: AcceptanceReason };

/** The numbers one tier is judged by. */
interface AcceptanceThresholds {
    /** G2. */
    readonly minIngredientLines: number;
}

/** The thresholds per tier. A tier that guesses more than a page's own markup does (the headed page, PR B2) asks for more. */
const ACCEPTANCE_BY_TIER: Readonly<Record<ExtractionTier, AcceptanceThresholds>> = Object.freeze({
    jsonLd: Object.freeze({ minIngredientLines: 1 }),
    microdata: Object.freeze({ minIngredientLines: 1 }),
});

/** G4: the longest an ingredient line may be before it is read as a blob. */
const MAX_INGREDIENT_LINE_CHARS = 200;

/** G4: a line with this many sentence ends is steps, not an ingredient. */
const SENTENCE_ENDS_OF_A_BLOB = 2;

/** G5: the fewest characters, trimmed, a step may have. */
const MIN_STEP_CHARS = 3;

/** G6: the most words an ingredient-shaped step may have; a longer one is a sentence that happens to start with an amount. */
const MAX_INGREDIENT_STEP_WORDS = 8;

/** G6: how far into a step a `:` may be and still end a section label such as "For the glaze". */
const MAX_SECTION_LABEL_CHARS = 40;

/** Whether `char` is an uppercase letter in some script: it changes when lowercased. */
function isUpperCase(char: string): boolean {
    return char !== char.toLowerCase();
}

/**
 * G4: how many times `line` has a full stop, a space, then an uppercase letter. One pass. A digit or a lowercase letter
 * after the stop is no end, so "7 oz. each" and "1/2-in. pieces" and `1.5` end no sentence.
 */
function sentenceEnds(line: string): number {
    let ends = 0;

    for (let index = 0; index < line.length - 2; index += 1) {
        if (line.charAt(index) === '.' && line.charAt(index + 1) === ' ' && isUpperCase(line.charAt(index + 2))) {
            ends += 1;
        }
    }

    return ends;
}

/** A digit in any script. */
const DIGIT = /^\p{N}$/u;

/**
 * G9: whether an ingredient line is a heading in capitals ("CRUMBLE", "FÜR DEN TEIG:"): no digit, no lower-case letter,
 * and at least two capitals. A script with no case has no capitals, so it is never one.
 */
function isCapitalsHeading(line: string): boolean {
    let capitals = 0;

    for (const char of line) {
        if (DIGIT.test(char) || (char !== char.toUpperCase() && char === char.toLowerCase())) {
            return false;
        }

        capitals += char !== char.toLowerCase() ? 1 : 0;
    }

    return capitals >= 2;
}

/** G8: whether `text` holds U+FFFD (a decoder's replacement) or a C1 control character (U+0080 to U+009F). One pass. */
function isGarbled(text: string): boolean {
    for (let index = 0; index < text.length; index += 1) {
        const code = text.charCodeAt(index);

        if (code === 0xfffd || (code >= 0x80 && code <= 0x9f)) {
            return true;
        }
    }

    return false;
}

/** A letter or a digit in any script. One character class, so the test is linear and cannot backtrack. */
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/** G8: whether `text` has no letter or digit in it ("***", a zero-width space, emoji alone): nothing a cook can read. */
const hasNoLetterOrDigit = (text: string): boolean => !LETTER_OR_DIGIT.test(text);

/** A step without its section label ("For the glaze: 1 cup sugar" → "1 cup sugar"). */
function withoutSectionLabel(step: string): string {
    const colon = step.indexOf(':');

    return colon > 0 && colon <= MAX_SECTION_LABEL_CHARS ? step.slice(colon + 1) : step;
}

/** G6: whether a step reads as an ingredient: an amount, then a canonical unit, in a few words. */
function isIngredientStep(step: string): boolean {
    const text = withoutSectionLabel(step).trim();

    if (text.split(/\s+/u).length > MAX_INGREDIENT_STEP_WORDS) {
        return false;
    }

    const { quantity, words } = readCooksMeasure(text);

    return quantity.kind !== 'absent' && classifyUnit(words.split(' ')[0] ?? '') === 'canonical';
}

/** What the gate's predicates look at: the recipe, its steps trimmed, and the thresholds of the tier that read it. */
interface Judged {
    readonly recipe: PageRecipe;
    readonly steps: readonly string[];
    readonly stepSet: ReadonlySet<string>;
    readonly minIngredientLines: number;
}

/** One predicate of the gate: the reason it gives when it fails, and whether it does. */
interface Predicate {
    readonly reason: AcceptanceReason;
    readonly fails: (judged: Judged) => boolean;
}

/** G1 to G8, in the table's order: the first that fails is the reason. */
const PREDICATES: readonly Predicate[] = [
    { reason: 'titleUnusable', fails: ({ recipe }) => !recipeTitleSchema.safeParse(recipe.title).success },
    {
        reason: 'noIngredients',
        fails: ({ recipe, minIngredientLines }) => recipe.ingredientLines.length < minIngredientLines,
    },
    {
        reason: 'tooManyIngredientLines',
        fails: ({ recipe }) => recipe.ingredientLines.length > MAX_PARSE_JOB_LINES,
    },
    {
        reason: 'ingredientLineTooLong',
        fails: ({ recipe }) => recipe.ingredientLines.some((line) => line.length > PARSE_JOB_LINE_MAX_CHARS),
    },
    {
        reason: 'ingredientsNotSeparated',
        fails: ({ recipe }) =>
            recipe.ingredientLines.some(
                (line) => line.length > MAX_INGREDIENT_LINE_CHARS || sentenceEnds(line) >= SENTENCE_ENDS_OF_A_BLOB,
            ),
    },
    {
        reason: 'noSteps',
        fails: ({ steps }) => steps.length === 0 || steps.some((step) => step.length < MIN_STEP_CHARS),
    },
    {
        reason: 'ingredientsInSteps',
        fails: ({ recipe, steps, stepSet }) =>
            steps.some(isIngredientStep) || recipe.ingredientLines.some((line) => stepSet.has(folded(line))),
    },
    {
        reason: 'garbledText',
        fails: ({ recipe, steps }) =>
            [recipe.title, ...recipe.ingredientLines, ...steps].some(isGarbled) ||
            [recipe.title, ...recipe.ingredientLines, ...steps].some(hasNoLetterOrDigit),
    },
    {
        reason: 'headingInIngredients',
        fails: ({ recipe }) => recipe.ingredientLines.some(isCapitalsHeading),
    },
];

/**
 * Judge a recipe read from a page.
 *
 * @param recipe - The recipe a strategy read.
 * @param tier - Which strategy read it, which sets the thresholds.
 * @returns `{ ok: true }`, or `{ ok: false, reason }` for the first predicate it fails. Pure.
 */
export function acceptRecipe(recipe: PageRecipe, tier: ExtractionTier): Acceptance {
    const steps = recipe.steps.map((step) => step.instruction.trim());
    const judged: Judged = {
        recipe,
        steps,
        stepSet: new Set(steps.map(folded)),
        minIngredientLines: ACCEPTANCE_BY_TIER[tier].minIngredientLines,
    };
    const failed = PREDICATES.find((predicate) => predicate.fails(judged));

    return failed === undefined ? { ok: true } : { ok: false, reason: failed.reason };
}
