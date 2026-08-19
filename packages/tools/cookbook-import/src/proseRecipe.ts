/**
 * The prose → candidate-recipe MAPPER: what a block of 1900s cookery prose means, and whether it is a
 * recipe at all.
 *
 * DESIGN PATTERN: **Pipeline of pure stages** over `@kitchensink/recipe-import-core`'s normalizers, ending
 * in an explicit **accept-or-skip-with-a-reason** outcome (a discriminated union, so a skipped block cannot
 * be read as a recipe with empty fields).
 *
 * ## The hard problem, and how it is solved without a second vocabulary
 *
 * These books embed ingredients in sentences — "_put in kettle with one pound of fat brisket of beef_" —
 * so the quantity is frequently NOT at the head of its clause. Locating it needs to know which words are
 * numbers, and that lexicon already has exactly one owner: `recipe-import-core`'s `quantityWords.ts`.
 * Restating it here would be a second representation of the same knowledge, drifting silently.
 *
 * So this module never asks "where is the quantity?". It splits the prose into clauses and then tries
 * `parseIngredientLine` on each successively-shorter SUFFIX of a clause, keeping the LEFTMOST suffix that
 * yields both a quantity and a unit. The parser stays the only thing that knows what a number word is; the
 * cost is a bounded handful of pure calls per clause.
 *
 * ## ⛔ Nothing here fabricates a value
 *
 * A quantity, a duration and a yield are READ FROM THE TEXT or they are absent, and an absent one causes a
 * SKIP rather than a plausible default (HAZ-040). The single exception is `servings`, which the shipped
 * schema requires and these books almost never state — see {@link UNSTATED_SERVINGS}, where the choice is
 * argued and disclosed to the reader rather than hidden.
 */
import {
    normalizeDurationToMinutes,
    normalizeQuantity,
    parseIngredientLine,
    type ParsedIngredientLine,
} from '@kitchensink/recipe-import-core';

import type { CookbookBlock } from './gutenbergBook.adapter.js';

/**
 * The serving count written when the source states none.
 *
 * ⚠️ THE ONE SUPPLIED NUMBER IN THIS MODULE, AND IT IS NOT A FABRICATION — it is the only value that keeps
 * the shipped feature honest. `recipes.servings` is `NOT NULL` with no "unknown" state, so something must
 * be written; and `scaleRecipe` scales every quantity by `chosen / authored`. With `1`, the stored
 * quantities are exactly the printed ones and asking for 2 servings doubles them — both true statements.
 * With any other value, every printed quantity is silently rescaled by a ratio nobody measured. The
 * substitution is stated in the recipe's own description, so a reader is told rather than misled.
 */
const UNSTATED_SERVINGS = 1;

/** Fewest quantified ingredient lines a block must yield to be worth importing. */
const MIN_INGREDIENTS = 3;

/** Fewest instruction steps a block must yield. */
const MIN_STEPS = 2;

/** Shortest body worth attempting, in characters. Below this a "recipe" is a cross-reference or a note. */
const MIN_BODY_LENGTH = 200;

/** Most leading words the suffix scan will drop while hunting for a quantity inside one clause. */
const MAX_SUFFIX_SKIP = 8;

/** Longest ingredient name kept; the wire caps it at 120 and a longer span is runaway prose, not a name. */
const MAX_NAME_LENGTH = 60;

/**
 * Function words a sentence can leave stranded at either end of an extracted name.
 *
 * ⚠️ This is GRAMMAR, deliberately — articles, prepositions and the participles these recipes attach to a
 * verb — and NOT a list of culinary words. Nothing that names or describes a food appears here: removing
 * "sifted" from "sifted flour" would be rewriting the ingredient to find a friendlier catalog match, which
 * is exactly the massaging that would corrupt the resolution measurement. "the" and "when" are not
 * ingredients in any book.
 */
/**
 * Single words that are a COOKING METHOD, never a food.
 *
 * Applied only when the extracted name is exactly one of these — "chopped onion" is a perfectly good
 * ingredient, "chopped" alone is not. Like {@link LEADING_NOISE} this is grammar rather than culinary
 * vocabulary: it removes verbs, never foods, so it cannot be used to nudge a name toward a catalog match.
 */
const NOT_A_MEASURE = new Set([
    'inch',
    'inches',
    'inche',
    'foot',
    'feet',
    'degree',
    'degrees',
    'minute',
    'minutes',
    'hour',
    'hours',
    'day',
    'days',
    'week',
    'weeks',
    'year',
    'years',
    'time',
    'times',
    'person',
    'persons',
    'people',
]);

/**
 * Words that describe a SHAPE or a DIMENSION, never a food.
 *
 * Paired with {@link NOT_A_MEASURE} above, and both exist because of a defect observed in a live trial run:
 * "_cut in slices one-quarter inch thick_" parsed as `0.25 inch :: thick`, and "_two inches square_" as
 * `2 inche :: square`. Both were then sent to the catalog lookup, matched something, and landed on a PUBLIC
 * recipe carrying a real `food_id` — a nutrition claim derived from a measurement of a knife cut.
 *
 * ⚠️ This is the asymmetric-cost rule in action: a dropped line costs one missing ingredient, while a wrong
 * `food_id` is a silent, plausible-looking lie in a public recipe's nutrition. It is also NOT
 * match-flattering — it removes things that are not ingredients at all, rather than rewriting an ingredient
 * name to find a friendlier hit.
 */
const NOT_AN_INGREDIENT = new Set([
    'thick',
    'thin',
    'square',
    'round',
    'deep',
    'long',
    'wide',
    'high',
    'apart',
    'across',
    'each',
    'cut',
    'cut in dice',
    'chopped',
    'mixed',
    'boiled',
    'melted',
    'sifted',
    'beaten',
    'fried',
    'baked',
    'grated',
    'washed',
    'peeled',
    'drained',
    'cooked',
    'served',
    'stirred',
    'strained',
    'seasoned',
    'made',
    'taken',
    'added',
    'put',
]);

const LEADING_NOISE = new Set([
    'a',
    'an',
    'the',
    'of',
    'when',
    'some',
    'more',
    'little',
    'few',
    'good',
    'enough',
    'other',
    'same',
    'each',
    'this',
    'that',
    'it',
    'them',
    'is',
    'are',
    'be',
    'been',
    'to',
    'and',
]);

/** Why a block was not imported. Every value is reportable to a human without further lookup. */
export type RecipeSkipReason = 'no_body' | 'too_few_ingredients' | 'too_few_steps' | 'no_stated_duration';

/** A recipe parsed out of prose, ready to be turned into a create request. */
export interface CandidateRecipe {
    /** The book's heading, presented as a name rather than as shouting. */
    readonly title: string;
    /** Provenance-honest prose shown to the reader; discloses anything the source did not state. */
    readonly description: string;
    /** The quantified ingredient lines, in the order the prose introduced them. */
    readonly ingredients: readonly ParsedIngredientLine[];
    /** The instruction steps, in order. */
    readonly steps: readonly string[];
    /** The longest duration the text actually states. */
    readonly cookTimeMinutes: number;
    /** Always 0: these books never state preparation time, and 0 is not a claim that there is none. */
    readonly prepTimeMinutes: number;
    /** Equal to {@link cookTimeMinutes} while prep is unknown. */
    readonly totalTimeMinutes: number;
    /** The stated yield, or {@link UNSTATED_SERVINGS}. */
    readonly servings: number;
    /** Whether {@link servings} was read from the text. `false` means the description discloses it. */
    readonly servingsStated: boolean;
}

/** Accept-with-a-recipe, or skip-with-a-reason. A skip can never be misread as an empty recipe. */
export type RecipeCandidateOutcome =
    | {
          readonly kind: 'candidate';
          readonly recipe: CandidateRecipe;
          /** Source clauses that named something but carried no usable quantity — reported VERBATIM. */
          readonly droppedLines: readonly string[];
      }
    | { readonly kind: 'skipped'; readonly title: string; readonly reason: RecipeSkipReason };

/**
 * Clause boundaries.
 *
 * ⚠️ Splitting on a bare ` and ` is load-bearing, not over-eager. These books chain several ingredients
 * into ONE punctuation-free clause — "_Cut one large beet AND one-half pound of onion in thick pieces AND
 * put in kettle with one pound of fat brisket of beef_" is three ingredients in one breath — and a scan
 * that only ever finds the leftmost quantity per clause would import that recipe with a third of its
 * ingredients. A fragment that turns out to be an instruction simply yields no ingredient and costs
 * nothing.
 */
const CLAUSE_SPLIT = /[;.]|,\s*(?:and\s+)?|\s+and\s+(?:then\s+)?/;

/**
 * Step boundary: a period OR a semicolon.
 *
 * ⚠️ The semicolon is not optional. These recipes are frequently ONE sentence whose stages are separated by
 * semicolons — "_…cover with water and let cook slowly two hours; add three-fourths of a cup of sugar…_" —
 * and requiring a full stop would collapse a four-stage method into a single unusable step.
 */
const SENTENCE_SPLIT = /(?<=[.;])\s+/;

/** Durations as these books state them, e.g. "two hours", "twenty minutes", "1 1/2 hours", "half an hour". */
const DURATION =
    /\b(?:\d+(?:\s+\d+\/\d+)?(?:\s*(?:to|or|-)\s*\d+)?|[a-z-]+(?:[- ]and[- ](?:an?[- ])?half)?)\s+(?:minutes?|hours?)\b/gi;

/** A stated yield, e.g. "serves six", "for six persons", "enough for twelve", "sufficient for four". */
const YIELD =
    /\b(?:serves?|makes|sufficient\s+for|enough\s+for|will\s+serve)\s+(?:about\s+)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve)\b|\bfor\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve)\s+(?:persons?|people|servings?)\b/i;

/** Small-integer words a stated yield may use. */
const YIELD_WORDS: Readonly<Record<string, number>> = Object.freeze({
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    twelve: 12,
});

/**
 * Present an ALL-CAPS heading as a name.
 *
 * This is presentation of the SAME title, not a rewrite of it: the words, their order and their
 * punctuation are untouched. Small connecting words stay lower-case except in first position, which is
 * ordinary English title case.
 *
 * @param heading - The heading as printed.
 * @returns The title-cased name. Pure.
 */
export function toDisplayTitle(heading: string): string {
    const minor = new Set(['a', 'an', 'and', 'in', 'of', 'or', 'the', 'with', 'to', 'for', 'on']);

    return heading
        .toLowerCase()
        .split(/(\s+|-{2,}|\(|\))/)
        .map((token, index) => {
            if (!/[a-z]/.test(token)) {
                return token;
            }

            return index > 0 && minor.has(token) ? token : token.charAt(0).toUpperCase() + token.slice(1);
        })
        .join('')
        .trim();
}

/**
 * Read the LONGEST duration the text states, in minutes.
 *
 * The longest rather than the sum: these recipes state overlapping and alternative times ("cook two hours…
 * let cook another hour"), and summing them would claim a total the text does not. The longest single
 * stated period is the one the reader must plan around, and it is a figure the source actually contains.
 *
 * @param text - The whole recipe body.
 * @returns The longest stated duration in minutes, or `undefined` when the text states none. Pure.
 */
function statedCookTimeMinutes(text: string): number | undefined {
    let longest: number | undefined;

    for (const match of text.matchAll(DURATION)) {
        const { minutes } = normalizeDurationToMinutes(match[0]);

        if (minutes !== undefined && (longest === undefined || minutes > longest)) {
            longest = minutes;
        }
    }

    return longest;
}

/**
 * Read a stated yield, if the text gives one.
 *
 * @param text - The whole recipe body.
 * @returns The stated serving count, or `undefined`. Pure.
 */
function statedServings(text: string): number | undefined {
    const match = YIELD.exec(text);
    const captured = match?.[1] ?? match?.[2];

    if (captured === undefined) {
        return undefined;
    }

    const numeric = Number(captured);

    return Number.isFinite(numeric) && numeric > 0 ? numeric : YIELD_WORDS[captured.toLowerCase()];
}

/**
 * Find the ingredient line inside one clause, wherever its quantity happens to sit.
 *
 * Tries the whole clause, then the clause minus its first word, and so on — keeping the LEFTMOST suffix
 * that parses to both a quantity and a unit. Requiring a UNIT is what keeps "cook two hours" and "add
 * three or four potatoes" from being read as ingredients with the numbers they contain.
 *
 * @param clause - One clause of prose.
 * @returns The parsed line, or `undefined` when the clause carries no quantified ingredient. Pure.
 */
function ingredientInClause(clause: string): ParsedIngredientLine | undefined {
    const words = clause.trim().split(/\s+/);

    for (let skip = 0; skip < Math.min(MAX_SUFFIX_SKIP, words.length); skip += 1) {
        const parsed = parseIngredientLine(dropPartitiveOf(words.slice(skip).join(' ')));

        if (
            parsed.quantity !== null &&
            parsed.quantity > 0 &&
            parsed.unit !== null &&
            // A DIMENSION is not a measure of an ingredient. "one-quarter inch thick" describes a knife cut.
            !NOT_A_MEASURE.has(parsed.unit.toLowerCase()) &&
            parsed.name.trim() !== ''
        ) {
            return parsed;
        }
    }

    return undefined;
}

/**
 * Collapse the period PARTITIVE idiom: `three-fourths OF A cup of sugar` → `three-fourths cup of sugar`.
 *
 * These books write a fractional measure as "X of a UNIT of Y", and `parse-ingredient` reads the `of a` as
 * the start of the description — returning a quantity with NO unit and the name `a cup of sugar`. Since the
 * mapper requires a unit (that requirement is what keeps "cook two hours" from being read as an
 * ingredient), the whole line would otherwise be dropped, and this form is common enough in the corpus to
 * cost real ingredients.
 *
 * ⚠️ It rewrites ONLY the connective, and only when the text already begins with a numeral — which is why
 * it runs AFTER {@link normalizeQuantity} has turned the number words into digits. No content word is
 * added, removed or substituted, so this is not the ingredient-name massaging that would corrupt the
 * resolution measurement; the NAME is untouched.
 *
 * @param text - One clause, possibly beginning with a spelled-out quantity.
 * @returns The clause with a leading partitive `of a`/`of an` removed. Pure.
 */
function dropPartitiveOf(text: string): string {
    const { line } = normalizeQuantity(text);

    return line.replace(/^([\d]+(?:[\s/.][\d/.]*)*)\s+of\s+an?\s+/i, '$1 ');
}

/**
 * Trim a parsed name down to the ingredient, dropping the trailing method the sentence ran into.
 *
 * "onion in thick pieces and put in kettle" is one clause of prose, not one ingredient name. Cutting at the
 * first preposition/conjunction keeps the NOUN and discards the instruction, without inventing a word that
 * was not in the source.
 *
 * @param name - The description `parse-ingredient` returned.
 * @returns The trimmed name. Pure.
 */
function trimName(name: string): string {
    const cut = name.split(
        /\s+(?:in|into|with|and|or|that|which|until|then|over|for|from|when|to|on|at|will|has|have|had|is|are|was|were|may|should|must|can)\s+|[,;:(]/,
    )[0];

    // Then drop connectives the sentence left at the FRONT — "when cut", "the stock", "of butter". These are
    // grammar, not the ingredient, and they are what turn a name into something no catalog could match.
    const words = (cut ?? name).replace(/\s+/g, ' ').trim().split(' ');

    while (words.length > 1 && LEADING_NOISE.has(words[0]?.toLowerCase() ?? '')) {
        words.shift();
    }

    while (words.length > 1 && LEADING_NOISE.has(words.at(-1)?.toLowerCase() ?? '')) {
        words.pop();
    }

    return words.join(' ').slice(0, MAX_NAME_LENGTH).trim();
}

/**
 * Map one titled prose block to a candidate recipe, or explain why it is not one.
 *
 * @param block - A block from the Gutenberg adapter.
 * @param attribution - Optional credit woven into the description (the book and author).
 * @returns The candidate plus anything dropped, or a skip carrying a machine-readable reason. Pure.
 */
export function toCandidateRecipe(block: CookbookBlock, attribution?: string): RecipeCandidateOutcome {
    const title = toDisplayTitle(block.title);
    const body = block.paragraphs.join(' ').trim();

    if (block.paragraphs.length === 0 || body.length < MIN_BODY_LENGTH) {
        return { kind: 'skipped', title, reason: 'no_body' };
    }

    const ingredients: ParsedIngredientLine[] = [];
    const droppedLines: string[] = [];
    const seen = new Set<string>();

    for (const clause of body.split(CLAUSE_SPLIT)) {
        const text = (clause ?? '').trim();

        if (text.length < 3) {
            continue;
        }

        const parsed = ingredientInClause(text);

        if (!parsed) {
            // Only clauses that LOOK like they name a quantity are worth reporting as dropped; every other
            // clause is an instruction, and listing those would bury the signal.
            if (/\d|\b(?:a|an|some|little|few)\b/i.test(text)) {
                droppedLines.push(text);
            }

            continue;
        }

        const name = trimName(parsed.name);
        const key = name.toLowerCase();

        if (name === '' || NOT_AN_INGREDIENT.has(key)) {
            // The sentence attached the quantity to a METHOD rather than to a food — "enough carrots to make
            // 4 cups when cut in dice" leaves "cut". Importing that as an ingredient name would put a verb
            // in a public recipe's ingredient list and send a meaningless string to the catalog lookup,
            // corrupting the resolution measurement with input no user would ever type.
            droppedLines.push(text);
            continue;
        }

        if (seen.has(key)) {
            continue;
        }

        seen.add(key);
        ingredients.push({ ...parsed, name });
    }

    if (ingredients.length < MIN_INGREDIENTS) {
        return { kind: 'skipped', title, reason: 'too_few_ingredients' };
    }

    const steps = body
        .split(SENTENCE_SPLIT)
        .map((sentence) => sentence.replace(/\s+/g, ' ').trim())
        .filter((sentence) => sentence.length > 10);

    if (steps.length < MIN_STEPS) {
        return { kind: 'skipped', title, reason: 'too_few_steps' };
    }

    const cookTimeMinutes = statedCookTimeMinutes(body);

    if (cookTimeMinutes === undefined) {
        // ⛔ The refusal that keeps the import honest. `recipes.cook_time_minutes` is NOT NULL, so importing
        // this recipe would mean writing a number the book does not contain.
        return { kind: 'skipped', title, reason: 'no_stated_duration' };
    }

    const stated = statedServings(body);

    return {
        kind: 'candidate',
        droppedLines,
        recipe: {
            title,
            description: buildDescription(attribution, stated !== undefined),
            ingredients,
            steps,
            cookTimeMinutes,
            prepTimeMinutes: 0,
            totalTimeMinutes: cookTimeMinutes,
            servings: stated ?? UNSTATED_SERVINGS,
            servingsStated: stated !== undefined,
        },
    };
}

/**
 * Compose the reader-facing description, disclosing whatever the source did not state.
 *
 * The disclosure is the point. A recipe showing "1 serving, 0 min prep" with no explanation looks like bad
 * data; the same recipe saying the source states neither is an accurate record of a 1900s cookbook.
 *
 * @param attribution - The book credit, when the caller supplied one.
 * @param yieldStated - Whether a serving count was read from the text.
 * @returns The description. Pure.
 */
function buildDescription(attribution: string | undefined, yieldStated: boolean): string {
    const source = attribution === undefined ? 'a public-domain cookbook' : attribution;
    const caveat = yieldStated
        ? 'Preparation time is not stated in the source.'
        : 'The source states no yield, so the quantities are exactly as printed — one batch. Preparation time is not stated either.';

    return `Imported verbatim from ${source}. ${caveat}`;
}
