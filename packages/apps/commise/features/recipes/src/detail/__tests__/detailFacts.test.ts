/**
 * The detail page's derived facts (build spec §6.1, §6.3, rewritten for the `RecipeDetailAndroid384` board,
 * `nativeBoards/buildLists.md` items 2 to 6): the fact tiles, the cuisine eyebrow, the byline, the status row, and each
 * ingredient row's name and statuses. Pure, and read by BOTH platform leaves, so the two cannot disagree about what a
 * tile says, when one hides, or what a row is named.
 *
 * REWRITTEN IN SLICE 1 to prove the new behaviour, not edited to pass: the strip no longer has a Cook cell (the board
 * draws Total, Prep and Difficulty); the meta line is split into the cuisine eyebrow and the byline (the board puts the
 * cuisine alone above the title); and the rating moved out of the status line into the rating card, so the line keeps
 * only the owner's status.
 */
import { describe, expect, it } from 'vitest';
import { FoodResolutionStatus, RecipeStatus, RecipeVisibility } from '@kitchensink/recipe-core';

import { makeIngredientView, makeRecipeDetail } from '../../__fixtures__/index.js';
import { recipeFormMessages } from '../../form/messages.js';
import { recipeMessages } from '../../messages.js';
import { bylineMessages } from '../../byline/messages.js';
import {
    ingredientGroupRuns,
    nutritionCells,
    detailByline,
    detailEyebrow,
    detailNativeLayoutOf,
    detailStatusLine,
    detailStatCells,
    ingredientRowName,
    ingredientRowStatuses,
    isLongDescription,
    nutritionStatusLine,
} from '../detailFacts.js';

const { detail, duration, card, ingredientLineName, ingredientDetails, amountWords } = recipeMessages.en;

describe('detailStatCells', () => {
    it('reads Total, Prep and Difficulty, in that order, through the duration templates — never a Cook tile', () => {
        const cells = detailStatCells({ totalTimeMinutes: 330, prepTimeMinutes: 30 }, 'medium', {
            detail,
            duration,
            card,
        });

        expect(cells).toEqual([
            { id: 'total', label: 'Total', value: '5 h 30 min' },
            { id: 'prep', label: 'Prep', value: '30 min' },
            { id: 'difficulty', label: 'Difficulty', value: 'Medium' },
        ]);
    });

    it('hides a missing time — never "0 min" — and a missing difficulty', () => {
        const cells = detailStatCells({ totalTimeMinutes: 20, prepTimeMinutes: 0 }, undefined, {
            detail,
            duration,
            card,
        });

        // The board has no Cook tile, so a recipe with only a cook time shows its Total and nothing for Cook.
        expect(cells.map((cell) => cell.id)).toEqual(['total']);
    });
});

describe('detailEyebrow', () => {
    it('is the cuisine, alone — the byline is a line of its own', () => {
        const recipe = makeRecipeDetail({ cuisine: 'Moroccan', authorUsername: 'braise', authorDisplayName: 'Eliza' });

        expect(detailEyebrow(recipe)).toBe('Moroccan');
    });

    it('is absent for no cuisine and for a blank one', () => {
        expect(detailEyebrow(makeRecipeDetail({ cuisine: undefined }))).toBeUndefined();
        expect(detailEyebrow(makeRecipeDetail({ cuisine: '' }))).toBeUndefined();
    });
});

const byline = bylineMessages.en;

describe('detailByline', () => {
    const iso = (text: string): string => `\u2068${text}\u2069`;

    // REWRITTEN IN SLICE 2 (designer, `designAnswers.md` 2026-11-02): "by {display name}" on other cooks' recipes, until
    // recipes carry a handle. It said "by @username (Display Name)"; the handle is no longer shown beside the name.
    it('says “by Display Name” on another cook’s recipe, with no handle beside it', () => {
        const recipe = makeRecipeDetail({ authorUsername: 'braise', authorDisplayName: 'Eliza Moreno' });

        expect(detailByline(recipe, false, detail, byline)).toBe(`by ${iso('Eliza Moreno')}`);
    });

    it('falls back to the handle when the author has no display name to show', () => {
        const recipe = makeRecipeDetail({ authorUsername: 'braise', authorDisplayName: undefined });

        expect(detailByline(recipe, false, detail, byline)).toBe(`by ${iso('@braise')}`);
    });

    it('says “by Display Name”, never prefixed “@”, for an author with no username', () => {
        const recipe = makeRecipeDetail({ authorDisplayName: 'Eliza Moreno' });

        expect(detailByline(recipe, false, detail, byline)).toBe(`by ${iso('Eliza Moreno')}`);
    });

    it('says “by a former member” for an erased author — never the pseudonym', () => {
        const recipe = makeRecipeDetail({ authorDisplayName: 'user_01J9ZK8N7QF3B2X4M6T0V5C1AB' });

        expect(detailByline(recipe, false, detail, byline)).toBe('by a former member');
    });

    it('never names the viewer as the author of their own recipe', () => {
        const recipe = makeRecipeDetail({ authorUsername: 'me', authorDisplayName: 'Me' });

        expect(detailByline(recipe, true, detail, byline)).toBeUndefined();
    });

    it('is absent for an imported recipe — its source line says where it came from', () => {
        const recipe = makeRecipeDetail({ authorDisplayName: undefined, sourceAttribution: 'Serious Eats' });

        expect(detailByline(recipe, false, detail, byline)).toBeUndefined();
    });
});

describe('detailStatusLine', () => {
    it('shows the owner the visibility of a published recipe', () => {
        const recipe = makeRecipeDetail({ visibility: RecipeVisibility.PUBLIC, status: RecipeStatus.PUBLISHED });

        expect(detailStatusLine(recipe, true, { detail, card })).toEqual({
            kind: 'visibility',
            visibility: 'public',
            text: 'Public',
        });
    });

    it('shows the owner a private recipe as Private', () => {
        const recipe = makeRecipeDetail({ visibility: RecipeVisibility.PRIVATE, status: RecipeStatus.PUBLISHED });

        expect(detailStatusLine(recipe, true, { detail, card })).toEqual({
            kind: 'visibility',
            visibility: 'private',
            text: 'Private',
        });
    });

    it('shows the Draft badge for the owner’s draft instead of a visibility', () => {
        const recipe = makeRecipeDetail({ status: RecipeStatus.DRAFT, visibility: RecipeVisibility.PRIVATE });

        expect(detailStatusLine(recipe, true, { detail, card })).toEqual({ kind: 'draft', text: 'Draft' });
    });

    it('shows another cook’s viewer nothing, and carries no rating (the rating card owns it)', () => {
        const recipe = makeRecipeDetail({ averageRating: 4.8, ratingCount: 12 });

        expect(detailStatusLine(recipe, false, { detail, card })).toBeUndefined();
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

        expect(
            ingredientRowName(line, 'en', ingredientLineName, ingredientDetails.checkLabelWithDetails, amountWords),
        ).toBe('2 kg lamb shoulder, trimmed of excess fat');
    });

    /** UI Designer ruling Q5: the row shows "1½ cups", and a screen reader hears the words, never the character. */
    it('says a fraction in words, with plain spaces', () => {
        const line = makeIngredientView({
            quantity: { kind: 'exact', value: 1.5 },
            unit: 'cups',
            name: 'whole milk',
            preparation: 'warmed',
        });

        expect(
            ingredientRowName(line, 'en', ingredientLineName, ingredientDetails.checkLabelWithDetails, amountWords),
        ).toBe('1 and a half cups whole milk, warmed');
    });

    it('says a range with the range words', () => {
        const line = makeIngredientView({
            quantity: { kind: 'range', low: 0.75, high: 1 },
            unit: 'tsp',
            name: 'salt',
            preparation: undefined,
        });

        expect(
            ingredientRowName(line, 'en', ingredientLineName, ingredientDetails.checkLabelWithDetails, amountWords),
        ).toBe('three quarters to 1 tsp salt');
    });

    it('a line with no preparation is its amount and food', () => {
        const line = makeIngredientView({
            quantity: { kind: 'exact', value: 3 },
            unit: undefined,
            name: 'eggs',
            preparation: undefined,
        });

        expect(
            ingredientRowName(line, 'en', ingredientLineName, ingredientDetails.checkLabelWithDetails, amountWords),
        ).toBe('3 eggs');
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

// REWRITTEN IN SLICE 1: the page no longer has a stat strip whose cells go two to a row below 360 pt, so the layout is the
// column count, plus the room the fact tiles are drawn in (the body's width and the text scale), which the fact tiles read (`DetailFactTiles.native.test.tsx`).
describe('detailNativeLayoutOf', () => {
    it.each([
        { width: 288, columns: 'one' },
        { width: 719, columns: 'one' },
        { width: 720, columns: 'two' },
    ])('a $width pt body → $columns column(s)', ({ width, columns }) => {
        expect(detailNativeLayoutOf(width, 1)).toEqual({ columns, bodyWidth: width, textScale: 1 });
    });
});

/**
 * F9 (`evaluateFinal.md`): the recipe page dropped the ingredient groups the editor shows. The page draws a group as an
 * label over each CONSECUTIVE run of lines with one label (§6.1), the editor's fold: `[A][B][A]` is three runs in
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
 *
 * D2 (the UI walk): a recipe with NO lines is "complete" (the sum over nothing is 0), so it printed the zeros anyway.
 * D11: the figures are grouped and rounded through `Intl`, as the card's calories are.
 */
describe('nutritionCells', () => {
    const zero = { calories: 0, proteinG: 0, carbsG: 0, fatG: 0, isComplete: false };
    const oneLine = [makeIngredientView({ ingredientId: 'a' })];

    it('shows a dash in every cell when no line was counted', () => {
        const { cells, noneCounted } = nutritionCells(zero, oneLine, detail, 'en-US');

        expect(cells.map((cell) => cell.value)).toEqual(['—', '—', '—', '—']);
        expect(noneCounted).toBe(true);
    });

    it('shows the figures when anything was counted, even a partial estimate', () => {
        const { cells, noneCounted } = nutritionCells(
            { ...zero, calories: 120, proteinG: 4 },
            oneLine,
            detail,
            'en-US',
        );

        expect(cells.map((cell) => cell.value)).toEqual(['120', '4 g', '0 g', '0 g']);
        expect(noneCounted).toBe(false);
    });

    it('keeps a measured zero for a complete recipe that HAS lines (water is 0 calories)', () => {
        const { cells, noneCounted } = nutritionCells({ ...zero, isComplete: true }, oneLine, detail, 'en-US');

        expect(cells[0]?.value).toBe('0');
        expect(noneCounted).toBe(false);
    });

    it('counts nothing for a recipe with NO lines, though its sum is a "complete" zero (D2)', () => {
        const { cells, noneCounted } = nutritionCells({ ...zero, isComplete: true }, [], detail, 'en-US');

        expect(cells.map((cell) => cell.value)).toEqual(['—', '—', '—', '—']);
        expect(noneCounted).toBe(true);
    });

    it('rounds and groups the figures for the locale (D11)', () => {
        const figures = { calories: 1290.7, proteinG: 12.4, carbsG: 1287, fatG: 0.4, isComplete: true };

        expect(nutritionCells(figures, oneLine, detail, 'en-US').cells.map((cell) => cell.value)).toEqual([
            '1,291',
            '12 g',
            '1,287 g',
            '0 g',
        ]);
        expect(nutritionCells(figures, oneLine, detail, 'de-DE').cells.map((cell) => cell.value)).toEqual([
            '1.291',
            '12 g',
            '1.287 g',
            '0 g',
        ]);
    });
});

/** A-015: ONE status line under the figures, never two that contradict each other. */
describe('nutritionStatusLine', () => {
    const REVIEW = 'One ingredient didn’t match its original wording.';

    it('says nothing for a complete recipe with figures', () => {
        expect(
            nutritionStatusLine({ noneCounted: false, isComplete: true, reviewNotice: undefined }, detail),
        ).toBeUndefined();
    });

    it('says the estimate is partial when some lines count and some do not', () => {
        expect(nutritionStatusLine({ noneCounted: false, isComplete: false, reviewNotice: undefined }, detail)).toBe(
            detail.nutritionPartial,
        );
    });

    it('says no ingredient has a food when nothing was counted and nothing is withheld', () => {
        expect(nutritionStatusLine({ noneCounted: true, isComplete: false, reviewNotice: undefined }, detail)).toBe(
            detail.nutritionNoneCounted,
        );
    });

    // The contradiction: every line withheld for review is NOT "no ingredient has a food" — each has one. The review
    // notice already says what happened, so the status line stays out of its way.
    it('adds nothing when nothing was counted BECAUSE every line is withheld: the review notice says it', () => {
        expect(
            nutritionStatusLine({ noneCounted: true, isComplete: false, reviewNotice: REVIEW }, detail),
        ).toBeUndefined();
    });

    it('still says partial beside the review notice when only some lines are withheld', () => {
        expect(nutritionStatusLine({ noneCounted: false, isComplete: false, reviewNotice: REVIEW }, detail)).toBe(
            detail.nutritionPartial,
        );
    });
});
