/**
 * The web recipe page's nutrition row, matching the native one (`nativeBoards/buildLists.md` item 12;
 * `DetailNutritionSection.native.test.tsx`): a COLLAPSED disclosure reading "Nutrition" and "{n} cal per serving", or
 * "Not counted yet", that opens in place to the four figures and the caveats the stored figure carries. The page used
 * to draw an open 2x2 grid after the steps. The figure is stored on the recipe, so this row has no loading or
 * unavailable state of its own: "Not counted yet" is its empty state.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { makeIngredientView, makeNutrition, makeRecipeDetail } from '../../__fixtures__/index.js';
import { recipeMessages } from '../../messages.js';
import { DetailNutritionSection } from '../DetailNutritionSection.js';

const { detail } = recipeMessages.en;

const counted = makeRecipeDetail({
    nutrition: makeNutrition({ calories: 520 }),
    ingredients: [makeIngredientView({ ingredientId: 'a' })],
});
const uncounted = makeRecipeDetail({
    nutrition: makeNutrition({ calories: 0, proteinG: 0, carbsG: 0, fatG: 0, isComplete: false }),
    ingredients: [makeIngredientView({ ingredientId: 'a' })],
});
const partial = makeRecipeDetail({
    nutrition: makeNutrition({ calories: 520, isComplete: false }),
    ingredients: [makeIngredientView({ ingredientId: 'a' })],
});

const draw = (
    recipe = counted,
    expanded = false,
    onToggle = vi.fn(),
    dataSourcesHref: string | undefined = '/en/data-sources',
) => {
    render(
        <DetailNutritionSection
            recipe={recipe}
            expanded={expanded}
            onToggle={onToggle}
            {...(dataSourcesHref === undefined ? {} : { dataSourcesHref })}
        />,
    );

    return onToggle;
};

const row = (): HTMLElement => screen.getByRole('button', { name: /^Nutrition/u });

afterEach(cleanup);

describe('DetailNutritionSection (web) — collapsed', () => {
    it('is a button with aria-expanded false, controlling the panel, and shows no figures', () => {
        draw();

        expect(row().getAttribute('aria-expanded')).toBe('false');
        expect(row().getAttribute('aria-controls')).not.toBeNull();
        expect(screen.queryByText(detail.proteinLabel)).toBeNull();
    });

    it('reads "Nutrition" and the calories per serving', () => {
        draw();

        expect(screen.getByText('Nutrition')).toBeTruthy();
        expect(screen.getByText('520 cal per serving')).toBeTruthy();
    });

    it('reads "Not counted yet" when nothing was counted', () => {
        draw(uncounted);

        expect(screen.getByText('Not counted yet')).toBeTruthy();
    });

    it('is a heading of level 2 holding the button, so the section keeps its place in the outline', () => {
        draw();

        expect(screen.getByRole('heading', { level: 2, name: /^Nutrition/u })).toBeTruthy();
    });
});

describe('DetailNutritionSection (web) — the keyboard', () => {
    it('asks the shell to flip the disclosure on a click', () => {
        const onToggle = draw();

        fireEvent.click(row());

        expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it('is reached by Tab and flipped by Enter and by Space', async () => {
        const user = userEvent.setup();
        const onToggle = draw();

        await user.tab();
        expect(document.activeElement).toBe(row());

        await user.keyboard('{Enter}');
        await user.keyboard(' ');

        expect(onToggle).toHaveBeenCalledTimes(2);
    });
});

describe('DetailNutritionSection (web) — expanded', () => {
    it('is aria-expanded true and shows the four figures with their values', () => {
        draw(counted, true);

        expect(row().getAttribute('aria-expanded')).toBe('true');

        for (const label of [detail.caloriesLabel, detail.proteinLabel, detail.carbsLabel, detail.fatLabel]) {
            expect(screen.getByText(label)).toBeTruthy();
        }
    });

    it('shows the explanation line and NO dashes or figures when nothing was counted', () => {
        draw(uncounted, true);

        expect(screen.getByText(detail.nutritionNoneCounted)).toBeTruthy();
        expect(screen.queryByText('—')).toBeNull();
        expect(screen.queryByText(detail.caloriesLabel)).toBeNull();
    });

    it('says when only some ingredients were counted', () => {
        draw(partial, true);

        expect(screen.getByText(detail.nutritionPartial)).toBeTruthy();
    });

    it('names where the numbers came from and links the Data sources page', () => {
        draw(
            makeRecipeDetail({
                nutrition: makeNutrition({ calories: 520 }),
                ingredients: [makeIngredientView({ ingredientId: 'a', foodId: 'food_1' })],
            }),
            true,
        );

        const link = screen.getByRole('link', { name: detail.nutritionSourcesLink });

        expect(link.getAttribute('href')).toBe('/en/data-sources');
    });

    it('draws none of the detail while collapsed', () => {
        draw(partial, false);

        expect(screen.queryByText(detail.nutritionPartial)).toBeNull();
        expect(screen.queryByRole('link', { name: detail.nutritionSourcesLink })).toBeNull();
    });
});

/**
 * The row is the `card accordion` of `RecipeDetailWeb390` and `RecipeDetailWeb1024`: the paper ground and card radius the
 * ingredients card wears, a 56 high row and 16 of side padding, with the value on a second line under "Nutrition".
 */
describe('DetailNutritionSection (web) — the card', () => {
    it('is a paper card with the card radius, like the ingredients card', () => {
        draw();

        const card = screen.getByRole('region', { name: detail.nutritionHeading });

        expect(card.classList.contains('bg-paper')).toBe(true);
        expect(card.classList.contains('rounded-lg')).toBe(true);
    });

    it('is at least 56 high with 16 of side padding, collapsed and expanded', () => {
        for (const expanded of [false, true]) {
            draw(counted, expanded);

            const classes = row().classList;

            expect(classes.contains('min-h-14')).toBe(true);
            expect(classes.contains('px-4')).toBe(true);
            cleanup();
        }
    });

    it('keeps the value on its own line under the title', () => {
        draw();

        expect(screen.getByText('520 cal per serving').parentElement?.classList.contains('flex-col')).toBe(true);
    });

    it('pads the opened figures by the same 16, inside the card', () => {
        draw(counted, true);

        const panel = document.getElementById(row().getAttribute('aria-controls') ?? '');

        expect(panel?.classList.contains('px-4')).toBe(true);
    });
});

describe('DetailNutritionSection (web) — space under the summary', () => {
    it('puts 8 above the first row of figures when the row is open', () => {
        draw(counted, true);

        const figures = screen.getByText(detail.caloriesLabel).closest('dl');

        expect(figures?.classList.contains('pt-2')).toBe(true);
    });
});
