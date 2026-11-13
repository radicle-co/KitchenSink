/**
 * What a request that names an item the import may already hold does with it (ADR-0072 §3).
 *
 * DESIGN PATTERN: **Specification / Policy module**, pure and total. Items are keyed by ORDINAL, so a replay (a lost `201`, a
 * second device, a retry) is safe. Once an item is past `received` (it holds a parse job or a match snapshot), the recipe it
 * holds is what those were made from, so a DIFFERENT recipe is refused rather than replacing it. A `received` item may be
 * replaced even when it has paid its unit: the unit stays spent (nothing is billed twice), and the replace moves the item's
 * parse generation, so a job created for the old text and never attached is not reused. An identical recipe is a no-op, and a
 * saved item is refused outright (its text was shed at the save, so nothing can be compared, and an item is saved once).
 *
 * ONE exception to the lock (re-review of #220): a `matched` item the save holds because it cannot READ its recipe can never be
 * saved from it, so a different recipe REOPENS it: back to `received`, its snapshot dropped, a new parse generation, and the
 * unit it paid still spent. Without it the cook had no way out of that hold.
 */
import { isDeepStrictEqual } from 'node:util';

import type { ImportStage } from '../../database/schema/recipeImports.js';

/** The part of a held item the decision reads. */
export interface HeldItem {
    readonly stage: ImportStage;
    /** The recipe as stored, or `null` once saved (the text is shed). */
    readonly payload: unknown;
    /** Whether the save holds it, at its current revision, because it cannot read its recipe (`isHeldUnreadable`). */
    readonly heldUnreadable: boolean;
}

/** What to do with the incoming item. */
export type ItemUpsertDecision =
    | { readonly kind: 'insert' }
    /** Hold the recipe as it is; the statement and visibility still merge. */
    | { readonly kind: 'keep' }
    | { readonly kind: 'replace' }
    /** A different recipe for a matched item held as unreadable: start it again from `received`. */
    | { readonly kind: 'reopen' }
    /** A different recipe for an item past `received`: `IMPORT_ITEM_LOCKED`. */
    | { readonly kind: 'locked'; readonly stage: 'parsing' | 'matched' }
    /** The item is saved: `IMPORT_ITEM_ALREADY_SAVED`. */
    | { readonly kind: 'saved' };

/**
 * Decide what to do with one incoming item.
 *
 * @param input - The held item, if any, and the incoming recipe (parsed, so it carries no undefined keys that survived).
 * @returns The decision. Pure and total.
 */
export function decideItemUpsert(input: {
    readonly existing: HeldItem | undefined;
    readonly recipe: unknown;
}): ItemUpsertDecision {
    const { existing } = input;

    if (existing === undefined) {
        return { kind: 'insert' };
    }

    if (existing.stage === 'saved') {
        return { kind: 'saved' };
    }

    // The recipe is compared as JSON: the held one came back from jsonb (no undefined keys, keys in storage order), and
    // `isDeepStrictEqual` ignores key order. The round trip drops an `undefined` the request left on a key.
    const same = isDeepStrictEqual(existing.payload, JSON.parse(JSON.stringify(input.recipe)));

    if (same) {
        return { kind: 'keep' };
    }

    if (existing.stage === 'received') {
        return { kind: 'replace' };
    }

    return existing.stage === 'matched' && existing.heldUnreadable
        ? { kind: 'reopen' }
        : { kind: 'locked', stage: existing.stage };
}
