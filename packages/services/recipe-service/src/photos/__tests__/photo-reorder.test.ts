/**
 * Unit tests for the pure {@link isExactReorder} predicate — the exact-permutation rule that keeps a
 * photo reorder from corrupting `sortOrder`. The full set of invalid shapes is pinned so a mutation to
 * any clause is caught.
 */
import { describe, it, expect } from 'vitest';

import { isExactReorder } from '../photo-reorder.js';

const CURRENT = ['a', 'b', 'c'];

describe('isExactReorder', () => {
    it('accepts a full permutation of the current photos', () => {
        expect(isExactReorder(CURRENT, ['c', 'a', 'b'])).toBe(true);
    });

    it('accepts the identity order', () => {
        expect(isExactReorder(CURRENT, ['a', 'b', 'c'])).toBe(true);
    });

    it('rejects a PARTIAL list (would leave stale, colliding sort orders)', () => {
        expect(isExactReorder(CURRENT, ['c'])).toBe(false);
    });

    it('rejects a list with a DUPLICATE id', () => {
        expect(isExactReorder(CURRENT, ['a', 'a', 'b'])).toBe(false);
    });

    it('rejects a list containing a FOREIGN id not on the recipe', () => {
        expect(isExactReorder(CURRENT, ['a', 'b', 'x'])).toBe(false);
    });

    it('rejects an EXTRA id (superset)', () => {
        expect(isExactReorder(CURRENT, ['a', 'b', 'c', 'd'])).toBe(false);
    });

    it('handles the empty case (no photos, empty request)', () => {
        expect(isExactReorder([], [])).toBe(true);
    });
});
