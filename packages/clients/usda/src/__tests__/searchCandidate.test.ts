/**
 * The one mapping from a USDA search hit to a source-agnostic candidate (FR-IDN-2). Food-service's add-by-name and the
 * remote search service both map hits through it, so a hit cannot become two different candidates.
 *
 * USDA gives an updated food a new FDC id and keeps its NDB number, so a Foundation hit's NDB number links it to the
 * item the seed pinned. Only a Foundation hit gets a lineage key: SR Legacy is frozen, and an SR Legacy item often
 * shares its NDB number with a different Foundation item (broccoli: 747447 and 170379 are both 11090).
 */
import { describe, expect, it } from 'vitest';

import { usdaSearchCandidate } from '../searchCandidate.js';
import type { UsdaSearchHit } from '../types.js';

describe('usdaSearchCandidate', () => {
    it.each<[string, UsdaSearchHit, ReturnType<typeof usdaSearchCandidate>]>([
        [
            'a Foundation hit with an NDB number',
            { fdcId: 747447, description: 'Broccoli, raw', dataType: 'Foundation', ndbNumber: '11090' },
            { externalKey: '747447', name: 'Broccoli, raw', lineageKey: 'foundation:11090' },
        ],
        [
            'a Foundation hit with no NDB number',
            { fdcId: 747447, description: 'Broccoli, raw', dataType: 'Foundation' },
            { externalKey: '747447', name: 'Broccoli, raw', lineageKey: null },
        ],
        [
            'an SR Legacy hit sharing that NDB number',
            { fdcId: 170379, description: 'Broccoli, raw', dataType: 'SR Legacy', ndbNumber: '11090' },
            { externalKey: '170379', name: 'Broccoli, raw', lineageKey: null },
        ],
        [
            'an FNDDS hit',
            { fdcId: 2_709_215, description: 'Broccoli, raw', dataType: 'Survey (FNDDS)', ndbNumber: '11090' },
            { externalKey: '2709215', name: 'Broccoli, raw', lineageKey: null },
        ],
        [
            'a Branded hit',
            { fdcId: 2_345_678, description: 'BROCCOLI FLORETS', dataType: 'Branded' },
            { externalKey: '2345678', name: 'BROCCOLI FLORETS', lineageKey: null },
        ],
        [
            'an Experimental hit',
            { fdcId: 9, description: 'Broccoli', dataType: 'Experimental', ndbNumber: '11090' },
            { externalKey: '9', name: 'Broccoli', lineageKey: null },
        ],
        [
            'a hit stating no data type',
            { fdcId: 747447, description: 'Broccoli, raw', ndbNumber: '11090' },
            { externalKey: '747447', name: 'Broccoli, raw', lineageKey: null },
        ],
    ])('maps %s', (_label, hit, expected) => {
        expect(usdaSearchCandidate(hit)).toStrictEqual(expected);
    });

    it('carries no USDA-native key or term', () => {
        const candidate = usdaSearchCandidate({ fdcId: 1, description: 'A', dataType: 'Foundation', ndbNumber: '2' });

        expect(Object.keys(candidate).sort()).toStrictEqual(['externalKey', 'lineageKey', 'name']);
    });
});
