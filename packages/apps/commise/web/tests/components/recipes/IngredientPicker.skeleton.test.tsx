// @vitest-environment jsdom
/**
 * The ingredient picker's two WAITS, and what a viewer sees during them.
 *
 * Both used to be a single line of text over an otherwise empty panel: the typeahead's "Searching
 * ingredients" while the blended suggest call is in flight, and "Resolving…" while the food-resolution poll
 * runs after a candidate is picked. A text line in the space a LIST is about to fill is an empty flash — the
 * panel is blank, then rows appear and shove the actions below them down the page. Every other loading
 * surface in this app reserves its shape (`RecipeCardGridSkeleton` for a card grid, `RecipeCalorieSkeleton`
 * for a chip); these two now do the same with placeholder ROWS.
 *
 * ⛔ THE CAPTION STAYS, AND IT STAYS AS CONTENT. The shimmer is decorative (`aria-hidden`), so it announces
 * nothing; a `role="status"` region that is empty is both silent (a live region announces its CONTENT) and
 * zero-height. So these tests assert BOTH halves — the announcement a screen-reader user gets and the shape
 * a sighted viewer gets — because adding the second while dropping the first would look like an improvement
 * in a screenshot and be a regression in a screen reader.
 */
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FoodResolutionStatus } from '@kitchensink/recipe-core';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import type { IngredientSuggestions } from '@kitchensink/recipe-service-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithRecipeClient } from '@commise/test-utils';

import { IngredientPicker } from '@/components/recipes/IngredientPicker';

import { makeIngredient } from './__fixtures__/ingredientFixtures';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.clearAllMocks();
});

/** The blended-suggest envelope the picker consumes. */
const blended = (suggestions: IngredientSuggestions['suggestions']): IngredientSuggestions => ({
    suggestions,
    catalogAvailability: 'ok',
});

/**
 * The decorative placeholder rows inside a region. They are `aria-hidden`, so they are deliberately
 * unreachable by role/label — the DOM is the only honest way to assert a shape that announces nothing.
 */
const shimmerRowsIn = (region: HTMLElement): number => region.querySelectorAll('[aria-hidden="true"] > *').length;

describe('IngredientPicker — the typeahead wait', () => {
    it('reserves placeholder ROWS, not an empty panel, while the search is in flight', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'suggestIngredients').mockReturnValue(new Promise<IngredientSuggestions>(() => undefined));

        renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);
        await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'oli');

        const status = await screen.findByRole('status', { name: 'Searching ingredients' });

        // The announcement a screen reader gets — unchanged, and still the region's own content.
        expect(status.textContent).toContain('Searching ingredients');
        // The shape a sighted viewer gets — the rows the results are about to occupy.
        expect(shimmerRowsIn(status), 'the wait must reserve the list it is about to fill').toBeGreaterThan(1);
    });

    it('replaces the placeholder rows with the real rows once the suggestions land', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'suggestIngredients').mockResolvedValue(
            blended([{ provenance: 'local', ingredient: makeIngredient({ name: 'Olive oil' }) }]),
        );

        renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);
        await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'oli');

        expect(await screen.findByRole('button', { name: /Olive oil/u })).toBeInTheDocument();
        expect(screen.queryByRole('status', { name: 'Searching ingredients' }), 'the wait is over').toBeNull();
    });
});

describe('IngredientPicker — the resolution poll', () => {
    it('reserves a placeholder ROW while a picked candidate resolves', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'suggestIngredients').mockResolvedValue(
            blended([
                {
                    provenance: 'local',
                    ingredient: makeIngredient({
                        id: 'ing_u',
                        name: 'Quinoa',
                        foodResolutionStatus: FoodResolutionStatus.UNRESOLVED,
                    }),
                },
            ]),
        );
        vi.spyOn(client, 'getIngredientCandidates').mockResolvedValue([
            { candidateId: 'cand-a', source: 'usda', externalKey: 'k1', name: 'Quinoa, cooked', summary: 'Boiled' },
        ]);
        // The resolve never settles, so the surface stays in its `resolving` state for the assertion.
        vi.spyOn(client, 'resolveIngredient').mockReturnValue(new Promise(() => undefined));

        renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);
        await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'quin');
        await user.click(await screen.findByRole('button', { name: 'Quinoa' }));
        await user.click(await screen.findByRole('button', { name: /Quinoa, cooked/u }));

        const status = await screen.findByRole('status', { name: 'Resolving ingredient' });

        expect(status.textContent).toContain('Resolving ingredient');
        expect(shimmerRowsIn(status), 'the poll must reserve a row, not flash an empty panel').toBeGreaterThan(0);
    });
});

describe('the placeholder rows themselves', () => {
    it('are decorative and reduced-motion-safe', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'suggestIngredients').mockReturnValue(new Promise<IngredientSuggestions>(() => undefined));

        renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);
        await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'oli');

        const status = await screen.findByRole('status', { name: 'Searching ingredients' });
        const shimmer = status.querySelector('[aria-hidden="true"]');

        expect(shimmer, 'a placeholder announces nothing — the caption already did').not.toBeNull();
        expect(
            within(status).queryAllByRole('button'),
            'a placeholder is not an affordance — nothing here is clickable',
        ).toHaveLength(0);
        expect(
            shimmer?.firstElementChild?.className,
            'the shimmer honours prefers-reduced-motion, like every other skeleton here',
        ).toContain('motion-reduce:animate-none');
    });
});
