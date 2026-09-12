/**
 * Unit tests for `lineKey.ts` — a draft line's identity, and the map from that identity to the position the
 * server stores the line at.
 *
 * ⛔ WHAT A WRONG ANSWER COSTS. The rebind command addresses a stored line by POSITION (`ingredientRebind.service.ts`),
 * and the server stores lines in submitted order with every no-food line dropped (`toCreateRecipeInput`). A key that
 * maps to the wrong position re-points a DIFFERENT line of the cook's recipe and writes a correction for it, so every
 * case below is a shape the draft can really take between two saves: a removal above, an append, two lines on one
 * binding, a line with no food, and a merge of two editors' drafts.
 */
import { describe, expect, it } from 'vitest';

import {
    isIngredientLineKey,
    mintedLineKey,
    persistedLineKeysOf,
    seedLineKey,
    storedPositionOf,
    type IngredientLineKey,
} from '../lineKey.js';

const line = (key: IngredientLineKey, ingredientId: string | null) => ({ key, ingredientId });

describe('seedLineKey', () => {
    it('is deterministic, so a freshly seeded form compares equal to itself and the discard guard sees no change', () => {
        expect(seedLineKey(7, 2)).toBe(seedLineKey(7, 2));
    });

    it('differs by position within one version', () => {
        expect(seedLineKey(7, 0)).not.toBe(seedLineKey(7, 1));
    });

    it('differs by version at one position, so a merge of "mine" (v7) with "theirs" (v8) cannot collide', () => {
        expect(seedLineKey(7, 0)).not.toBe(seedLineKey(8, 0));
    });

    it('never equals a minted key, so an appended line cannot take a seeded line\u2019s identity', () => {
        const seeded = Array.from({ length: 5 }, (_, index) => seedLineKey(1, index));

        expect(seeded).not.toContain(mintedLineKey('0'));
    });
});

/**
 * REWRITTEN after the staff-architect REVIEW (F1). Minting used to be "one past the highest minted key in the draft",
 * which REISSUES a key whenever the highest minted line is removed — and a reissued key inherits whatever was
 * addressed by the old one (an in-flight commit, a stored position). Minting now wraps an id from a source that never
 * repeats (`mintLineKey.ts`, the house UUID seam), so this pure half only has to keep distinct ids distinct.
 */
describe('mintedLineKey', () => {
    it('is deterministic for one id (pure)', () => {
        expect(mintedLineKey('7f0c')).toBe(mintedLineKey('7f0c'));
    });

    it('keeps distinct ids distinct', () => {
        expect(mintedLineKey('a')).not.toBe(mintedLineKey('b'));
    });

    it.each(['', 'has space', 'a.b'])('refuses an id that is not a plain token: %j', (id) => {
        expect(() => mintedLineKey(id)).toThrow(RangeError);
    });
});

describe('isIngredientLineKey', () => {
    it('accepts both spellings the module produces', () => {
        expect(isIngredientLineKey(seedLineKey(1, 0))).toBe(true);
        expect(isIngredientLineKey(mintedLineKey('3b2e9c1a-0000-4000-8000-000000000000'))).toBe(true);
    });

    it.each(['', '3', 'v1', 'v1.', 'vx.0', 'n', 'n:', 'x1.0'])('rejects %j', (text) => {
        expect(isIngredientLineKey(text)).toBe(false);
    });
});

describe('persistedLineKeysOf + storedPositionOf', () => {
    const k = (index: number): IngredientLineKey => seedLineKey(4, index);

    it.each([
        {
            case: 'positive control: every line has a food, so the stored position is the draft position',
            persisted: [line(k(0), 'a'), line(k(1), 'b'), line(k(2), 'c')],
            key: k(2),
            expected: 2,
        },
        {
            case: 'a no-food line ABOVE is not stored, so it does not count',
            persisted: [line(k(0), null), line(k(1), 'b'), line(k(2), 'c')],
            key: k(2),
            expected: 1,
        },
        {
            case: 'a no-food line has no stored position at all',
            persisted: [line(k(0), null), line(k(1), 'b')],
            key: k(0),
            expected: undefined,
        },
        {
            case: 'two lines on ONE binding keep two positions (the binding is not the identity)',
            persisted: [line(k(0), 'same'), line(k(1), 'same')],
            key: k(1),
            expected: 1,
        },
        {
            case: 'a key that was never persisted (appended this session) has no stored position',
            persisted: [line(k(0), 'a')],
            key: mintedLineKey('appended'),
            expected: undefined,
        },
    ])('$case', ({ persisted, key, expected }) => {
        expect(storedPositionOf(persistedLineKeysOf(persisted), key)).toBe(expected);
    });

    it('a removal ABOVE in the draft does not move the stored position: the map reads the persisted lines', () => {
        const persisted = [line(k(0), 'a'), line(k(1), 'b'), line(k(2), 'c')];
        // The cook removed line 0 in the draft. Nothing is saved yet, so the server still stores `c` at 2.
        const draftAfterRemoval = persisted.slice(1);

        expect(storedPositionOf(persistedLineKeysOf(persisted), k(2))).toBe(2);
        // ⛔ The draft's own index is the WRONG answer, which is the defect this module exists to prevent.
        expect(draftAfterRemoval.findIndex((entry) => entry.key === k(2))).toBe(1);
    });

    it('a merge of mine with theirs keeps each side’s keys distinct', () => {
        const mine = [line(seedLineKey(7, 0), 'a'), line(seedLineKey(7, 1), 'b')];
        const theirs = [line(seedLineKey(8, 0), 'x')];
        const merged = [...mine, ...theirs];

        expect(new Set(merged.map((entry) => entry.key)).size).toBe(3);
        expect(storedPositionOf(persistedLineKeysOf(merged), seedLineKey(8, 0))).toBe(2);
    });
});
