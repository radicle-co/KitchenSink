import { describe, expect, it } from 'vitest';

import { badgeLineHeightOf, metaLineHeightOf } from '../oneLine.js';

/**
 * The height of a native card's one-line rows (`docs/design/uiOverhaul/buildSpec.md` §4.1 "one line", A-028 / W-06):
 * exactly the line the row holds, scaled by the OS font scale, so a dropped item is fully hidden and nothing is clipped.
 */
describe('metaLineHeightOf', () => {
    it.each([
        [1, 20],
        [1.3, 26],
        [2, 40],
    ])('rounds the 19.6 pt meta leading × %s up to %s', (fontScale, expected) => {
        expect(metaLineHeightOf(fontScale)).toBe(expected);
    });
});

describe('badgeLineHeightOf', () => {
    it('keeps the 24 pt badge floor at the default scale', () => {
        expect(badgeLineHeightOf(1)).toBe(24);
    });

    it('grows with the larger of the badge word (caption + 4 pt padding) and the meta text beside it', () => {
        // caption 16.8 × 2 + 4 = 37.6 → 38, meta 19.6 × 2 = 39.2 → 40: the meta text beside the badge decides.
        expect(badgeLineHeightOf(2)).toBe(40);
    });

    it('never answers less than the meta line it can hold', () => {
        for (const scale of [1, 1.15, 1.5, 2]) {
            expect(badgeLineHeightOf(scale)).toBeGreaterThanOrEqual(metaLineHeightOf(scale));
        }
    });
});
