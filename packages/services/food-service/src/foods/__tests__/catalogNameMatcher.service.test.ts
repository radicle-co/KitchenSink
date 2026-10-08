/**
 * `CatalogNameMatcher` — the I/O shell over the catalog-first identity rule (`catalogNameMatch.ts`): retrieval is the
 * catalog search's own (`FoodSearchDao.searchCatalog`), and the variants are read only for the hits a name leaves words
 * beyond, as the search's own variant read is (`FoodsService.namedVariantsOf`).
 */
import { describe, expect, it, vi } from 'vitest';

import { CatalogNameMatcher } from '../catalogNameMatcher.service.js';
import type { CatalogSearchHit } from '../dao/foodSearch.dao.js';
import type { LiveVariant } from '../dao/foodVariant.dao.js';

const BROCCOLI: CatalogSearchHit = { id: 'R-broccoli', name: 'Broccoli', aliases: 'calabrese', score: 1 };
const STEAMED: LiveVariant = {
    id: 'V-steamed',
    rootId: 'R-broccoli',
    itemId: 'I-steamed',
    parts: [{ attribute: 'cookingMethod', ordinal: 0, text: 'steamed' }],
    nutrients: [],
};

/** The matcher over a search answering `hits` and a variant read answering `variants`. */
function matcherOver(hits: readonly CatalogSearchHit[], variants: readonly LiveVariant[]) {
    const searchCatalog = vi.fn(async (_query: string) => [...hits]);
    const listLive = vi.fn(async (_rootIds: readonly string[], _options: { withNutrition: boolean }) => [...variants]);

    return { matcher: new CatalogNameMatcher({ searchCatalog }, { listLive }), searchCatalog, listLive };
}

describe('CatalogNameMatcher.identicalEntryFor', () => {
    it('retrieves through the catalog search with the name, and answers the root a synonym names', async () => {
        const { matcher, searchCatalog, listLive } = matcherOver([BROCCOLI], [STEAMED]);

        await expect(matcher.identicalEntryFor('calabrese')).resolves.toEqual({ kind: 'root', id: 'R-broccoli' });
        expect(searchCatalog).toHaveBeenCalledWith('calabrese');
        expect(listLive).not.toHaveBeenCalled();
    });

    it('reads the live variants of a hit the name leaves words beyond, without nutrition, and answers the variant', async () => {
        const { matcher, listLive } = matcherOver([BROCCOLI], [STEAMED]);

        await expect(matcher.identicalEntryFor('steamed broccoli')).resolves.toEqual({
            kind: 'variant',
            id: 'V-steamed',
        });
        expect(listLive).toHaveBeenCalledWith(['R-broccoli'], { withNutrition: false });
    });

    it('only offers a hit its own root’s variants', async () => {
        const other: CatalogSearchHit = { id: 'R-cauliflower', name: 'Cauliflower', aliases: null, score: 0.5 };
        const { matcher } = matcherOver([other], [STEAMED]);

        await expect(matcher.identicalEntryFor('steamed cauliflower')).resolves.toBeUndefined();
    });

    it('answers nothing, and reads no variant, when the search retrieves nothing', async () => {
        const { matcher, listLive } = matcherOver([], []);

        await expect(matcher.identicalEntryFor('broccoli florets')).resolves.toBeUndefined();
        expect(listLive).not.toHaveBeenCalled();
    });
});
