/**
 * The orderings the two ends of the `CatalogSnapshotSource` port share. The DB snapshot and the seed projection
 * must order a food's source rows identically or every plan/diff comparison between them disagrees, so the rule
 * lives once, here.
 */
import { describe, expect, it } from 'vitest';

import { compareSources, type ContentSource } from '../catalogSnapshot.js';

describe('compareSources', () => {
    it('orders by source, then external key, by UTF-16 code unit and never by locale', () => {
        const rows: ContentSource[] = [
            { source: 'usda', externalKey: 'b' },
            { source: 'ciqual', externalKey: 'z' },
            { source: 'usda', externalKey: 'B' },
            { source: 'usda', externalKey: 'a' },
        ];

        expect([...rows].sort(compareSources)).toStrictEqual([
            { source: 'ciqual', externalKey: 'z' },
            { source: 'usda', externalKey: 'B' },
            { source: 'usda', externalKey: 'a' },
            { source: 'usda', externalKey: 'b' },
        ]);
    });

    it('answers zero for the same identity', () => {
        expect(compareSources({ source: 'usda', externalKey: '1' }, { source: 'usda', externalKey: '1' })).toBe(0);
    });
});
