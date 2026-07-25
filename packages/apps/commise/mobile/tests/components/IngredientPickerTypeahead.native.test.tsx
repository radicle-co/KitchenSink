/**
 * REQ-057 (ingredient-typeahead trigger threshold, debounce, and match-quality ranking) for the mobile
 * IngredientPicker, driven through the REAL `useIngredientResolver` + `useSearchIngredients` (mirrors the
 * web `IngredientPicker.test.tsx` "REQ-057 typeahead trigger, debounce, and ranking" block) rather than the
 * fully-mocked hooks `IngredientPicker.native.test.tsx` uses — kept in its OWN file because that file's
 * `vi.mock('@kitchensink/recipe-service-client/hooks', ...)` fully replaces the module (including
 * `RecipeServiceProvider`), which is incompatible with `renderWithRecipeClient`'s real-provider tree. The
 * shared hook implementing REQ-057 (`@commise/features-recipes/hooks`) is identical on both platforms
 * (CP-6/P2), so this is the mobile mirror of the web proof, not a re-derivation of it — assertions land on
 * the actual network-call boundary (`client.searchIngredients`) the debounce/threshold gate protects.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';

import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';

import { INGREDIENT_SEARCH_DEBOUNCE_MS } from '@commise/features-recipes/hooks';
import { renderWithRecipeClient } from '@commise/test-utils';

import { IngredientPicker } from '../../src/components/IngredientPicker.js';
import { makeIngredient } from '../__fixtures__/recipes.js';

afterEach(cleanup);

describe('IngredientPicker — REQ-057 typeahead trigger, debounce, and ranking', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('never calls the search endpoint below the 2-character trigger', async () => {
        const client = createFakeRecipeServiceClient();
        const searchSpy = vi.spyOn(client, 'searchIngredients').mockResolvedValue([]);

        renderWithRecipeClient(<IngredientPicker onResolve={vi.fn()} />, client);

        fireEvent.change(screen.getByLabelText('Search ingredients'), { target: { value: 's' } });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(INGREDIENT_SEARCH_DEBOUNCE_MS);
        });

        expect(searchSpy).not.toHaveBeenCalled();
    });

    // Regression (final-review Finding 1, mobile parity): mirrors the web proof above. The instant the
    // input crosses the 2-char threshold, the debounced value hasn't caught up (search still
    // `enabled: false`), so the leaf must not render its empty-state copy — that would invite a premature
    // freeform-add tap before the real search has even fired. Mobile has no distinct "searching" copy
    // (see `IngredientPicker.tsx`'s `showEmpty` — gated on `kind === 'results'`), so the observable proof
    // here is that the empty text stays ABSENT during the debounce window and only appears once it
    // genuinely settles empty.
    it('does not show the empty state during the debounce-pending window — only once it genuinely settles empty', async () => {
        const client = createFakeRecipeServiceClient();
        const searchSpy = vi.spyOn(client, 'searchIngredients').mockResolvedValue([]);

        renderWithRecipeClient(<IngredientPicker onResolve={vi.fn()} />, client);

        fireEvent.change(screen.getByLabelText('Search ingredients'), { target: { value: 'zz' } });
        // Flush React's state update WITHOUT advancing the debounce timer.
        await act(async () => {
            await Promise.resolve();
        });

        expect(screen.queryByText('No matching ingredients. Create a new one below.')).toBeNull();
        expect(searchSpy).not.toHaveBeenCalled();

        await act(async () => {
            await vi.advanceTimersByTimeAsync(INGREDIENT_SEARCH_DEBOUNCE_MS);
        });
        // The debounce timer firing only starts the fetch; let its resolved promise's microtasks (the
        // mocked client call + TanStack's own success-handling) flush through before the render settles.
        await act(async () => {
            await vi.advanceTimersByTimeAsync(0);
        });

        expect(screen.getByText('No matching ingredients. Create a new one below.')).toBeTruthy();
    });

    it('debounces rapid keystrokes into exactly ONE search call, on the settled (final) query', async () => {
        const client = createFakeRecipeServiceClient();
        const searchSpy = vi.spyOn(client, 'searchIngredients').mockResolvedValue([]);
        const input = () => screen.getByLabelText('Search ingredients');

        renderWithRecipeClient(<IngredientPicker onResolve={vi.fn()} />, client);

        for (const value of ['s', 'sp', 'spi', 'spin']) {
            fireEvent.change(input(), { target: { value } });
            await act(async () => {
                await vi.advanceTimersByTimeAsync(100);
            });
        }

        expect(searchSpy).not.toHaveBeenCalled();

        await act(async () => {
            await vi.advanceTimersByTimeAsync(INGREDIENT_SEARCH_DEBOUNCE_MS);
        });

        expect(searchSpy).toHaveBeenCalledTimes(1);
        expect(searchSpy).toHaveBeenCalledWith('spin', undefined);
    });

    // Real timers — asserts the RENDERED ranking order (already pinned at the pure/hook level in
    // `ingredientResolver.model.test.ts` and `useIngredientResolver.test.tsx`), not the debounce timing.
    it('renders results ranked prefix > substring > fuzzy, ties broken alphabetically', async () => {
        vi.useRealTimers();
        const client = createFakeRecipeServiceClient();
        const fixtureNames = ['Apple pie spice', 'Banana apple', 'Zucchini apple', 'Aplpe'];
        vi.spyOn(client, 'searchIngredients').mockResolvedValue([
            makeIngredient({ id: 'ing_fuzzy', name: 'Aplpe' }), // fuzzy — neither prefix nor substring
            makeIngredient({ id: 'ing_sub_z', name: 'Zucchini apple' }), // substring
            makeIngredient({ id: 'ing_pre', name: 'Apple pie spice' }), // prefix
            makeIngredient({ id: 'ing_sub_b', name: 'Banana apple' }), // substring (alphabetically first)
        ]);

        renderWithRecipeClient(<IngredientPicker onResolve={vi.fn()} />, client);

        fireEvent.change(screen.getByLabelText('Search ingredients'), { target: { value: 'apple' } });

        await vi.waitFor(() => {
            const rendered = screen.getAllByRole('button').map((button) => button.textContent);
            expect(rendered.filter((text) => fixtureNames.includes(text ?? ''))).toHaveLength(4);
        });

        const names = screen
            .getAllByRole('button')
            .map((button) => button.textContent)
            .filter((text): text is string => fixtureNames.includes(text ?? ''));

        expect(names).toEqual(['Apple pie spice', 'Banana apple', 'Zucchini apple', 'Aplpe']);
    });
});
