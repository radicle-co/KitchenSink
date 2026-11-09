/**
 * Unit tests for the pure public-foods policy (ADR-0029 §4; owner rulings 2026-11-08): a recipe that is published and
 * public may hold no line bound to a private food.
 *
 * The rows a mutant must not survive:
 *
 *  1. **Only published AND public is bound.** A draft, a private recipe, or either together with private foods is
 *     allowed: that is where private foods live.
 *  2. **A denial names every private line by its position**, in line order, so the cook is told which.
 *  3. **A recipe in review is public**, and judged as public (ADR-0074): review is a derived state, not a visibility.
 */
import { describe, expect, it } from 'vitest';
import { RecipeStatus, RecipeVisibility } from '@kitchensink/recipe-core';

import { evaluatePublicFoods, type PublicFoodsLine } from '../publicFoodsPolicy.js';

const SHARED: PublicFoodsLine = { sortOrder: 0, foodId: 'f-catalog', foodOwnerId: null };
const PRIVATE_A: PublicFoodsLine = { sortOrder: 1, foodId: 'f-grandma', foodOwnerId: '01JAUTHOR' };
const PRIVATE_B: PublicFoodsLine = { sortOrder: 3, foodId: 'f-spice', foodOwnerId: '01JAUTHOR' };

describe('evaluatePublicFoods', () => {
    it('allows a draft that holds a private line', () => {
        expect(
            evaluatePublicFoods({
                status: RecipeStatus.DRAFT,
                visibility: RecipeVisibility.PUBLIC,
                lines: [PRIVATE_A],
            }),
        ).toStrictEqual({ allowed: true });
    });

    it('allows a published private recipe that holds private lines', () => {
        expect(
            evaluatePublicFoods({
                status: RecipeStatus.PUBLISHED,
                visibility: RecipeVisibility.PRIVATE,
                lines: [SHARED, PRIVATE_A],
            }),
        ).toStrictEqual({ allowed: true });
    });

    it('allows a published public recipe whose lines are all shared', () => {
        expect(
            evaluatePublicFoods({
                status: RecipeStatus.PUBLISHED,
                visibility: RecipeVisibility.PUBLIC,
                lines: [SHARED],
            }),
        ).toStrictEqual({ allowed: true });
    });

    it('allows a published public recipe with no lines at all', () => {
        expect(
            evaluatePublicFoods({ status: RecipeStatus.PUBLISHED, visibility: RecipeVisibility.PUBLIC, lines: [] }),
        ).toStrictEqual({ allowed: true });
    });

    it('denies a published public recipe with one private line, naming its position and food', () => {
        expect(
            evaluatePublicFoods({
                status: RecipeStatus.PUBLISHED,
                visibility: RecipeVisibility.PUBLIC,
                lines: [SHARED, PRIVATE_A],
            }),
        ).toStrictEqual({ allowed: false, lines: [{ sortOrder: 1, foodId: 'f-grandma' }] });
    });

    it('names EVERY private line, in line order', () => {
        const decision = evaluatePublicFoods({
            status: RecipeStatus.PUBLISHED,
            visibility: RecipeVisibility.PUBLIC,
            lines: [PRIVATE_B, SHARED, PRIVATE_A],
        });

        expect(decision).toStrictEqual({
            allowed: false,
            lines: [
                { sortOrder: 1, foodId: 'f-grandma' },
                { sortOrder: 3, foodId: 'f-spice' },
            ],
        });
    });
});
