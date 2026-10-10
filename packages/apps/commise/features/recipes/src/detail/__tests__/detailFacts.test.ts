/**
 * The detail page's derived facts (build spec §6.1, §6.3): the stat strip, the meta line, the rating line, and each
 * ingredient row's name and statuses. Pure, and read by BOTH platform leaves, so the two cannot disagree about what a
 * cell says, when one hides, or what a row is named.
 */
import { describe, expect, it } from 'vitest';
import { FoodResolutionStatus, RecipeStatus, RecipeVisibility } from '@kitchensink/recipe-core';

import { makeIngredientView, makeRecipeDetail } from '../../__fixtures__/index.js';
import { recipeFormMessages } from '../../form/messages.js';
import { recipeMessages } from '../../messages.js';
import {
    ingredientGroupRuns,
    nutritionCells,
    detailMetaItems,
    detailNativeLayoutOf,
    detailRatingLine,
    detailStatCells,
    ingredientRowName,
    ingredientRowStatuses,
    isLongDescription,
} from '../detailFacts.js';

const { detail, duration, card, ingredientLineName, ingredientDetails } = recipeMessages.en;

describe('detailStatCells', () => {
    it('reads Total, Prep, Cook and Difficulty, in that order, through the duration templates', () => {
        const cells = detailStatCells({ totalTimeMinutes: 330, prepTimeMinutes: 30, cookTimeMinutes: 300 }, 'medium', {
            detail,
            duration,
            card,
        });

        expect(cells).toEqual([
            { id: 'total', label: 'Total', value: '5 h 30 min' },
            { id: 'prep', label: 'Prep', value: '30 min' },
            { id: 'cook', label: 'Cook', value: '5 h' },
            { id: 'difficulty', label: 'Difficulty', value: 'Medium', level: 'medium' },
        ]);
    });

    it('hides a missing time — never "0 min" — and a missing difficulty', () => {
        const cells = detailStatCells({ totalTimeMinutes: 20, prepTimeMinutes: 0, cookTimeMinutes: 20 }, undefined, {
            detail,
            duration,
            card,
        });

        expect(cells.map((cell) => cell.id)).toEqual(['total', 'cook']);
    });
});

describe('detailMetaItems', () => {
    it('shows the cuisine and, on another cook’s recipe, the author', () => {
        const recipe = makeRecipeDetail({ cuisine: 'Moroccan', authorHandle: 'braise.club' });

        expect(detailMetaItems(recipe, false, detail)).toEqual(['Moroccan', 'by @braise.club']);
    });

    it('never names the viewer as the author of their own recipe', () => {
        const recipe = makeRecipeDetail({ cuisine: 'Moroccan', authorHandle: 'me' });

        expect(detailMetaItems(recipe, true, detail)).toEqual(['Moroccan']);
    });

    it('is empty with neither a cuisine nor a handle', () => {
        const recipe = makeRecipeDetail({ cuisine: undefined, authorHandle: undefined });

        expect(detailMetaItems(recipe, false, detail)).toEqual([]);
    });
});

describe('detailRatingLine', () => {
    it('states the average and count, and the owner sees the visibility', () => {
        const recipe = makeRecipeDetail({
            averageRating: 4.8,
            ratingCount: 12,
            visibility: RecipeVisibility.PUBLIC,
            status: RecipeStatus.PUBLISHED,
        });

        expect(detailRatingLine(recipe, true, 'en', { detail, card })).toEqual({
            rating: { stars: 4.8, text: '4.8 (12)' },
            status: { kind: 'visibility', visibility: 'public', text: 'Public' },
        });
    });

    it('shows the Draft badge for the owner’s draft instead of a visibility', () => {
        const recipe = makeRecipeDetail({ status: RecipeStatus.DRAFT, visibility: RecipeVisibility.PRIVATE });

        expect(detailRatingLine(recipe, true, 'en', { detail, card }).status).toEqual({ kind: 'draft', text: 'Draft' });
    });

    it('shows another cook’s viewer no visibility, and an unrated recipe no stars', () => {
        const recipe = makeRecipeDetail({ averageRating: undefined, ratingCount: 0 });

        expect(detailRatingLine(recipe, false, 'en', { detail, card })).toEqual({
            rating: undefined,
            status: undefined,
        });
    });
});

describe('ingredientRowName', () => {
    it('names the whole line: amount, food and preparation', () => {
        const line = makeIngredientView({
            quantity: { kind: 'exact', value: 2 },
            unit: 'kg',
            name: 'lamb shoulder',
            preparation: 'trimmed of excess fat',
        });

        expect(ingredientRowName(line, 'en', ingredientLineName, ingredientDetails.checkLabelWithDetails)).toBe(
            '2 kg lamb shoulder, trimmed of excess fat',
        );
    });

    it('a line with no preparation is its amount and food', () => {
        const line = makeIngredientView({
            quantity: { kind: 'exact', value: 3 },
            unit: undefined,
            name: 'eggs',
            preparation: undefined,
        });

        expect(ingredientRowName(line, 'en', ingredientLineName, ingredientDetails.checkLabelWithDetails)).toBe(
            '3 eggs',
        );
    });
});

describe('ingredientRowStatuses', () => {
    it('lists each status the line carries, in order', () => {
        const line = makeIngredientView({ isUserEntered: true, resolutionStatus: FoodResolutionStatus.NEEDS_REVIEW });

        expect(ingredientRowStatuses(line, false, detail)).toEqual([
            { tone: 'note', text: 'Your own food' },
            { tone: 'attention', text: 'Needs review' },
        ]);
    });

    it('drops the removed-food badge when every line is removed', () => {
        const line = makeIngredientView({ resolutionStatus: FoodResolutionStatus.FOOD_REMOVED, name: 'butter' });

        expect(ingredientRowStatuses(line, false, detail)).toEqual([
            { tone: 'attention', text: 'Food no longer listed' },
        ]);
        expect(ingredientRowStatuses(line, true, detail)).toEqual([]);
    });

    // F19 (`evaluateFinal.md`): the page said "Needs a pick", a word the glossary retires (§2.1). The page and the
    // editor's rows now say the same words, read from the editor's row-state keys.
    it('names an unpicked line with the editor row’s glossary word', () => {
        const line = makeIngredientView({ resolutionStatus: FoodResolutionStatus.AMBIGUOUS });

        expect(ingredientRowStatuses(line, false, detail)).toEqual([{ tone: 'attention', text: 'Choose a match' }]);
    });

    // The page's two line words are the editor row's words (glossary §2.1). Two keys in two catalogues, so this pins
    // them together: a reworded row state that left the page behind would fail here.
    it('says exactly what the editor row says for an unpicked and a withdrawn food', () => {
        expect(detail.ambiguousBadge).toBe(recipeFormMessages.en.rowStateChooseMatch);
        expect(detail.removedFoodBadge).toBe(recipeFormMessages.en.rowStateFoodRemoved);
    });
});

describe('isLongDescription', () => {
    it.each([
        { length: 180, expected: false },
        { length: 181, expected: true },
    ])('$length characters → $expected', ({ length, expected }) => {
        expect(isLongDescription('a'.repeat(length))).toBe(expected);
    });
});

describe('detailNativeLayoutOf', () => {
    it.each([
        { width: 288, columns: 'one', statsPerRow: 2 },
        { width: 359, columns: 'one', statsPerRow: 2 },
        { width: 360, columns: 'one', statsPerRow: 4 },
        { width: 719, columns: 'one', statsPerRow: 4 },
        { width: 720, columns: 'two', statsPerRow: 4 },
    ])('a $width pt body → $columns column(s), $statsPerRow stats a row', ({ width, columns, statsPerRow }) => {
        expect(detailNativeLayoutOf(width)).toEqual({ columns, statsPerRow });
    });
});

/**
 * F9 (`evaluateFinal.md`): the recipe page dropped the ingredient groups the editor shows. The page draws a group as an
 * overline over each CONSECUTIVE run of lines with one label (§6.1), the editor's fold: `[A][B][A]` is three runs in
 * that order, never two, because grouping by label would reorder the recipe.
 */
describe('ingredientGroupRuns', () => {
    it('folds consecutive lines with one label into one run, in stored order', () => {
        const lines = [
            makeIngredientView({ ingredientId: 'a', groupLabel: 'For the lamb' }),
            makeIngredientView({ ingredientId: 'b', groupLabel: 'For the lamb' }),
            makeIngredientView({ ingredientId: 'c', groupLabel: 'For the chickpeas' }),
            makeIngredientView({ ingredientId: 'd', groupLabel: 'For the lamb' }),
        ];

        expect(
            ingredientGroupRuns(lines).map((run) => [run.label, run.lines.map((line) => line.ingredientId)]),
        ).toEqual([
            ['For the lamb', ['a', 'b']],
            ['For the chickpeas', ['c']],
            ['For the lamb', ['d']],
        ]);
    });

    it('gives an ungrouped recipe one run with no label, so it draws no heading', () => {
        const runs = ingredientGroupRuns([
            makeIngredientView({ ingredientId: 'a' }),
            makeIngredientView({ ingredientId: 'b' }),
        ]);

        expect(runs).toHaveLength(1);
        expect(runs[0]?.label).toBeUndefined();
    });

    it('reads a blank label as no group', () => {
        expect(ingredientGroupRuns([makeIngredientView({ groupLabel: '   ' })])[0]?.label).toBeUndefined();
    });

    it('answers no runs for no lines', () => {
        expect(ingredientGroupRuns([])).toEqual([]);
    });
});

/**
 * F17 (`evaluateFinal.md`; `buildSpec.md` §6.7 "Nutrition unavailable"): a recipe whose lines count nothing showed
 * "0 / 0 g / 0 g / 0 g", which reads as a measured zero. Nothing counted shows "—" in each cell and one line.
 */
describe('nutritionCells', () => {
    const zero = { calories: 0, proteinG: 0, carbsG: 0, fatG: 0, isComplete: false };

    it('shows a dash in every cell when no line was counted', () => {
        const { cells, noneCounted } = nutritionCells(zero, detail);

        expect(cells.map((cell) => cell.value)).toEqual(['—', '—', '—', '—']);
        expect(noneCounted).toBe(true);
    });

    it('shows the figures when anything was counted, even a partial estimate', () => {
        const { cells, noneCounted } = nutritionCells({ ...zero, calories: 120, proteinG: 4 }, detail);

        expect(cells.map((cell) => cell.value)).toEqual(['120', '4 g', '0 g', '0 g']);
        expect(noneCounted).toBe(false);
    });

    it('keeps a measured zero for a complete recipe (water is 0 calories)', () => {
        expect(nutritionCells({ ...zero, isComplete: true }, detail).cells[0]?.value).toBe('0');
    });
});
