/**
 * The catalog entry a by-name food IS, asked before any source is (FOOD-SERVICE-6; ADR-0055 point 4: our catalog's
 * foods come first). Add-by-name asks it so a synonym answers its root with no row made, and the fan-out worker asks it
 * so a name that is a root and one of its variants is forwarded with no source call.
 *
 * Retrieval is the catalog search's own statement (`FoodSearchDao.searchCatalog`), and the variants are read only for
 * the hits a name leaves words beyond, as the search's own variant read is. Identity is `catalogNameMatch.ts`'s.
 *
 * @pattern Facade — the catalog search and the variant read behind one question, decided by a Specification
 * @module
 */
import type { FoodSearchDao } from './dao/foodSearch.dao.js';
import type { FoodVariantDao } from './dao/foodVariant.dao.js';
import { identicalCatalogEntryOf } from './domain/catalogNameMatch.js';
import { leftoverTokens, namesOf } from './domain/variantQueryMatch.js';
import type { FoodRef } from './foods.schema.js';

export class CatalogNameMatcher {
    /**
     * @param search - The catalog search's retrieval.
     * @param variants - The live-variant read.
     */
    public constructor(
        private readonly search: Pick<FoodSearchDao, 'searchCatalog'>,
        private readonly variants: Pick<FoodVariantDao, 'listLive'>,
    ) {}

    /**
     * The one live catalog root or variant a name is.
     *
     * @param name - The by-name food's name.
     * @returns The entry, or `undefined` when none or several are the name.
     * @sideEffect Reads `food` through the catalog search, then `food_variant` and `food_variant_part` when a hit
     *   leaves words.
     */
    public async identicalEntryFor(name: string): Promise<FoodRef | undefined> {
        const hits = await this.search.searchCatalog(name);
        const wordy = hits.filter((hit) => leftoverTokens(name, namesOf(hit.name, hit.aliases)).length > 0);
        const live =
            wordy.length === 0
                ? []
                : await this.variants.listLive(
                      wordy.map((hit) => hit.id),
                      { withNutrition: false },
                  );

        return identicalCatalogEntryOf(name, hits, (rootId) => live.filter((variant) => variant.rootId === rootId));
    }
}
