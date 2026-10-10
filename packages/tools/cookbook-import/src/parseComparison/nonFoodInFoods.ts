/**
 * THE HEADLINE OF THE PROMPT BAKE-OFF — how often `foods` holds something that is not a food.
 *
 * DESIGN PATTERN: **first-match rule chain over a BORROWED lexicon.** The vocabulary is
 * `recipe-import-core`'s `notAFoodLexicon`, imported rather than restated: that module
 * already answers "is the thing this text names a food?" for the segmentation guard and the importer's
 * accept gate, and a second vessel list here would be two answers to one question with nothing keeping them
 * in step. This file owns only the CENSUS — which kinds are counted apart, and over what denominator.
 *
 * ## ⛔ WHAT THIS NUMBER IS, AND WHAT IT IS NOT
 *
 * It is the failure the whole experiment is about. The shipped prompt gives the model no slot for equipment
 * or units, so on `a large mixing bowl whip to a cream two eggs` it answered
 * `foods: ['mixing bowl', 'two eggs']` — doing exactly what it was told, because `foods` was the only
 * container that fit. The hypothesis is that a drain slot lowers this rate. This module makes that testable.
 *
 * ⛔ It is NOT an accuracy score and must never be reported as one. A model can drive this to zero by
 * naming no foods at all, so it is only meaningful beside the CRF agreement rate and the contract census —
 * exactly the reason `parseComparisonReport.ts` refuses to publish a single composite "quality" figure.
 *
 * ⚠️ It is a LOWER BOUND, in one direction only, and the direction is stated so a reader can discount it: a
 * lexicon decides only the words it knows. An unlisted vessel (`ramekin`, `salamander`) reads as a food and
 * is NOT counted, so the true rate is at least this. That bias is identical in every arm, which is what
 * makes the arms comparable even though none of their absolute rates is exact.
 *
 * ## ⚠️ WHY THE THREE KINDS ARE COUNTED APART
 *
 * They fail for different reasons and a prompt change moves them differently:
 *
 *  - `vessel` — a bowl, a pan, a sieve. This is the kind the `equipment` drain is aimed at, so it is the one
 *    a v2 or v3 win must show up in. Detected HEAD-FINALLY by `namesEquipment`, which is why `pot roast` is
 *    a roast and `a dish of stewed prunes` is prunes.
 *  - `nonSubstanceMeasure` — a duration, a dimension, a temperature, a count of people. The drain does not
 *    address it; a `units` slot might. Detected by the same lexicon's wider predicate, minus the vessels.
 *  - `pronoun` — `one`, `it`, `them`. Neither drain addresses it: the model is naming a referent it has not
 *    resolved, which is a different defect from filing a real noun in the wrong slot.
 *
 * Folding them into one count would report a single number that moves for three reasons, and no arm's
 * result could be attributed to the thing it changed.
 */
import { namesEquipment, namesNoFood } from '@kitchensink/recipe-import-core';

import { normalizeName } from './parseNormalization.js';
import type { VariantParse } from './parseResponse.js';

/** What a `foods` entry names, when it does not name a food. */
export type NonFoodKind = 'vessel' | 'nonSubstanceMeasure' | 'pronoun';

/** Every kind, so a census cannot silently omit one. */
export const NON_FOOD_KINDS = ['vessel', 'nonSubstanceMeasure', 'pronoun'] as const satisfies readonly NonFoodKind[];

/**
 * Words that REFER to a food without naming one.
 *
 * ⚠️ Grammar, and deliberately not part of `notAFoodLexicon`. That module's two sets answer "does this noun
 * name a substance?"; a pronoun is not a noun that fails that test, it is a referring expression that never
 * took the test — and it is only a defect HERE, in an answer slot that was asked for identities. Merging it
 * into a production lexicon would push a measurement convenience into the importer's segmentation guard,
 * where deleting a span because it says `them` is not obviously right.
 *
 * ⚠️ Spelled in natural English and folded through {@link normalizeName} on BOTH sides, rather than
 * hand-folded here. Under the ranking singularizer `this` folds to `thi` and `ones` folds to `one`, so a
 * hand-written set is exactly where a silent miss lives — and it would be silent in the direction that
 * matters, reporting a pronoun as a food.
 *
 * ⛔ Every entry is a DISTINCT fold: `ones` is deliberately absent because it folds onto `one`, and listing
 * it would make the input-side fold untestable — a test on `ones` would pass on the raw spelling and prove
 * nothing about the folding this set depends on.
 */
const PRONOUNS: readonly string[] = ['one', 'it', 'them', 'they', 'these', 'those', 'this', 'that'];

/** The pronouns in the same fold every name comparison in this harness uses. */
const FOLDED_PRONOUNS: ReadonlySet<string> = new Set(PRONOUNS.map(normalizeName));

/**
 * What one `foods` entry names, when it does not name a food.
 *
 * ⚠️ First match wins, vessels first. `a large mixing bowl` is a vessel and nothing else; the order only
 * decides what a name that satisfied two rules would be CALLED, and vessels are the kind the experiment is
 * aimed at, so they are named in preference to the wider bucket that also contains them.
 *
 * @param name - One `foods` entry's name, exactly as the model wrote it.
 * @returns The kind, or `undefined` when the entry names something this lexicon does not refuse. Pure.
 */
export function classifyFoodName(name: string): NonFoodKind | undefined {
    if (name.trim() === '') {
        // ⚠️ An empty name is an ABSENT food, not a non-food one — `normalizeParseAnswer` drops it before
        // anything downstream sees it, and "emitted blanks" and "filed vessels" are two different defects
        // that must not share a number. The three lexicons below all happen to answer no for a blank today,
        // so this states the classification locally instead of leaving it to their incidental agreement.
        return undefined;
    }

    if (namesEquipment(name)) {
        return 'vessel';
    }

    if (namesNoFood(name)) {
        return 'nonSubstanceMeasure';
    }

    return FOLDED_PRONOUNS.has(normalizeName(name)) ? 'pronoun' : undefined;
}

/**
 * Every non-food this reading filed under `foods`.
 *
 * @param parse - One arm's reading of one line, already projected to the common vocabulary.
 * @returns One kind per offending entry, in the order the model named them. Empty when every entry names a
 *   food. Pure.
 */
export function nonFoodsIn(parse: VariantParse): readonly NonFoodKind[] {
    return parse.foods.flatMap((food) => {
        const kind = classifyFoodName(food.name);

        return kind === undefined ? [] : [kind];
    });
}
