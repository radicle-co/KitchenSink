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
 * The last word of a phrase, stripped of punctuation and case — the noun the phrase is ABOUT.
 *
 * @param text - Any phrase.
 * @returns The comparable final word, or `''`. Pure.
 */
function headNoun(text: string): string {
    return (text.trim().split(/\s+/).at(-1) ?? '').toLowerCase().replace(/[^\p{L}\p{N}-]/gu, '');
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
 * Whether a phrase names a VESSEL rather than a food — the "is this an ingredient at all?" question.
 *
 * ⛔ Vessels only, deliberately. See the module docstring: widening this to {@link namesNoFood} costs real
 * ingredients whose span happens to end on a duration word.
 *
 * @param text - A parsed name or a whole span.
 * @returns `true` when the noun it is about is equipment. Pure and TOTAL.
 */
export function namesEquipment(text: string): boolean {
    return VESSELS.has(headNoun(text));
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
    const noun = headNoun(text);

    return VESSELS.has(noun) || NOT_A_MEASURE.has(noun);
}
