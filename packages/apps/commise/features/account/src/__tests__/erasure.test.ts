/**
 * Unit tests for the pure account-ERASURE domain logic (CR-002 / U4b) — the single authority the web and
 * mobile erasure UIs both read. Covers the confirmation-phrase gate (mirrors the server's `trim()`-then-
 * exact-match, adversarially) and the donate-election eligibility over the orthogonal visibility×status axes.
 */
import { describe, expect, it } from 'vitest';
import { RecipeStatus, RecipeVisibility } from '@kitchensink/recipe-core';

import {
    ACCOUNT_ERASURE_CONFIRMATION_PHRASE,
    confirmsErasurePhrase,
    isErasureBlockedByPrivateFood,
    isErasureDonationEligible,
    selectBlockedRecipes,
    selectDonatableRecipes,
} from '../erasure.js';

describe('ACCOUNT_ERASURE_CONFIRMATION_PHRASE', () => {
    it('is the exact literal the recipe service validates against', () => {
        // Pinned to the server's `ErasureRequestDto.ACCOUNT_ERASURE_CONFIRMATION_PHRASE`; drift 400s erasure.
        expect(ACCOUNT_ERASURE_CONFIRMATION_PHRASE).toBe('ERASE MY DATA');
    });
});

describe('confirmsErasurePhrase', () => {
    it('accepts the exact phrase', () => {
        expect(confirmsErasurePhrase('ERASE MY DATA')).toBe(true);
    });

    it('accepts the phrase with surrounding whitespace (mirrors the server trim)', () => {
        expect(confirmsErasurePhrase('  ERASE MY DATA  ')).toBe(true);
        expect(confirmsErasurePhrase('\tERASE MY DATA\n')).toBe(true);
    });

    it('rejects the empty string', () => {
        expect(confirmsErasurePhrase('')).toBe(false);
        expect(confirmsErasurePhrase('   ')).toBe(false);
    });

    it('rejects a case mismatch (case-sensitive, like the server)', () => {
        expect(confirmsErasurePhrase('erase my data')).toBe(false);
        expect(confirmsErasurePhrase('Erase My Data')).toBe(false);
    });

    it('rejects altered inner whitespace or partial phrases', () => {
        expect(confirmsErasurePhrase('ERASE  MY  DATA')).toBe(false);
        expect(confirmsErasurePhrase('ERASE MY DAT')).toBe(false);
        expect(confirmsErasurePhrase('ERASE MY DATA NOW')).toBe(false);
    });
});

describe('isErasureDonationEligible — owner-only recipes are removed unless donated', () => {
    it('is FALSE for a public + published recipe (already publicly visible; donating is a no-op)', () => {
        expect(isErasureDonationEligible({ visibility: RecipeVisibility.PUBLIC, status: RecipeStatus.PUBLISHED })).toBe(
            false,
        );
    });

    it('is TRUE for a private + published recipe (owner-only by visibility)', () => {
        expect(
            isErasureDonationEligible({ visibility: RecipeVisibility.PRIVATE, status: RecipeStatus.PUBLISHED }),
        ).toBe(true);
    });

    it('is TRUE for a public + draft recipe (owner-only by status — the axes are orthogonal)', () => {
        expect(isErasureDonationEligible({ visibility: RecipeVisibility.PUBLIC, status: RecipeStatus.DRAFT })).toBe(
            true,
        );
    });

    it('is TRUE for a private + draft recipe', () => {
        expect(isErasureDonationEligible({ visibility: RecipeVisibility.PRIVATE, status: RecipeStatus.DRAFT })).toBe(
            true,
        );
    });
});

describe('selectDonatableRecipes', () => {
    const recipes = [
        { id: 'a', visibility: RecipeVisibility.PRIVATE, status: RecipeStatus.PUBLISHED },
        { id: 'b', visibility: RecipeVisibility.PUBLIC, status: RecipeStatus.PUBLISHED },
        { id: 'c', visibility: RecipeVisibility.PUBLIC, status: RecipeStatus.DRAFT },
        { id: 'd', visibility: RecipeVisibility.PRIVATE, status: RecipeStatus.DRAFT },
    ] as const;

    it('keeps only the owner-only recipes, in input order', () => {
        expect(selectDonatableRecipes(recipes).map((recipe) => recipe.id)).toEqual(['a', 'c', 'd']);
    });

    it('returns an empty list when every recipe is already publicly visible', () => {
        expect(
            selectDonatableRecipes([{ id: 'x', visibility: RecipeVisibility.PUBLIC, status: RecipeStatus.PUBLISHED }]),
        ).toEqual([]);
    });
});

describe('a private recipe that holds a private food (private foods spec section 8, F7)', () => {
    const owned = { visibility: RecipeVisibility.PRIVATE, status: RecipeStatus.PUBLISHED } as const;

    it('is not offered for donation: the server deletes it, so offering it would be a lie', () => {
        expect(isErasureDonationEligible({ ...owned, holdsPrivateFood: true })).toBe(false);
        expect(isErasureDonationEligible({ ...owned, holdsPrivateFood: false })).toBe(true);
        expect(isErasureDonationEligible(owned)).toBe(true);
    });

    it('is the blocked set: owner-only AND holding a private food, nothing else', () => {
        expect(isErasureBlockedByPrivateFood({ ...owned, holdsPrivateFood: true })).toBe(true);
        expect(isErasureBlockedByPrivateFood({ ...owned, holdsPrivateFood: false })).toBe(false);
        expect(isErasureBlockedByPrivateFood(owned)).toBe(false);
    });

    it('a public published recipe never holds one, so it is in neither set', () => {
        const publicOne = {
            visibility: RecipeVisibility.PUBLIC,
            status: RecipeStatus.PUBLISHED,
            holdsPrivateFood: true,
        };

        expect(isErasureDonationEligible(publicOne)).toBe(false);
        expect(isErasureBlockedByPrivateFood(publicOne)).toBe(false);
    });

    it('selectBlockedRecipes keeps input order', () => {
        const recipes = [
            { id: 'a', ...owned, holdsPrivateFood: true },
            { id: 'b', ...owned },
            { id: 'c', ...owned, holdsPrivateFood: true },
        ];

        expect(selectBlockedRecipes(recipes).map((recipe) => recipe.id)).toEqual(['a', 'c']);
        expect(selectDonatableRecipes(recipes).map((recipe) => recipe.id)).toEqual(['b']);
    });
});
