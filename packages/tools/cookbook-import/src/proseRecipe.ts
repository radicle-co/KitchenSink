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
    corruptsStatedValue,
    dropTrailingInstruction,
    findQuantityPhrases,
    measuresNoSubstance,
    normalizeDurationToMinutes,
    normalizeQuantity,
    parseIngredientLine,
    segmentClause,
    type IngredientReviewReason,
    type ParsedIngredientLine,
} from '@kitchensink/recipe-import-core';

import type { MeasureSystem } from '@kitchensink/recipe-import-core';

import type { Cookbook } from './cookbooks.js';
import type { CookbookBlock } from './gutenbergBook.adapter.js';
import {
    convertHistoricalUnit,
    unitEquivalenceFor,
    type HistoricalUnitConversion,
    type UnitEquivalenceResolver,
} from './unitEquivalence.js';

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

/** Most start positions the suffix scan will try while hunting for a quantity inside one clause. */
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
 *
 * ⛔ Its former neighbour `NOT_A_MEASURE` — the units that measure time, distance or people rather than an
 * amount of food — MOVED to `recipe-import-core`'s `notAFoodLexicon.ts` in U22a's review pass, and is
 * reached here through `measuresNoSubstance`. The segmentation guard needs precisely that vocabulary to
 * tell `for five minutes` (residue, cut it) from `with two eggs` (a food, keep it), and a second copy on
 * this side of the package boundary is the drift the DRY rule exists to prevent. The defect that created
 * it is unchanged and is restated where the words now live.
 */
/**
 * Words that describe a SHAPE or a DIMENSION, never a food.
 *
 * Paired with `measuresNoSubstance`'s word set (now in `recipe-import-core`), and both exist because of a defect observed in a live trial run:
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

/**
 * One accepted ingredient line — the parse, plus R35's marker when a historical unit was restated.
 *
 * DESIGN PATTERN: Value Object, EXTENDING the one the parser produced rather than wrapping it, so a
 * candidate line stays structurally a `ParsedClause` and `toImportedIngredientLine` needs no change.
 *
 * ⛔ `quantity` and `unit` are the values that go ON THE WIRE, so for a restated line they are the
 * CONVERTED ones — and the amount the book actually printed is not lost, it moves into
 * {@link unitConversion}`.stated`. {@link CandidateIngredient.sourceText} is the source's own words either
 * way; `raw` is NOT (see its note below).
 */
export interface CandidateIngredient extends ParsedIngredientLine {
    /**
     * The clause EXACTLY as the book printed it, before this module's own normalization.
     *
     * ⛔ `raw` is not this, despite what an earlier docstring here claimed. `raw` is byte-identical to what
     * `parseIngredientLine` RECEIVED, and `ingredientInClause` runs `dropPartitiveOf` — hence
     * `normalizeQuantity` — first, so `one gill of milk` reaches the parser as `1 gill of milk`. U11's gate
     * verifies our parse against the source line, and handing it a string we produced from that parse is
     * "a gate that reports success by construction" (`recipeIngredientSourceLineSchema`).
     */
    readonly sourceText: string;
    /**
     * Present ONLY when this line's unit was restated from a historical measure (R35).
     *
     * ⚠️ Its PRESENCE is the disclosure, exactly as `RecipeNutrition.rangeDerivedBound`'s is: there is no
     * "not applicable" value, because a directly-stated metric quantity is the absence of this field.
     */
    readonly unitConversion?: HistoricalUnitConversion;
}

/** A recipe parsed out of prose, ready to be turned into a create request. */
export interface CandidateRecipe {
    /** The book's heading, presented as a name rather than as shouting. */
    readonly title: string;
    /** Provenance-honest prose shown to the reader; discloses anything the source did not state. */
    readonly description: string;
    /** The quantified ingredient lines, in the order the prose introduced them. */
    readonly ingredients: readonly CandidateIngredient[];
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
          /**
           * Instruction text cut off the END of an ACCEPTED ingredient line (U22a), in source order.
           *
           * ⚠️ A DIFFERENT list from `droppedLines` above, deliberately. That one means "we could not use
           * this clause at all"; these lines WERE used, minus a tail. Merging them would stop either list
           * meaning anything: a reader could no longer tell a lost ingredient from a trimmed one.
           */
          readonly droppedInstructions: readonly string[];
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
 *
 * ⛔ It is ALSO the word inside `"one and one-half"`, and that cost real quantities: measured 2026-08-21,
 * "_One and one-half cups of confectioner's sugar_" (verbatim in the committed corpus slice) was cut into
 * "One" and "one-half cups of confectioner's sugar" and imported as **0.5 cups**, with `needsReview:
 * false`. The pattern is unchanged — {@link splitClauses} guards the split POINTS instead, so both
 * readings survive. See R29.
 */
const CLAUSE_SPLIT = /[;.]|,\s*(?:and\s+)?|\s+and\s+(?:then\s+)?/g;

/**
 * Split prose into clauses, refusing any boundary that falls inside a quantity phrase (R29).
 *
 * DESIGN PATTERN: the split itself stays a regex; the GUARD is a Scanner
 * ({@link findQuantityPhrases}) that consults `recipe-import-core`'s number grammar. This module holds no
 * number vocabulary of its own and must not — the lexicon has one owner, and a copy here would drift the
 * first time a word is added to it.
 *
 * ⚠️ Guarding the boundary rather than pre-normalising the body is deliberate. Rewriting the quantity
 * phrases to numerals before splitting would work for ingredients and then corrupt `steps`, which is
 * derived from the SAME body: a reader of this verbatim public-domain import would be shown
 * "1 1/2 pounds" where the book printed "one and one-half pounds".
 *
 * @param body - The recipe body, already whitespace-joined.
 * @returns The clauses, separators removed, in source order. Pure.
 */
function splitClauses(body: string): readonly string[] {
    const phrases = findQuantityPhrases(body);
    const clauses: string[] = [];
    let start = 0;

    for (const boundary of body.matchAll(CLAUSE_SPLIT)) {
        const at = boundary.index;

        if (phrases.some((phrase) => at >= phrase.start && at < phrase.end)) {
            continue;
        }

        clauses.push(body.slice(start, at));
        start = at + boundary[0].length;
    }

    clauses.push(body.slice(start));

    return clauses;
}

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
 * What one clause turned out to be.
 *
 * DESIGN PATTERN: explicit outcome (discriminated union), mirroring {@link RecipeCandidateOutcome}. The
 * previous `ParsedIngredientLine | undefined` could not distinguish "this clause is an instruction" from
 * "this clause states a quantity we must not trust", and only the second must ALWAYS be reported — the
 * caller's dropped-line heuristic looks for digits and articles, and "three to two cups of flour" has
 * neither.
 */
type ClauseReading =
    | {
          readonly kind: 'ingredient';
          /**
           * The parse of the BOUNDED span, carrying `instruction_text_dropped` when a tail was cut (U22a).
           *
           * ⛔ Not the parse of the whole suffix. When the segmenter cuts, the suffix is re-parsed from
           * its bounded head, so the name, the quantity and the review reasons all describe the same text
           * `sourceText` reports — a parse of one string beside a transcription of another is exactly the
           * incoherence `sourceLine` exists to prevent.
           */
          readonly line: ParsedIngredientLine;
          /**
           * The instruction text this stage cut off the span, or `null` when it cut nothing.
           *
           * ⛔ Carried so the loss is REPORTABLE and not merely flagged. `sourceText` is now a PREFIX of
           * the clause, so without this the text U22a removes would exist nowhere a reader of the import
           * report could reach — and HAZ-041's control against "line mis-parsed and the original
           * discarded" would be weaker after this unit than before it.
           */
          readonly trailingInstruction: string | null;
          /**
           * The accepted suffix EXACTLY as the book printed it, before `dropPartitiveOf` normalized it.
           *
           * ⛔ Carried because `line.raw` is not the source's words: it is byte-identical to what the parser
           * RECEIVED, and this scanner normalizes first (`one` becomes `1`). U11's gate verifies our parse
           * against this text, so handing it our own normalization would make the check circular.
           */
          readonly sourceText: string;
      }
    | { readonly kind: 'corrupt' }
    | { readonly kind: 'none' };

/**
 * Where the suffix scan is allowed to start reading, in source order.
 *
 * Word starts, PLUS the start of every quantity phrase, MINUS any position strictly inside one. The two
 * adjustments fix opposite halves of the same R29 defect, and both were measured on the committed corpus:
 *
 *  - **Removing mid-phrase starts.** Dropping leading words one at a time walks INTO
 *    "One and one-half", and "one-half cups of confectioner's sugar" parses cleanly to 0.5 — the split
 *    guard's work undone one layer down, by a scan that was only ever meant to skip past verbs.
 *  - **Adding phrase starts.** These books run a heading into the first quantity with no space:
 *    `"*Icing for This Cake.*--One and one-half cups"` makes `*--One` a single whitespace-delimited word,
 *    so a word-boundary scan can only try the whole thing (which does not parse) or the middle of the
 *    number (which parses WRONG). The phrase's own start is the only position that reads it correctly.
 *
 * @param clause - One trimmed clause.
 * @returns Ascending, de-duplicated character offsets. Pure.
 */
function suffixStarts(clause: string): readonly number[] {
    const phrases = findQuantityPhrases(clause);
    const words = [...clause.matchAll(/\S+/g)].map((word) => word.index);
    const candidates = [...new Set([...words, ...phrases.map((phrase) => phrase.start)])].sort(
        (left, right) => left - right,
    );

    return candidates.filter((at) => !phrases.some((phrase) => at > phrase.start && at < phrase.end));
}

/**
 * Find the ingredient line inside one clause, wherever its quantity happens to sit.
 *
 * Tries the whole clause, then the clause minus its first word, and so on — keeping the LEFTMOST suffix
 * that parses to both a quantity and a unit. Requiring a UNIT is what keeps "cook two hours" and "add
 * three or four potatoes" from being read as ingredients with the numbers they contain.
 *
 * ## ⛔ U22a — the chosen suffix is now BOUNDED at the end of its ingredient
 *
 * The scan finds where the span STARTS and always did; nothing here decided where it ENDED, so the end
 * was implicitly the clause's end and both parse engines were handed `one-half pound of onion in thick
 * pieces`. `segmentClause` (`recipe-import-core`) now answers that half, and it is consulted AFTER the
 * gate below rather than before it — but that ordering does NOT make the selection immune, and claiming
 * so would be false. What is preserved is the CANDIDATE LIST: `suffixStarts` is untouched, so R29's
 * phrase-start additions and mid-phrase removals still decide which positions are tried, in which order.
 * What changed is the selection PREDICATE — a start whose span is entirely equipment no longer wins, and
 * a later, shorter start can. Two consequences follow and are tested: a later start can reach R39's
 * corrupt refusal that an earlier one shadowed, and each rejection spends one of
 * {@link MAX_SUFFIX_SKIP}'s attempts.
 *
 * @param clause - One clause of prose.
 * @returns The bounded parse plus anything cut off it, or a refusal. Pure.
 */
function ingredientInClause(clause: string): ClauseReading {
    const trimmed = clause.trim();
    const starts = suffixStarts(trimmed);

    for (const at of starts.slice(0, MAX_SUFFIX_SKIP)) {
        // The book's own words for this suffix, kept before `dropPartitiveOf` rewrites them.
        const sourceText = trimmed.slice(at);
        const parsed = parseIngredientLine(dropPartitiveOf(sourceText));

        // ⛔ R39 — the FIRST reading that misstates a value ends the clause. It cannot be a `continue`:
        // measured 2026-08-21, "Take three to two cups of flour" reads at "three" as
        // `quantity_bounds_inverted` and is correctly refused, and then the very next start, "two cups of
        // flour", parses CLEANLY to exactly 2 with `needsReview: false`. Dropping one word laundered an
        // unreadable range into a certain quantity. A clause whose own reading misstates a value is not an
        // ingredient at any length.
        if (parsed.reviewReasons.some(corruptsStatedValue)) {
            return { kind: 'corrupt' };
        }

        if (!namesAQuantifiedIngredient(parsed)) {
            continue;
        }

        const segment = segmentClause(sourceText);

        if (segment.kind === 'instruction') {
            // Equipment, not a food — `a large preserving kettle` parses to `1 large :: preserving kettle`
            // and clears every gate above. The next, shorter start is tried exactly as for any suffix that
            // does not read as an ingredient; no reason is raised, because nobody meant this to be parsed.
            continue;
        }

        if (segment.trailingInstruction === null) {
            return { kind: 'ingredient', line: parsed, sourceText, trailingInstruction: null };
        }

        const bounded = parseIngredientLine(dropPartitiveOf(segment.span));

        // ⛔ A cut that DESTROYS the reading is refused, and the whole span survives exactly as it did
        // before U22a. The cut exists to remove residue, never to cost a line: a head that no longer
        // states a quantity, a unit and a food is evidence the boundary was wrong, not that the clause was.
        if (bounded.reviewReasons.some(corruptsStatedValue) || !namesAQuantifiedIngredient(bounded)) {
            return { kind: 'ingredient', line: parsed, sourceText, trailingInstruction: null };
        }

        return {
            kind: 'ingredient',
            line: withInstructionDropped(bounded),
            sourceText: segment.span,
            trailingInstruction: segment.trailingInstruction,
        };
    }

    return { kind: 'none' };
}

/**
 * Whether a parse states an amount of a FOOD, as this module has always defined one.
 *
 * Lifted out of {@link ingredientInClause} because U22a asks the same question twice — of the whole
 * suffix, and again of the bounded head — and two copies of a gate is how the two answers drift apart.
 *
 * @param parsed - Any parse.
 * @returns `true` when it names a quantified ingredient. Pure.
 */
function namesAQuantifiedIngredient(parsed: ParsedIngredientLine): boolean {
    return (
        parsed.quantity.kind !== 'absent' &&
        parsed.unit !== null &&
        // A DIMENSION is not a measure of an ingredient. "one-quarter inch thick" describes a knife cut.
        !measuresNoSubstance(parsed.unit) &&
        parsed.name.trim() !== ''
    );
}

/**
 * Record that this stage cut an instruction off the line (U22a).
 *
 * ⚠️ Raised HERE rather than in `recipe-import-core`, for the reason `additional_foods_dropped` is
 * raised by `projectToIngredientLine`: a reason names a loss where the loss HAPPENS. The segmenter
 * returns a value object and has no line to flag; this stage is what decided to keep the head.
 *
 * @param line - The parse of the bounded head.
 * @returns The same parse, carrying the reason. Pure.
 */
function withInstructionDropped(line: ParsedIngredientLine): ParsedIngredientLine {
    const reviewReasons: readonly IngredientReviewReason[] = [...line.reviewReasons, 'instruction_text_dropped'];

    return { ...line, reviewReasons, needsReview: true };
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

    // ⚠️ The repeated group's separator class and its tail must stay DISJOINT. An earlier form ran
    // `(?:[\s/.][\d/.]*)*`, where `/` and `.` belonged to both — so a run of n separators had 2^n parses
    // and a failed match backtracked exponentially (CodeQL `js/redos`; one 200-character paragraph took
    // 81 s). Admitting only digits after the separator makes each iteration consume exactly one
    // separator, which is a single parse and linear time. The language matched is unchanged: a `/` or
    // `.` that sat inside the old tail simply opens the next iteration here.
    return line.replace(/^(\d+(?:[\s/.]\d*)*)\s+of\s+an?\s+/i, '$1 ');
}

/**
 * Trim a parsed name down to the ingredient, dropping the trailing method the sentence ran into.
 *
 * "onion in thick pieces and put in kettle" is one clause of prose, not one ingredient name. Cutting at the
 * first preposition/conjunction keeps the NOUN and discards the instruction, without inventing a word that
 * was not in the source.
 *
 * ⚠️ U22a MOVED the cut lexicon out of this function and into `recipe-import-core`'s `segmentClause`
 * module, which is now its one authority; `dropTrailingInstruction` is the NAME-shaped view of it. The two
 * views differ on purpose: a span's cut is REFUSED when the tail states a second food, because
 * `ParsedLine.foods` has somewhere to put one — a name has exactly one field and nowhere, and a name
 * carrying a measurement (`chocolate in one cup of water`) matches no catalog row at all. So this cut
 * stays unconditional, and it is what still cleans up a span whose own cut was refused.
 *
 * @param name - The description `parse-ingredient` returned.
 * @returns The trimmed name. Pure.
 */
function trimName(name: string): string {
    const cut = dropTrailingInstruction(name);

    // Then drop connectives the sentence left at the FRONT — "when cut", "the stock", "of butter". These are
    // grammar, not the ingredient, and they are what turn a name into something no catalog could match.
    const words = cut.replace(/\s+/g, ' ').trim().split(' ');

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
 * ⚠️ Takes the whole registry ENTRY rather than the attribution string it used to take, because two
 * different parts of this function now need the book: the description needs its credit, and the
 * historical-unit restatement needs its measure system and its own table of weights and measures (R33).
 * Passing the two separately invites a caller to supply one and not the other, which reads as "this book
 * has no measures" — the unknown-origin state R33 says a KNOWN-origin book must never fall into.
 *
 * @param block - A block from the Gutenberg adapter.
 * @param book - The registry entry the block came from. Omitted only by tests that are not exercising
 *   provenance: with no book there is no measure system, so no historical unit is restated and every line
 *   keeps the unit the source printed.
 * @returns The candidate plus anything dropped, or a skip carrying a machine-readable reason. Pure.
 */
export function toCandidateRecipe(block: CookbookBlock, book?: Cookbook): RecipeCandidateOutcome {
    const title = toDisplayTitle(block.title);
    const body = block.paragraphs.join(' ').trim();

    if (block.paragraphs.length === 0 || body.length < MIN_BODY_LENGTH) {
        return { kind: 'skipped', title, reason: 'no_body' };
    }

    const resolveUnit = book === undefined ? null : unitEquivalenceFor(book.measures);
    const ingredients: CandidateIngredient[] = [];
    const droppedLines: string[] = [];
    const droppedInstructions: string[] = [];
    const seen = new Set<string>();

    for (const clause of splitClauses(body)) {
        const text = clause.trim();

        if (text.length < 3) {
            continue;
        }

        const reading = ingredientInClause(text);

        if (reading.kind === 'corrupt') {
            // ALWAYS reported, unlike the heuristic below: a clause we refused BECAUSE it misstates a
            // value is the single most important thing a reader of the report needs to see (R39).
            droppedLines.push(text);
            continue;
        }

        if (reading.kind === 'none') {
            // Only clauses that LOOK like they name a quantity are worth reporting as dropped; every other
            // clause is an instruction, and listing those would bury the signal.
            if (/\d|\b(?:a|an|some|little|few)\b/i.test(text)) {
                droppedLines.push(text);
            }

            continue;
        }

        // The book's own words ride WITH the parse from here on — `restateHistoricalUnit` spreads the line,
        // so attaching it at the source keeps it through the conversion without a second threading.
        const parsed = { ...reading.line, sourceText: reading.sourceText };
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

        if (reading.trailingInstruction !== null) {
            droppedInstructions.push(reading.trailingInstruction);
        }

        ingredients.push(restateHistoricalUnit({ ...parsed, name }, resolveUnit));
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
        droppedInstructions,
        recipe: {
            title,
            description: buildDescription(book?.attribution, stated !== undefined, ingredients),
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
 * Restate one accepted line's historical unit, when this book's measures define one (R32, R35).
 *
 * ⛔ A line the resolver cannot answer for is KEPT, exactly as parsed. "One gill of milk" is a real
 * ingredient with a stated amount, and dropping it would be this module's asymmetric-cost rule applied
 * backwards: that rule refuses to assert a WRONG number, not to carry a right one in an old unit. The
 * consequence of keeping it is only that the food service finds no household portion named `gill`, so the
 * line contributes no nutrition — which `RecipeNutrition.isComplete` already discloses.
 *
 * @param line - One accepted, named ingredient line.
 * @param resolveUnit - The book's equivalence port, or `null` when no book was supplied.
 * @returns The line, restated and marked, or unchanged. Pure.
 */
function restateHistoricalUnit(
    line: CandidateIngredient,
    resolveUnit: UnitEquivalenceResolver | null,
): CandidateIngredient {
    if (resolveUnit === null || line.unit === null) {
        return line;
    }

    const conversion = convertHistoricalUnit(resolveUnit, line.quantity, line.unit);

    return conversion === null
        ? line
        : {
              ...line,
              quantity: conversion.restated.quantity,
              unit: conversion.restated.unit,
              unitConversion: conversion,
          };
}

/**
 * Compose the reader-facing description, disclosing whatever the source did not state.
 *
 * The disclosure is the point. A recipe showing "1 serving, 0 min prep" with no explanation looks like bad
 * data; the same recipe saying the source states neither is an accurate record of a 1900s cookbook. R35's
 * historical-unit conversion is the same kind of fact and is disclosed in the same place: a reader shown
 * "0.5 cup" from a book that printed "one gill" is owed the sentence saying so, and WHOSE table said it.
 *
 * @param attribution - The book credit, when the caller supplied one.
 * @param yieldStated - Whether a serving count was read from the text.
 * @param ingredients - The accepted lines, read for their conversion markers.
 * @returns The description. Pure.
 */
function buildDescription(
    attribution: string | undefined,
    yieldStated: boolean,
    ingredients: readonly CandidateIngredient[],
): string {
    const source = attribution === undefined ? 'a public-domain cookbook' : attribution;
    const caveat = yieldStated
        ? 'Preparation time is not stated in the source.'
        : 'The source states no yield, so the quantities are exactly as printed — one batch. Preparation time is not stated either.';

    return [`Imported verbatim from ${source}.`, caveat, ...describeConversions(ingredients)].join(' ');
}

/** How each measure system is named to a reader. Never the internal token. */
const MEASURE_SYSTEM_LABEL: Readonly<Record<MeasureSystem, string>> = {
    'us-customary': 'US customary',
    'british-imperial': 'British imperial',
};

/**
 * The disclosure sentence for a recipe whose historical units were restated, or nothing at all.
 *
 * ⛔ Nothing when nothing was converted — the sentence's PRESENCE is the disclosure, so a recipe that
 * needed no conversion must not carry a paragraph explaining that none happened. Units are grouped by the
 * authority that sized them, so a reader is told which figures came from the book's own table and which
 * from the external standard, rather than being handed one blended claim.
 */
function describeConversions(ingredients: readonly CandidateIngredient[]): readonly string[] {
    const byCitation = new Map<string, { readonly system: MeasureSystem; readonly units: Set<string> }>();

    for (const line of ingredients) {
        const { equivalence } = line.unitConversion ?? {};

        if (equivalence === undefined) {
            continue;
        }

        const group = byCitation.get(equivalence.citation) ?? { system: equivalence.measureSystem, units: new Set() };

        group.units.add(equivalence.unit);
        byCitation.set(equivalence.citation, group);
    }

    return [...byCitation].map(
        ([citation, group]) =>
            `Historical measures in this recipe (${[...group.units].sort().join(', ')}) were converted to ` +
            `modern kitchen measures in the ${MEASURE_SYSTEM_LABEL[group.system]} system, using ${citation}.`,
    );
}
