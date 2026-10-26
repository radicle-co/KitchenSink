/**
 * ADR-0073 §1, §4 and §9 - the pure private-slot module: the limit, who has one, and when a count is needed at all.
 *
 * Written BEFORE `privateSlotPolicy.ts` (test-first). Every boundary is a literal number from the ADR, not a value
 * read back from the constant under test, so a constant changed to 49 or 51 fails here.
 */
import { describe, expect, it } from 'vitest';
import { RecipeSourceType, RecipeVisibility } from '@kitchensink/recipe-core';

import {
    FREE_PRIVATE_SLOT_LIMIT,
    SLOT_NOT_NEEDED,
    hasFreePrivateSlot,
    privateSlotAllowanceOf,
    privateSlotStandingOf,
    requiresPrivateSlotCheck,
} from '../privateSlotPolicy.js';

describe('FREE_PRIVATE_SLOT_LIMIT', () => {
    it('is the owner-ruled 50 (2026-10-26)', () => {
        expect(FREE_PRIVATE_SLOT_LIMIT).toBe(50);
    });
});

describe('privateSlotAllowanceOf', () => {
    it('gives a free cook the limited base of 50', () => {
        expect(privateSlotAllowanceOf({ isPremium: false })).toEqual({ kind: 'limited', limit: 50 });
    });

    it('gives a Premium cook no limit', () => {
        expect(privateSlotAllowanceOf({ isPremium: true })).toEqual({ kind: 'unlimited' });
    });
});

describe('hasFreePrivateSlot - the count boundary', () => {
    const free = { kind: 'limited', limit: 50 } as const;

    it.each([
        [0, true],
        [48, true],
        [49, true],
        [50, false],
        [51, false],
        [60, false],
    ])('a free cook holding %i private recipes has a free slot: %s', (used, expected) => {
        expect(hasFreePrivateSlot(free, used)).toBe(expected);
    });

    it('a Premium cook always has one, at any count', () => {
        expect(hasFreePrivateSlot({ kind: 'unlimited' }, 0)).toBe(true);
        expect(hasFreePrivateSlot({ kind: 'unlimited' }, 5_000)).toBe(true);
    });
});

describe('requiresPrivateSlotCheck - when the lock and the count are worth taking', () => {
    const PUBLIC = RecipeVisibility.PUBLIC;
    const PRIVATE = RecipeVisibility.PRIVATE;

    it('is false for any public request: making a recipe public frees a slot, it never takes one', () => {
        for (const sourceType of Object.values(RecipeSourceType)) {
            expect(requiresPrivateSlotCheck({ sourceType, requested: PUBLIC, isPremium: false })).toBe(false);
        }
    });

    it('is false for Premium: Premium never counts slots', () => {
        for (const sourceType of Object.values(RecipeSourceType)) {
            expect(requiresPrivateSlotCheck({ sourceType, requested: PRIVATE, isPremium: true })).toBe(false);
        }
    });

    it('is false for imported_public: it needs Premium first and a slot never helps it', () => {
        expect(
            requiresPrivateSlotCheck({
                sourceType: RecipeSourceType.IMPORTED_PUBLIC,
                requested: PRIVATE,
                isPremium: false,
            }),
        ).toBe(false);
    });

    it.each([RecipeSourceType.USER_CREATED, RecipeSourceType.IMPORTED_PHYSICAL, RecipeSourceType.IMPORTED_PAID])(
        'is true for a free cook moving a %s recipe to private',
        (sourceType) => {
            expect(requiresPrivateSlotCheck({ sourceType, requested: PRIVATE, isPremium: false })).toBe(true);
        },
    );
});

describe('privateSlotStandingOf - the verdict a write is judged on, with the numbers a refusal states', () => {
    const free = { kind: 'limited', limit: 50 } as const;

    it('has a free slot at 49, and carries no numbers: there is no refusal to state them in', () => {
        expect(privateSlotStandingOf(free, 49)).toEqual({ hasAvailablePrivateSlot: true });
    });

    it.each([50, 51, 60])('at %i holds none, and carries the count and the limit the refusal states', (used) => {
        expect(privateSlotStandingOf(free, used)).toEqual({ hasAvailablePrivateSlot: false, used, limit: 50 });
    });

    it('Premium always has one, whatever the count', () => {
        expect(privateSlotStandingOf({ kind: 'unlimited' }, 5_000)).toEqual({ hasAvailablePrivateSlot: true });
    });

    it('SLOT_NOT_NEEDED says none is lacking (public, Premium, imported_public, an already private recipe)', () => {
        expect(SLOT_NOT_NEEDED).toEqual({ hasAvailablePrivateSlot: true });
    });
});
