/**
 * The search-gap store's input rule and time bound. Its upsert, its exact count under concurrency and its prune are
 * `tests/e2e/searchGap.e2e.test.ts`, since only a real database can show them.
 */
import { describe, expect, it } from 'vitest';

import { FOOD_POOL_QUERY_TIMEOUT_MS } from '../../../database/poolConfig.js';
import type { SearchGap } from '../../domain/remoteHitTriage.js';
import { checkedGapBatch, SEARCH_GAP_STATEMENT_TIMEOUT_MS } from '../searchGap.dao.js';

const GAP: SearchGap = {
    query: 'kale',
    source: 'usda',
    externalKey: '1',
    foodId: '01JKALE0000000000000000000',
    foodVariantId: null,
    remoteName: 'Kale, raw',
};

describe('checkedGapBatch', () => {
    it('passes gaps with distinct keys through unchanged', () => {
        const other = { ...GAP, externalKey: '2' };
        const otherQuery = { ...GAP, query: 'curly kale' };

        expect(checkedGapBatch([GAP, other, otherQuery])).toEqual([GAP, other, otherQuery]);
    });

    it('refuses one key twice, which one upsert cannot count twice', () => {
        expect(() => checkedGapBatch([GAP, { ...GAP, remoteName: 'Kale' }])).toThrow(RangeError);
    });
});

describe('the gap statement bound', () => {
    // The pool's `query_timeout` is the client-side net under every food query; it must not fire first.
    it('ends before the pool backstop fires', () => {
        expect(SEARCH_GAP_STATEMENT_TIMEOUT_MS).toBeLessThan(FOOD_POOL_QUERY_TIMEOUT_MS);
    });
});
