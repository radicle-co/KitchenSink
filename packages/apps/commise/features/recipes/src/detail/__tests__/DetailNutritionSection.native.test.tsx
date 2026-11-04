/**
 * The native recipe page's nutrition row, as `RecipeDetailAndroid384` draws it (`nativeBoards/buildLists.md` item 12): a
 * COLLAPSED row reading "Nutrition" and "{n} cal per serving" that expands in place to the four figures, or reads
 * "Nutrition" and "Not counted yet" when no food was counted. REWRITTEN: the section used to be an always-open heading with a
 * 2x2 grid, so the tests of that heading's role, colour and gap are gone; the rows' own styling is the design system's.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';

import { role } from '@commise/ui/colors';
import { nativeTokens } from '@commise/ui/native';
import { rgb } from '@commise/ui/testing/system-color-scheme';
import { renderWithTamagui, resolvedColour, resolvedStyle } from '@commise/ui/testing/tamagui';

import { makeIngredientView, makeNutrition, makeRecipeDetail } from '../../__fixtures__/index.js';
import { recipeMessages } from '../../messages.js';
import { DetailNutritionSection } from '../DetailNutritionSection.native.js';

const { detail } = recipeMessages.en;

const counted = makeRecipeDetail({
    nutrition: makeNutrition({ calories: 520 }),
    ingredients: [makeIngredientView({ ingredientId: 'a' })],
});
const uncounted = makeRecipeDetail({
    nutrition: makeNutrition({ calories: 0, proteinG: 0, carbsG: 0, fatG: 0, isComplete: false }),
    ingredients: [makeIngredientView({ ingredientId: 'a' })],
});

const draw = (recipe = counted, expanded = false, onToggle = vi.fn()) => {
    renderWithTamagui(
        <DetailNutritionSection
            recipe={recipe}
            expanded={expanded}
            onToggle={onToggle}
            onOpenDataSources={() => undefined}
            returnFocusSignal={0}
        />,
        'light',
    );

    return onToggle;
};

const row = (): HTMLElement => screen.getByRole('button', { name: /^Nutrition/u });

afterEach(cleanup);

describe('DetailNutritionSection (native) — the collapsed row', () => {
    it('is collapsed by default: a button with an expanded state of false and no figures', () => {
        draw();

        expect(row().getAttribute('aria-expanded')).toBe('false');
        expect(screen.queryByText(detail.caloriesLabel)).toBeNull();
        expect(screen.queryByText(detail.proteinLabel)).toBeNull();
    });

    it('reads "Nutrition" and the calories per serving', () => {
        draw();

        expect(screen.getByText('Nutrition')).toBeTruthy();
        expect(screen.getByText('520 cal per serving')).toBeTruthy();
        expect(row().getAttribute('aria-label')).toBe('Nutrition, 520 cal per serving');
    });

    it('reads "Nutrition" and "Not counted yet" when nothing was counted', () => {
        draw(uncounted);

        expect(screen.getByText('Not counted yet')).toBeTruthy();
        expect(row().getAttribute('aria-label')).toBe('Nutrition, Not counted yet');
    });

    it('asks the shell to flip the disclosure when pressed', () => {
        const onToggle = draw();

        fireEvent.click(row());

        expect(onToggle).toHaveBeenCalledTimes(1);
    });
});

describe('DetailNutritionSection (native) — expanded', () => {
    it('is a button with an expanded state of true, and shows the four figures', () => {
        draw(counted, true);

        expect(row().getAttribute('aria-expanded')).toBe('true');

        for (const label of [detail.caloriesLabel, detail.proteinLabel, detail.carbsLabel, detail.fatLabel]) {
            expect(screen.getByLabelText(new RegExp(`^${label},`, 'u'))).toBeTruthy();
        }
    });

    it('shows the explanation lines and NO dashes when nothing was counted', () => {
        draw(uncounted, true);

        expect(screen.getByText(detail.nutritionNoneCounted)).toBeTruthy();
        expect(screen.queryByText('—')).toBeNull();
        expect(screen.queryByText(detail.caloriesLabel)).toBeNull();
    });
});

/**
 * The row is the `card accordion` of `RecipeDetailWeb390` and `RecipeDetailWeb1024` (web mirrors it): the paper ground and
 * card radius the ingredients card wears, a 56 high row and 16 of side padding. The value stays on a second line.
 */
describe('DetailNutritionSection (native) — the card', () => {
    // The press wrapper sits between the button and the card.
    const card = (): HTMLElement => row().parentElement?.parentElement as HTMLElement;

    it('is a paper card with the card radius', () => {
        draw();

        expect(resolvedColour(card(), 'backgroundColor')).toBe(rgb(role.paper));
        expect(resolvedStyle(card(), 'borderRadius')).toBe(`${nativeTokens.radius.lg}px`);
    });

    it('pads 16 at the sides and holds a row at least 56 high, collapsed and expanded', () => {
        for (const expanded of [false, true]) {
            draw(counted, expanded);

            const heights = [...card().querySelectorAll('*')].map((node) => resolvedStyle(node, 'minHeight'));

            expect(resolvedStyle(card(), 'paddingLeft')).toBe(`${nativeTokens.spacing[4]}px`);
            expect(resolvedStyle(card(), 'paddingRight')).toBe(`${nativeTokens.spacing[4]}px`);
            expect(heights).toContain('56px');
            cleanup();
        }
    });
});
