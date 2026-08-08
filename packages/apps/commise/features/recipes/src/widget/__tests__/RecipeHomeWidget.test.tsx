// @vitest-environment jsdom
/**
 * Component tests for the web recipe Home widget — its Suspense-driven states: the skeleton fallback
 * while the recipes promise is pending, the recent-recipes list once it resolves, and the empty state
 * when the viewer has none. (Loading is a `<Suspense>` boundary, not an `isLoading` flag.)
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { Recipe } from '@kitchensink/recipe-core';

import { makeRecipe } from '../../__fixtures__/index.js';
import RecipeHomeWidget from '../RecipeHomeWidget.js';

afterEach(cleanup);

describe('RecipeHomeWidget (web)', () => {
    it('shows the skeleton fallback while the recipes promise is pending', () => {
        // A promise that never settles keeps the widget suspended → the fallback is rendered.
        const { container } = render(<RecipeHomeWidget recipesPromise={new Promise<readonly Recipe[]>(() => {})} />);

        expect(screen.getByText('Recent recipes')).toBeTruthy(); // the card title
        expect(container.querySelector('[role="presentation"]')).not.toBeNull(); // the skeleton
        expect(screen.queryByRole('article')).toBeNull(); // no recipe rows yet
        expect(screen.queryByText(/No recipes yet/i)).toBeNull(); // and NOT the empty state
    });

    it('renders the recent recipes once the promise resolves', async () => {
        const recipes = [
            makeRecipe({ id: 'r1', title: 'Weeknight Pasta' }),
            makeRecipe({ id: 'r2', title: 'Chana Masala' }),
        ];

        // act flushes the promise resolution + Suspense retry so the content replaces the fallback.
        let container: HTMLElement | undefined;
        await act(async () => {
            container = render(<RecipeHomeWidget recipesPromise={Promise.resolve(recipes)} />).container;
        });

        expect(screen.getByText('Weeknight Pasta')).toBeTruthy();
        expect(screen.getByText('Chana Masala')).toBeTruthy();
        // "Skeleton gone", asserted the same way the pending case asserts "skeleton present" (line above): by
        // the skeleton's own EXPLICIT `role="presentation"` node. The previous `screen.queryByRole(
        // 'presentation')` could not fail — the skeleton is `aria-hidden`, so a role query never saw it either
        // way — and it did not distinguish the skeleton from any decorative element. It broke the moment the
        // recipe cover became a decorative `alt=""` image (#140), which is an implicit presentation role.
        expect(container?.querySelector('[role="presentation"]')).toBeNull();
    });

    it('caps the list at MAX_RECENT_RECIPES', async () => {
        const many = Array.from({ length: 8 }, (_unused, index) =>
            makeRecipe({ id: `r${index}`, title: `Recipe ${index}` }),
        );

        await act(async () => {
            render(<RecipeHomeWidget recipesPromise={Promise.resolve(many)} />);
        });

        expect(screen.getAllByRole('article')).toHaveLength(4); // MAX_RECENT_RECIPES
    });

    it('renders the empty state when the viewer has no recipes', async () => {
        await act(async () => {
            render(<RecipeHomeWidget recipesPromise={Promise.resolve<readonly Recipe[]>([])} />);
        });

        expect(screen.getByText(/No recipes yet/i)).toBeTruthy();
        expect(screen.queryByRole('article')).toBeNull();
    });

    it('lays the resolved recipes out as the mockup card GRID, not a vertical stack', async () => {
        let container!: HTMLElement;

        await act(async () => {
            ({ container } = render(
                <RecipeHomeWidget recipesPromise={Promise.resolve([makeRecipe({ id: 'r1', title: 'Ragu' })])} />,
            ));
        });

        const className = container.querySelector('ul')?.className ?? '';
        expect(className).toContain('grid-cols-2');
        expect(className).toContain('md:grid-cols-4');
    });

    it('reports the activated recipe’s id to onSelectRecipe (the navigation seam the host owns)', async () => {
        const user = userEvent.setup();
        const onSelectRecipe = vi.fn();
        const recipes = [
            makeRecipe({ id: 'r1', title: 'Weeknight Pasta' }),
            makeRecipe({ id: 'r2', title: 'Chana Masala' }),
        ];

        await act(async () => {
            render(<RecipeHomeWidget recipesPromise={Promise.resolve(recipes)} onSelectRecipe={onSelectRecipe} />);
        });

        await user.click(screen.getByRole('button', { name: 'Chana Masala' }));

        expect(onSelectRecipe).toHaveBeenCalledExactlyOnceWith('r2');
    });

    it('renders inert cards when the host supplies no onSelectRecipe (no dead buttons)', async () => {
        await act(async () => {
            render(<RecipeHomeWidget recipesPromise={Promise.resolve([makeRecipe({ id: 'r1', title: 'Ragu' })])} />);
        });

        expect(screen.getByRole('article', { name: 'Ragu' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Ragu' })).toBeNull();
    });
});
