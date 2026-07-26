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
    isErasureDonationEligible,
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
