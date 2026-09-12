/**
 * The name a remote item's root carries once it is adopted (ADR-0055 point 10; `rowEditorOpenDecisions.md` system
 * change 13): the source's name in the catalog's canonical display form (`sanitizeFoodName`). The progressive search
 * shows a hit under it and seals it in the hit's reference, and the adopt command makes the root with it, so a pick
 * never renames what the cook chose.
 *
 * @module
 */
import { sanitizeFoodName } from '@kitchensink/recipe-core/food-name';

import { normalizeName } from '../foodName.js';

/**
 * The root name of a remote item. Pure.
 *
 * @param sourceName - The source's name for the item.
 * @returns The name its root carries; empty when nothing in it is visible, and then it cannot become a root.
 */
export function remoteRootNameOf(sourceName: string): string {
    return sanitizeFoodName(sourceName);
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
