/**
 * A live source hit as the picker shows it (curated catalog plan U8 S4, R19). A hit on an item the catalog holds is
 * shown under its owner's ROOT name and id, carrying the variant when a variant owns it — never under the source's raw
 * description. A hit the catalog does not hold keeps the source's name and has no id.
 *
 * DESIGN PATTERN: Pure projection — total over its input, unaware of the DAO and HTTP.
 *
 * @module
 */
import type { CatalogOwner } from '../catalogOwnerReader.service.js';
import type { LiveSearchResultView, VariantView } from '../foods.schema.js';
import { variantPartViewsOf } from './variantView.js';

/**
 * Project one live hit. Pure.
 *
 * @param hit - The source's hit.
 * @param owner - The live catalog entry standing for its item, or `undefined`.
 * @returns The wire view.
 */
export function liveHitView(hit: { readonly name: string }, owner: CatalogOwner | undefined): LiveSearchResultView {
    if (owner === undefined) {
        return { name: hit.name };
    }

    const variant = ownerVariantView(owner);

    return { name: owner.rootName ?? hit.name, id: owner.rootId, ...(variant === undefined ? {} : { variant }) };
}

/**
 * The variant an owner names, as the wire publishes it. Pure.
 *
 * @param owner - The live catalog entry.
 * @returns The variant's view, or `undefined` for a root.
 */
export function ownerVariantView(owner: CatalogOwner): VariantView | undefined {
    return owner.kind === 'variant' ? { id: owner.id, parts: variantPartViewsOf(owner.parts) } : undefined;
}
