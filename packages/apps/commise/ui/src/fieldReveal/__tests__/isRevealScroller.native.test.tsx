/**
 * Whether a screen's one scroller (the `ScrollHost`'s handle, a `ScrollView` or a list) can be revealed into: the field
 * reveal measures through `getNativeScrollRef` and moves with `scrollTo`, which a `FlatList` handle does not have.
 */
import { describe, expect, it } from 'vitest';

import { isRevealScroller } from '../measureField.native.js';

describe('isRevealScroller', () => {
    it('admits a ScrollView-like handle', () => {
        expect(isRevealScroller({ scrollTo: () => undefined, getNativeScrollRef: () => null })).toBe(true);
    });

    it('refuses a list handle, which scrolls by offset and has no native scroll ref', () => {
        expect(isRevealScroller({ scrollToOffset: () => undefined })).toBe(false);
        expect(isRevealScroller({ scrollTo: () => undefined })).toBe(false);
    });
});
