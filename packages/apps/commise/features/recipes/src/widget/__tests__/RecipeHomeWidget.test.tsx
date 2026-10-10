// @vitest-environment jsdom
/**
 * The web Home "Recent recipes" block (`docs/design/uiOverhaul/buildSpec.md` §4.2, owner ruling D8): its heading with
 * "See all", up to four cards in the variant the host decided (compact below a 960 container, the full grid card from
 * 960), the first run with its three ways in, the loading skeletons and the load error with Try again.
 *
 * ⚠️ REWRITTEN for slice 4 of the UI overhaul, with the per-component tests of the pieces it composes
 * (`RecentRecipeGrid`, `RecentRecipeItem`, `RecipeWidgetCard`, `RecipeWidgetEmptyState`, `RecipeWidgetSkeleton`) moved
 * here: the block is now one heading row, one grid in a decided variant, and a first run with actions, so its states are
 * tested through the entry the host mounts. The Suspense and `renderNutrition` hop assertions are kept.
 */
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@commise/i18n/react';
import type { Recipe } from '@kitchensink/recipe-core';

import { makeRecipe } from '../../__fixtures__/index.js';
import { RecipeWidgetLoadError } from '../../components/RecipeWidgetLoadError.js';
import { RecipeWidgetLoadingCard } from '../../components/RecipeWidgetLoadingCard.js';
import RecipeHomeWidget, { type RecipeHomeWidgetProps } from '../RecipeHomeWidget.js';

afterEach(cleanup);

const fourRecipes = ['r1', 'r2', 'r3', 'r4', 'r5'].map((id) => makeRecipe({ id, title: `Recipe ${id}` }));

async function renderWidget(props: Partial<RecipeHomeWidgetProps> = {}) {
    await act(async () => {
        render(
            <LocaleProvider locale="en">
                <RecipeHomeWidget recipesPromise={Promise.resolve(fourRecipes)} variant="compact" {...props} />
            </LocaleProvider>,
        );
    });
}

describe('RecipeHomeWidget (web) — recent recipes', () => {
    it('heads the block with "Recent recipes" as an H2', async () => {
        await renderWidget();

        expect(screen.getByRole('heading', { level: 2, name: 'Recent recipes' })).toBeTruthy();
    });

    it('shows at most four cards, in the variant the host decided', async () => {
        await renderWidget({ variant: 'grid' });
        const cards = screen.getAllByRole('article');

        expect(cards).toHaveLength(4);
        expect(cards.map((card) => card.getAttribute('data-card-variant'))).toEqual(['grid', 'grid', 'grid', 'grid']);
    });

    it('lays the cards out in Home’s grid: 2 × 2 on a phone, one row of four from 600', async () => {
        await renderWidget();
        const list = screen.getByRole('list');

        expect(list.className).toContain('grid-cols-2');
        expect(list.className).toContain('@regular/main:grid-cols-4');
    });

    it('offers "See all", named "See all recipes", at the end of the heading row', async () => {
        const onPress = vi.fn();
        await renderWidget({ seeAll: { href: '/en/recipes', onPress } });

        const link = screen.getByRole('link', { name: 'See all recipes' });
        expect(link.textContent).toBe('See all');
        expect(link.getAttribute('href')).toBe('/en/recipes');

        await userEvent.click(link);

        expect(onPress).toHaveBeenCalledTimes(1);
    });

    it('makes each card a link when the host gives an href, reporting a plain click', async () => {
        const onSelectRecipe = vi.fn();
        await renderWidget({ onSelectRecipe, hrefOf: (id) => `/en/recipes/${id}` });

        await userEvent.click(screen.getByRole('link', { name: 'Recipe r2' }));

        expect(onSelectRecipe).toHaveBeenCalledWith('r2');
    });

    it('renders inert cards with no onSelectRecipe and no href', async () => {
        await renderWidget();

        expect(within(screen.getByRole('list')).queryByRole('link')).toBeNull();
        expect(within(screen.getByRole('list')).queryByRole('button')).toBeNull();
    });

    it('⛔ calls renderNutrition once per card with its own id, across the Suspense hop', async () => {
        const renderNutrition = vi.fn((recipeId: string) => <span>{`kcal:${recipeId}`}</span>);
        await renderWidget({ variant: 'grid', renderNutrition });

        expect(renderNutrition.mock.calls.map(([id]) => id)).toStrictEqual(['r1', 'r2', 'r3', 'r4']);
        expect(screen.getByText('kcal:r3')).toBeTruthy();
    });

    it('shows the loading skeletons while the promise is pending, under the real heading', () => {
        render(
            <LocaleProvider locale="en">
                <RecipeHomeWidget recipesPromise={new Promise<readonly Recipe[]>(() => undefined)} variant="compact" />
            </LocaleProvider>,
        );

        expect(screen.getByRole('heading', { level: 2, name: 'Recent recipes' })).toBeTruthy();
        expect(screen.getByRole('status').textContent).toContain('Loading recipes');
    });
});

describe('RecipeHomeWidget (web) — the first run', () => {
    it('says where recipes will show, offers the three ways in, and drops "See all"', async () => {
        const onCreateRecipe = vi.fn();
        const onPasteIngredients = vi.fn();
        const onFindOnDiscover = vi.fn();
        await renderWidget({
            recipesPromise: Promise.resolve([]),
            seeAll: { href: '/en/recipes', onPress: vi.fn() },
            firstRun: { onCreateRecipe, onPasteIngredients, onFindOnDiscover, discoverHref: '/en/discover' },
        });

        expect(screen.getByText('Your recipes will show up here.')).toBeTruthy();
        expect(screen.queryByRole('link', { name: 'See all recipes' })).toBeNull();

        await userEvent.click(screen.getByRole('button', { name: 'Add your first recipe' }));
        await userEvent.click(screen.getByRole('button', { name: 'Paste ingredients' }));
        await userEvent.click(screen.getByRole('link', { name: 'Or find one on Discover' }));

        expect(onCreateRecipe).toHaveBeenCalledTimes(1);
        expect(onPasteIngredients).toHaveBeenCalledTimes(1);
        expect(onFindOnDiscover).toHaveBeenCalledTimes(1);
    });

    it('still says where recipes will show when the host offers no actions', async () => {
        await renderWidget({ recipesPromise: Promise.resolve([]) });

        expect(screen.getByText('Your recipes will show up here.')).toBeTruthy();
        expect(screen.queryByRole('button')).toBeNull();
    });
});

describe('the Home recent block’s own fallbacks (web)', () => {
    it('loading: four skeletons of the variant in use, under the heading', () => {
        const { container } = render(
            <LocaleProvider locale="en">
                <RecipeWidgetLoadingCard variant="grid" />
            </LocaleProvider>,
        );

        expect(screen.getByRole('heading', { level: 2, name: 'Recent recipes' })).toBeTruthy();
        expect(container.querySelectorAll('[data-skeleton-variant="grid"]')).toHaveLength(4);
    });

    it('load error: says so under the heading, with Try again', async () => {
        const onRetry = vi.fn();
        render(
            <LocaleProvider locale="en">
                <RecipeWidgetLoadError onRetry={onRetry} />
            </LocaleProvider>,
        );

        expect(screen.getByRole('heading', { level: 2, name: 'Recent recipes' })).toBeTruthy();
        expect(screen.getByText('We couldn’t load your recent recipes.')).toBeTruthy();

        await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('load error with no retry: says so, with no dead button', () => {
        render(
            <LocaleProvider locale="en">
                <RecipeWidgetLoadError />
            </LocaleProvider>,
        );

        expect(screen.queryByRole('button')).toBeNull();
    });
});
