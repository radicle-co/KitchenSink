/**
 * The published search page-size ceiling and the internal pagination clamp must AGREE.
 *
 * They are two independently authored artifacts, and this is an ASSERTION between them rather than a derivation
 * of one from the other — the ADR-0015 §6 pattern the storage-capacity audit already uses for wire-bound vs
 * column-bound. Keeping them separate is deliberate: `MAX_PAGE_SIZE` is defense-in-depth shared by three
 * endpoints' DALs, while `MAX_SEARCH_PAGE_SIZE` is ONE endpoint's published contract, and a wire bound must not
 * be reachable only through a data-access module (which is exactly how it used to be reachable).
 *
 * ⚠️ WHAT BREAKS IF THEY DIVERGE is not an abstraction violation, it is a lying response envelope.
 * `SearchService` echoes the REQUESTED `pageSize` into `{ total, page, pageSize, hasMore }` while `SearchDal`
 * independently clamps the `LIMIT` it issues. If the boundary ever admitted a page size above the clamp, the
 * envelope would report `pageSize: 999` beside 50 rows, and `hasMore` — computed from `offset + rowCount` — would
 * be answering a different question than the caller asked. So the two constants agreeing is the property that
 * makes the envelope honest, and it is worth an explicit test rather than an eyeball.
 */
import { MAX_SEARCH_PAGE_SIZE } from '@kitchensink/recipe-core';
import { describe, expect, it } from 'vitest';

import { MAX_PAGE_SIZE, clampPageSize } from '../../common/pagination.js';
import { recipeSearchQuerySchema } from '../search.schema.js';

describe('the search page-size ceiling', () => {
    it('is the same number the internal pagination clamp uses', () => {
        expect(MAX_SEARCH_PAGE_SIZE).toBe(MAX_PAGE_SIZE);
    });

    /*
     * Non-vacuity, and the property that actually matters: the largest page size the BOUNDARY accepts must be a
     * page size the CLAMP passes through untouched. Asserted against the two mechanisms rather than against the
     * constants, so a change to either one's logic (not just its value) fails here.
     */
    it('admits a page size the clamp then leaves alone, so the envelope cannot over-report', () => {
        const parsed = recipeSearchQuerySchema.parse({ pageSize: String(MAX_SEARCH_PAGE_SIZE) });

        expect(parsed.pageSize).toBe(MAX_SEARCH_PAGE_SIZE);
        expect(clampPageSize(parsed.pageSize)).toBe(MAX_SEARCH_PAGE_SIZE);
    });

    it('rejects the first page size the clamp would have had to reduce', () => {
        const beyond = MAX_SEARCH_PAGE_SIZE + 1;

        expect(recipeSearchQuerySchema.safeParse({ pageSize: String(beyond) }).success).toBe(false);
        // If this ever stopped being true, the boundary would be redundant rather than load-bearing.
        expect(clampPageSize(beyond)).toBeLessThan(beyond);
    });
});
