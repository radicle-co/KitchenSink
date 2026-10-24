/**
 * USDA's link between versions of one Foundation food (curated plan R19): the key the seed writes and the guard a row
 * read back from the database passes. The guard admits exactly the form food-service's migration 0018
 * `food_sources_lineage_key_format` CHECK admits, so a row the database holds is never refused here, and a value it
 * refuses never passes.
 */
import { describe, expect, it } from 'vitest';

import { foundationLineageKey, isLineageKey } from '../lineageKey.js';

describe('foundationLineageKey', () => {
    it('keys a Foundation item by its NDB number', () => {
        expect(foundationLineageKey('11090')).toBe('foundation:11090');
    });
});

describe('isLineageKey', () => {
    it.each(['foundation:11090', 'foundation:1', foundationLineageKey('4582')])('admits %j', (value) => {
        expect(isLineageKey(value)).toBe(true);
    });

    it.each([
        'foundation:0',
        'foundation:011090',
        'foundation:',
        'foundation:11090 ',
        'FOUNDATION:11090',
        'srLegacy:11090',
        '',
        null,
        11090,
    ])('refuses %j', (value) => {
        expect(isLineageKey(value)).toBe(false);
    });
});
