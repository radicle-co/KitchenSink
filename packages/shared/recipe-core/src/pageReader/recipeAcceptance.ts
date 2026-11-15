/**
 * The gate: whether a recipe read from a page is good enough to send, as a plain yes or no.
 *
 * DESIGN PATTERN: **Specification**, a composite of named predicates (G1 to G7 in the table below), with the numbers a
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
 *
 * The first predicate that fails, in table order, is the reason. Every predicate here is language-neutral except G6's unit
 * test, which reads English units: a page it cannot read gives no, never a wrong yes (precision first). The step LIMITS
 * (count and length) stay with the caller's `importRecipeSchema`, which owns those numbers.
 *
 * No regular expression runs over page text: a line is scanned one character at a time, in linear time.
 */
import { readCooksMeasure } from '../parsing/measureReader.js';
import { MAX_PARSE_JOB_LINES, PARSE_JOB_LINE_MAX_CHARS } from '../parsing/parseJobText.js';
import { recipeTitleSchema } from '../recipeRequestBounds.js';
import { classifyUnit } from '../units.js';
import type { ExtractionTier, PageRecipe } from './pageRecipeCandidate.js';

/** Why a recipe that was read is still not sent. */
export type AcceptanceReason =
    | 'titleUnusable'
    | 'noIngredients'
    | 'tooManyIngredientLines'
    | 'ingredientLineTooLong'
    | 'ingredientsNotSeparated'
    | 'noSteps'
    | 'ingredientsInSteps';

/** The gate's answer. */
export type Acceptance = { readonly ok: true } | { readonly ok: false; readonly reason: AcceptanceReason };

/** The numbers one tier is judged by. */
interface AcceptanceThresholds {
    /** G2. */
    readonly minIngredientLines: number;
}

/** The thresholds per tier. A tier that guesses more than a page's own markup does (the headed page, PR B2) asks for more. */
export const ACCEPTANCE_BY_TIER: Readonly<Record<ExtractionTier, AcceptanceThresholds>> = Object.freeze({
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

/** Case and whitespace folded, so two writings of one line compare equal (G7). */
function foldedLine(text: string): string {
    return text.trim().split(/\s+/u).join(' ').toLowerCase();
}

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

/** Whether a G3 to G4 line failure applies, in table order, to `lines`. */
function lineRefusal(lines: readonly string[]): AcceptanceReason | undefined {
    if (lines.length > MAX_PARSE_JOB_LINES) {
        return 'tooManyIngredientLines';
    }

    if (lines.some((line) => line.length > PARSE_JOB_LINE_MAX_CHARS)) {
        return 'ingredientLineTooLong';
    }

    return lines.some(
        (line) => line.length > MAX_INGREDIENT_LINE_CHARS || sentenceEnds(line) >= SENTENCE_ENDS_OF_A_BLOB,
    )
        ? 'ingredientsNotSeparated'
        : undefined;
}

/**
 * Judge a recipe read from a page.
 *
 * @param recipe - The recipe a strategy read.
 * @param tier - Which strategy read it, which sets the thresholds.
 * @returns `{ ok: true }`, or `{ ok: false, reason }` for the first predicate it fails. Pure.
 */
export function acceptRecipe(recipe: PageRecipe, tier: ExtractionTier): Acceptance {
    const { minIngredientLines } = ACCEPTANCE_BY_TIER[tier];
    const steps = recipe.steps.map((step) => step.instruction.trim());
    const stepSet = new Set(steps.map(foldedLine));
    const reason: AcceptanceReason | undefined = !recipeTitleSchema.safeParse(recipe.title).success
        ? 'titleUnusable'
        : recipe.ingredientLines.length < minIngredientLines
          ? 'noIngredients'
          : (lineRefusal(recipe.ingredientLines) ??
            (steps.length === 0 || steps.some((step) => step.length < MIN_STEP_CHARS)
                ? 'noSteps'
                : steps.some(isIngredientStep) || recipe.ingredientLines.some((line) => stepSet.has(foldedLine(line)))
                  ? 'ingredientsInSteps'
                  : undefined));

    return reason === undefined ? { ok: true } : { ok: false, reason };
}
