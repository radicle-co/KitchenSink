/**
 * USDA's link between versions of one food (curated plan R19). USDA gives an updated food a new FDC id and keeps its
 * NDB number, so a Foundation item's NDB number names the food across Foundation releases. The key is opaque past
 * the USDA boundary (FR-IDN-2): food-service's seed writes it on the item's source row, and a search hit carries it.
 *
 * Only Foundation gets a key. SR Legacy's last release was April 2018, so its ids never change, and many SR Legacy
 * items share an NDB number with a different Foundation item.
 *
 * Pure and free of HTTP code, so food-service's catalog seed reads it as it reads `ndbNumber.ts`.
 *
 * @module
 */

/** A lineage key: `foundation:<NDB number>`, the form food-service's migration 0018 CHECK admits. */
export type LineageKey = `foundation:${string}`;

const LINEAGE_KEY = /^foundation:[1-9][0-9]*$/u;

/**
 * The lineage key of a Foundation item. Pure.
 *
 * @param ndbNumber - Its NDB number, a decimal string with no leading zeros.
 * @returns `foundation:<ndbNumber>`.
 */
export function foundationLineageKey(ndbNumber: string): LineageKey {
    return `foundation:${ndbNumber}`;
}

/**
 * Whether a value is a lineage key, as a row read back from the database must be. Pure.
 *
 * @param value - Any value.
 * @returns `true` for `foundation:` and an NDB number with no leading zeros.
 */
export function isLineageKey(value: unknown): value is LineageKey {
    return typeof value === 'string' && LINEAGE_KEY.test(value);
}
