/**
 * @module notAFoodLexicon — the words that name something a recipe does not CONTAIN.
 *
 * DESIGN PATTERN: **Lexicon / lookup table behind pure total functions**, the sibling of
 * `modifierLexicon.ts` and filed apart from the policies that consume it for the reason §1 gives: a file
 * that is a policy AND a word list is two files wearing one name. Nothing here is on the package barrel
 * except {@link measuresNoSubstance}, which `cookbook-import`'s accept gate needs and cannot restate.
 *
 * ## ⛔ TWO predicates, because there are two questions — and conflating them deleted data
 *
 * {@link namesEquipment} answers _is this span an ingredient at all?_ and consults VESSELS **only**.
 * {@link namesNoFood} answers _would cutting this tail delete a food?_ and consults both sets. Using the
 * wider one for the narrower question is not a harmless over-approximation: measured on the whole 1919
 * book, it dropped `Sift one cup of flour three times` — a real cup of a real flour — because the span
 * ends on `times`, and two recipes fell below the minimum ingredient count as a result. A duration
 * trailing a stated quantity is residue ON an ingredient; a vessel IS the thing the span names.
 *
 * ## Why culinary vocabulary is admissible HERE, when the neighbouring lexicons are grammar-only
 *
 * `modifierLexicon.ts` and `proseRecipe.ts`'s `LEADING_NOISE` are deliberately grammar — removing
 * `sifted` from `sifted flour` would be rewriting an ingredient to find a friendlier catalog match, which
 * is the massaging that corrupts the resolution measurement. These sets do the opposite: they name things
 * that are **not foods at all**, exactly as `proseRecipe`'s `NOT_AN_INGREDIENT` does, and they never
 * rewrite a food. A vessel and an hour cannot be nudged toward a catalog hit because neither is in a
 * catalog.
 *
 * ## ⛔ Why this is ONE module and not two
 *
 * Both sets answer one question — _is the thing this text names a food?_ — and both callers need the
 * whole answer. The segmentation guard (`clauseSegmentation.ts`) asks it of a clause tail, where a vessel
 * and a duration are equally not-a-second-food; `proseRecipe`'s gate asks it of a parsed unit. Splitting
 * them would put half an answer in each of two files and leave every caller assembling the other half.
 *
 * ⚠️ Accepted limit, the same one `modifierLexicon` states: a lexicon only decides the words it knows. An
 * unlisted vessel or measure reads as a food, which is the direction that loses nothing — a refused cut
 * costs only the status quo, while a wrong cut deletes an amount the source printed.
 *
 * ## ⛔ WHERE THE 2026-08-26 POSITION RULING IS *NOT*
 *
 * The owner ruled that a vessel's role is decided by its POSITION in the clause — object of a preposition
 * (an instruction) versus heading the measure phrase (a unit). None of that is here, deliberately. This
 * file answers only _which words are vessels_; `clauseSegmentation.ts` owns what a vessel in a given
 * position MEANS, because a vocabulary is an implementation detail of the policy that consumes it and a
 * word list that also knew about grammar would be two files wearing one name. What this file gained for
 * the ruling is exactly two things: {@link mentionsAVessel}, the word-anywhere scan whose PRECONDITION is
 * that the caller has already bounded the phrase; and {@link lastWordOf}, so that every question asked of
 * this vocabulary — including the policy's "does a preposition govern this span?" — folds words the same
 * way. Three predicates now, not two.
 */

/**
 * Units that measure something OTHER than an amount of food.
 *
 * ⛔ MOVED here from `proseRecipe.ts` in U22a's review pass, and the move is the point: the segmentation
 * guard needs exactly this vocabulary to tell `for five minutes` (residue, cut it) from `with two eggs`
 * (a food, keep it), and a second copy across the package boundary is the drift this repository's DRY
 * rule exists to prevent. Its original defect is unchanged and worth restating: measured in a live trial,
 * "_cut in slices one-quarter inch thick_" parsed as `0.25 inch :: thick` and "_two inches square_" as
 * `2 inche :: square`, and both were sent to the catalog lookup and landed on a PUBLIC recipe carrying a
 * real `food_id` — a nutrition claim derived from a measurement of a knife cut.
 */
const NOT_A_MEASURE: ReadonlySet<string> = new Set([
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
 * Vessels and equipment, for the HEAD-FINAL test {@link namesEquipment} applies.
 *
 * ⚠️ Matched against the LAST word of a phrase, never anywhere in it. English puts the noun a phrase is
 * ABOUT at the end of it, so `one pound of pot roast` is a roast and `a large preserving kettle` is a
 * kettle — and `a dish of stewed prunes` is prunes, which is why container words that also introduce a
 * food (`dish`, `jar`, `tin`) are safe to list.
 */
const VESSELS: ReadonlySet<string> = new Set([
    'basin',
    'boiler',
    'bowl',
    'bowls',
    'casserole',
    'colander',
    'dish',
    'dishes',
    'frying-pan',
    'frying-pans',
    'griddle',
    'gridiron',
    'jar',
    'jars',
    'kettle',
    'kettles',
    'mold',
    'molds',
    'mould',
    'moulds',
    'mortar',
    'oven',
    'pan',
    'pans',
    'platter',
    'pot',
    'pots',
    'roaster',
    'saucepan',
    'saucepans',
    'sieve',
    'sifter',
    'skillet',
    'skillets',
    // A 1900s frying pan, and one of the words KTD-11b found the two engines contesting.
    'spider',
    'spiders',
    'steamer',
    'stewpan',
    'stew-pan',
    'stove',
    'strainer',
    'tin',
    'tins',
]);

/**
 * One word, reduced to what these sets are keyed on: lower case, no surrounding punctuation.
 *
 * ⚠️ The hyphen survives on purpose — `frying-pan` and `stew-pan` are single words in this book, and
 * stripping it would leave `fryingpan`, which is in no set.
 *
 * @param word - One whitespace-delimited word.
 * @returns The comparable form, possibly `''`. Pure.
 */
function comparable(word: string): string {
    return word.toLowerCase().replace(/[^\p{L}\p{N}-]/gu, '');
}

/**
 * The last word of a phrase, reduced to comparable form.
 *
 * ⛔ Exported so the ONE tokenizer serves every question asked of this vocabulary — including
 * `clauseSegmentation.ts`'s "does a preposition govern this span?", which reads the last word of the text
 * in FRONT of a span. A second hand-rolled splitter there would fold `Into ` and `into,` differently from
 * the way `a large pan.` is folded here, and nothing downstream could report the divergence.
 *
 * @param text - Any phrase.
 * @returns The comparable final word, or `''`. Pure and TOTAL.
 */
export function lastWordOf(text: string): string {
    return comparable(text.trim().split(/\s+/).at(-1) ?? '');
}

/**
 * Whether a unit measures something other than an amount of food.
 *
 * Exported because `cookbook-import`'s accept gate asks it of a parsed unit — "a DIMENSION is not a
 * measure of an ingredient" — and that gate and this module's segmentation guard must never disagree
 * about which words those are.
 *
 * @param unit - A unit as `parseIngredientLine` canonicalised it, or any single word.
 * @returns `true` when it measures time, distance, temperature or people. Pure and TOTAL.
 */
export function measuresNoSubstance(unit: string): boolean {
    return NOT_A_MEASURE.has(unit.trim().toLowerCase());
}

/**
 * Whether ONE WORD is a vessel — the raw lookup, deliberately PRIVATE.
 *
 * ⛔ Not exported, and that is a decision rather than an omission. A bare word lookup invites a caller to
 * bring its own tokenizer AND its own idea of which words to ask about, which is two copies of this
 * module's contract living somewhere else. Callers get {@link mentionsAVessel} or {@link namesEquipment},
 * both of which fold through {@link lastWordOf} or this module's own split.
 *
 * @param word - One whitespace-delimited word.
 * @returns `true` when the word is a vessel. Pure and TOTAL.
 */
function namesAVessel(word: string): boolean {
    return VESSELS.has(comparable(word));
}

/**
 * Whether ANY word of a phrase is a vessel — the word-anywhere scan, and a loaded gun.
 *
 * ⛔⛔ ITS PRECONDITION IS THE ONLY THING THAT MAKES IT CORRECT: the caller must pass a **leading measure
 * phrase that a preposition governs**, never a whole span. Asked of a whole span it deletes real food, and
 * this file's own head-final discipline exists to say so — `one pound of pot roast` is a roast,
 * `two cups of pan gravy` is gravy, `a dish of stewed prunes` is prunes. `clauseSegmentation.ts` bounds the
 * phrase at the partitive `of` or at an instruction boundary BEFORE asking, so what reaches here is
 * `one pound`, `two cups`, `a dish` — the measure, never the food behind it.
 *
 * ⚠️ Why the head-final test cannot serve instead: a governed measure phrase's head is frequently not a
 * noun this module knows. `a large mixing bowl whip` is head-final `whip`, a verb — and ADR-0026 §5 rules
 * that this package answers definitions with a lexicon and never with a tagger, so there is no way to
 * learn that and no intention of acquiring one.
 *
 * @param measurePhrase - A leading measure phrase, already bounded by the caller.
 * @returns `true` when a vessel word sits anywhere in it. Pure and TOTAL.
 */
export function mentionsAVessel(measurePhrase: string): boolean {
    return measurePhrase.trim().split(/\s+/).some(namesAVessel);
}

/**
 * Whether a phrase names a VESSEL rather than a food — the "is this an ingredient at all?" question.
 *
 * ⛔ Vessels only, deliberately. See the module docstring: widening this to {@link namesNoFood} costs real
 * ingredients whose span happens to end on a duration word.
 *
 * @param text - A parsed name or a whole span.
 * @returns `true` when the noun it is about is equipment. Pure and TOTAL.
 */
export function namesEquipment(text: string): boolean {
    return namesAVessel(lastWordOf(text));
}

/**
 * Whether a phrase names something that is not a food at all.
 *
 * ⛔ THE QUESTION THE SEGMENTATION GUARD ACTUALLY HAS TO ASK, and asking a different one cost real data
 * twice. `unit !== null` was the first attempt and it is not the same question: `two eggs` — the normal
 * form of every count ingredient — has no unit, and `five minutes` has no unit either, so that test
 * deleted the food and kept the duration. What separates them is whether the noun names a substance.
 *
 * @param text - A parsed name or a whole span.
 * @returns `true` when it is equipment, a duration, a dimension or a count of people. Pure and TOTAL.
 */
export function namesNoFood(text: string): boolean {
    const noun = lastWordOf(text);

    return VESSELS.has(noun) || NOT_A_MEASURE.has(noun);
}
