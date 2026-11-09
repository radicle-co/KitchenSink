/**
 * The world-readable predicate (ADR-0029 §8): a catalog row and a PROMOTED authored row are read by everyone, a
 * private authored row by its author alone. Pure, so the truth table is the whole contract; the two SQL statements
 * that must agree with it (search scopes, the shared nutrition read) are pinned in their DAO suites.
 */
import { describe, expect, it } from 'vitest';

import { isWorldReadable, PROMOTED_VISIBILITY } from '../promotedIsPublic.js';

describe('isWorldReadable', () => {
    it.each([
        { userId: null, visibility: 'public' as const, readable: true },
        { userId: '01JAUTHOR', visibility: 'promoted' as const, readable: true },
        { userId: '01JAUTHOR', visibility: 'private' as const, readable: false },
    ])('user $userId / $visibility → $readable', ({ userId, visibility, readable }) => {
        expect(isWorldReadable({ userId, visibility })).toBe(readable);
    });

    it('names the visibility the migrations store', () => {
        expect(PROMOTED_VISIBILITY).toBe('promoted');
    });
});
