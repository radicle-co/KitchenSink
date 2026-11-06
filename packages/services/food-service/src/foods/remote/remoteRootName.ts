/**
 * The name a remote item's root carries once it is adopted (ADR-0055 point 10; `rowEditorOpenDecisions.md` system
 * change 13): the source's name in the catalog's canonical display form (`sanitizeFoodName`), written lowercase as
 * the catalog writes names (`seed/data/namingRules.md` rule 14). The progressive search shows a hit under it and
 * seals it in the hit's reference, and the adopt command makes the root with it, so a pick never renames what the
 * cook chose.
 *
 * @module
 */
import { sanitizeFoodName } from '@kitchensink/recipe-core/food-name';

import { normalizeName } from '../foodName.js';

/** A lower-case letter in any script. */
const LOWER_CASE_LETTER = /\p{Ll}/u;

/**
 * The root name of a remote item. Pure and idempotent: adoption applies it again to the name the search sealed.
 *
 * A name with no lower-case letter (USDA's Branded names, `CHEDDAR CHEESE`) carries no case information, so it is
 * written lowercase. Any other name keeps its case, because its capitals may be proper nouns (`Cheese, Swiss`).
 * shortcut: a brand inside a capitals name is lowercased too (`KERRYGOLD BUTTER`), since nothing in it says which
 * word is a proper noun; a curated root names such a food properly.
 *
 * @param sourceName - The source's name for the item.
 * @returns The name its root carries; empty when nothing in it is visible, and then it cannot become a root.
 */
export function remoteRootNameOf(sourceName: string): string {
    const name = sanitizeFoodName(sourceName);

    return LOWER_CASE_LETTER.test(name) ? name : name.toLowerCase();
}

/**
 * The key a live catalog root carries a remote item's root name under (`normalizeName`): what the search and the pick
 * look a named root up by (`namedRootPolicy.ts`). Pure.
 *
 * @param sourceName - The source's name for the item.
 * @returns The key; empty when nothing in the name is visible, and then no root carries it.
 */
export function remoteRootKeyOf(sourceName: string): string {
    return normalizeName(remoteRootNameOf(sourceName));
}
