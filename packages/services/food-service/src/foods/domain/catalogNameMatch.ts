/**
 * Which catalog entry a by-name food IS, read over what the catalog search retrieved for its name (FOOD-SERVICE-6;
 * ADR-0055 point 4: our catalog's foods come first).
 *
 * Retrieval is the catalog search's (`FoodSearchDao.searchCatalog`); this rule decides identity over its hits:
 *
 * - **A root** is the food when the name equals the root's name or one of its synonyms under the catalog's identity key,
 *   `normalizeName` — the key `createByName` dedups on and the live-name index is built on. It folds case and the
 *   catalog's display hygiene, and nothing else: no plural, no punctuation, no word order, because those can separate
 *   two foods (`2% milk` and `2 milk`, `milk chocolate` and `chocolate milk`).
 * - **A variant** is the food when the name is exactly a root and one of its live variants, by `identicalVariant`: the
 *   rule search attaches a variant by (`matchVariant`), tightened from "contains" to "equals".
 * - **Two entries** matching is no match. The caller then asks the sources, and a cook decides.
 *
 * Search's own attachment (`matchVariant`) is deliberately looser: it decorates a result a cook still chooses. This rule
 * forwards a food with no cook involved, so it must never claim an identity the catalog does not hold.
 *
 * @pattern Specification — one pure rule from a name and the catalog's retrieved entries to the entry the name is
 * @module
 */
import type { FoodRef } from '../foods.schema.js';
import { normalizeName } from '../foodName.js';
import { identicalVariant, namesOf, type VariantCandidate } from './variantQueryMatch.js';

/** A catalog search hit, as the rule reads it. */
export interface CatalogNameHit {
    readonly id: string;
    readonly name: string | null;
    /** Its synonyms, `ALIAS_DELIMITER`-joined, or `null`. */
    readonly aliases: string | null;
}

/**
 * The entry a name is, if exactly one retrieved entry is it. Pure.
 *
 * @param name - The by-name food's name.
 * @param hits - What the catalog search retrieved for it.
 * @param variantsOf - Each hit's live variants.
 * @returns The root or variant, or `undefined` when none or several are the name.
 */
export function identicalCatalogEntryOf(
    name: string,
    hits: readonly CatalogNameHit[],
    variantsOf: (rootId: string) => readonly VariantCandidate[],
): FoodRef | undefined {
    const key = normalizeName(name);

    if (key === '') {
        return undefined;
    }

    const matches = new Map<string, FoodRef>();

    for (const hit of hits) {
        const names = namesOf(hit.name, hit.aliases);

        if (names.some((candidate) => normalizeName(candidate) === key)) {
            matches.set(`root:${hit.id}`, { kind: 'root', id: hit.id });

            continue;
        }

        const variant = identicalVariant(name, names, variantsOf(hit.id));

        if (variant !== undefined) {
            matches.set(`variant:${variant.id}`, { kind: 'variant', id: variant.id });
        }
    }

    const [only, ...others] = matches.values();

    return others.length === 0 ? only : undefined;
}
