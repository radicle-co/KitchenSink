/**
 * ADR-0073 §1, §4 and §9 - the pure private-slot module: the limit, who has one, and when a count is needed at all.
 *
 * Written BEFORE `privateSlotPolicy.ts` (test-first). Every boundary is a literal number from the ADR, not a value
 * read back from the constant under test, so a constant changed to 49 or 51 fails here.
 */
import { describe, expect, it } from 'vitest';
import { RecipeSourceType, RecipeStatus, RecipeVisibility } from '@kitchensink/recipe-core';

import {
    FREE_PRIVATE_SLOT_LIMIT,
    SLOT_NOT_NEEDED,
    hasFreePrivateSlot,
    holdsPrivateSlot,
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

describe('holdsPrivateSlot - what a slot is (ADR-0073 section 12): private AND published', () => {
    it.each([
        [RecipeVisibility.PRIVATE, RecipeStatus.PUBLISHED, true],
        [RecipeVisibility.PRIVATE, RecipeStatus.DRAFT, false],
        [RecipeVisibility.PUBLIC, RecipeStatus.PUBLISHED, false],
        [RecipeVisibility.PUBLIC, RecipeStatus.DRAFT, false],
    ])('visibility %s + status %s holds a slot: %s', (visibility, status, expected) => {
        expect(holdsPrivateSlot({ visibility, status })).toBe(expected);
    });
});

/**
 * Rewritten for the owner ruling of 2026-10-26 (ADR-0073 section 12, spec 001 FR-003b): the old table keyed on the
 * REQUESTED visibility alone, so a private draft was checked. The check now runs when a recipe COMES TO HOLD a slot, i.e.
 * it does not hold one before the write and does after it. Every row is a literal (before, after) pair.
 */
describe('requiresPrivateSlotCheck - the check runs when a recipe comes to hold a slot', () => {
    const PUBLIC = RecipeVisibility.PUBLIC;
    const PRIVATE = RecipeVisibility.PRIVATE;
    const DRAFT = RecipeStatus.DRAFT;
    const PUBLISHED = RecipeStatus.PUBLISHED;
    const free = { sourceType: RecipeSourceType.USER_CREATED, isPremium: false } as const;

    it.each([
        ['a new private recipe, published', undefined, { visibility: PRIVATE, status: PUBLISHED }, true],
        ['a new private DRAFT', undefined, { visibility: PRIVATE, status: DRAFT }, false],
        ['a new public recipe, published', undefined, { visibility: PUBLIC, status: PUBLISHED }, false],
        [
            'a published public recipe made private',
            { visibility: PUBLIC, status: PUBLISHED },
            { visibility: PRIVATE, status: PUBLISHED },
            true,
        ],
        [
            'a private draft published',
            { visibility: PRIVATE, status: DRAFT },
            { visibility: PRIVATE, status: PUBLISHED },
            true,
        ],
        [
            'a public draft made private (still a draft)',
            { visibility: PUBLIC, status: DRAFT },
            { visibility: PRIVATE, status: DRAFT },
            false,
        ],
        [
            'a private draft saved again',
            { visibility: PRIVATE, status: DRAFT },
            { visibility: PRIVATE, status: DRAFT },
            false,
        ],
        [
            'a published private recipe saved again (already holds its slot)',
            { visibility: PRIVATE, status: PUBLISHED },
            { visibility: PRIVATE, status: PUBLISHED },
            false,
        ],
        [
            'a published private recipe set back to draft (frees its slot)',
            { visibility: PRIVATE, status: PUBLISHED },
            { visibility: PRIVATE, status: DRAFT },
            false,
        ],
        [
            'a published private recipe made public',
            { visibility: PRIVATE, status: PUBLISHED },
            { visibility: PUBLIC, status: PUBLISHED },
            false,
        ],
        [
            'a public draft published',
            { visibility: PUBLIC, status: DRAFT },
            { visibility: PUBLIC, status: PUBLISHED },
            false,
        ],
    ])('free cook: %s -> %s', (_label, before, after, expected) => {
        expect(requiresPrivateSlotCheck({ ...free, before, after })).toBe(expected);
    });

    it('is false for Premium: Premium never counts slots', () => {
        for (const sourceType of Object.values(RecipeSourceType)) {
            expect(
                requiresPrivateSlotCheck({
                    sourceType,
                    isPremium: true,
                    before: undefined,
                    after: { visibility: PRIVATE, status: PUBLISHED },
                }),
            ).toBe(false);
        }
    });

    it('is false for imported_public: it needs Premium first and a slot never helps it', () => {
        expect(
            requiresPrivateSlotCheck({
                sourceType: RecipeSourceType.IMPORTED_PUBLIC,
                isPremium: false,
                before: undefined,
                after: { visibility: PRIVATE, status: PUBLISHED },
            }),
        ).toBe(false);
    });

    it.each([RecipeSourceType.USER_CREATED, RecipeSourceType.IMPORTED_PHYSICAL, RecipeSourceType.IMPORTED_PAID])(
        'is true for a free cook publishing a private %s recipe',
        (sourceType) => {
            expect(
                requiresPrivateSlotCheck({
                    sourceType,
                    isPremium: false,
                    before: undefined,
                    after: { visibility: PRIVATE, status: PUBLISHED },
                }),
            ).toBe(true);
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
