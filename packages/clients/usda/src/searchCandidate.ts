/**
 * A USDA search hit as a source-agnostic candidate: the one place a hit's `fdcId` becomes an opaque `externalKey`
 * (FR-IDN-2). Food-service's add-by-name and the remote search service both map hits through it.
 *
 * @module
 */
import { foundationLineageKey, type LineageKey } from './lineageKey.js';
import type { UsdaSearchHit } from './types.js';

/** A search hit with no USDA-native key or term. */
export interface UsdaSearchCandidate {
    /** USDA's key for the item, opaque past this boundary. */
    readonly externalKey: string;
    /** USDA's description of the item. */
    readonly name: string;
    /** The item's {@link LineageKey}, or `null` when it has none. */
    readonly lineageKey: LineageKey | null;
}

/**
 * Map one search hit. Pure.
 *
 * @param hit - The hit, as `UsdaApiClient.searchFoods` returns it.
 * @returns The candidate.
 */
export function usdaSearchCandidate(hit: UsdaSearchHit): UsdaSearchCandidate {
    return { externalKey: String(hit.fdcId), name: hit.description, lineageKey: lineageKeyOf(hit) };
}

/**
 * A hit's lineage key: its NDB number, for a Foundation hit only. Pure.
 *
 * @param hit - The hit.
 * @returns The key, or `null`.
 */
function lineageKeyOf(hit: UsdaSearchHit): LineageKey | null {
    switch (hit.dataType) {
        case 'Foundation':
            return hit.ndbNumber === undefined ? null : foundationLineageKey(hit.ndbNumber);
        case 'SR Legacy':
        case 'Survey (FNDDS)':
        case 'Branded':
        case 'Experimental':
        case undefined:
            return null;
    }
}
