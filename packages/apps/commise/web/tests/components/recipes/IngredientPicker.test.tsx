/**
 * Component tests for IngredientPicker (T067 web ingredient typeahead). Covers every state the picker
 * renders: idle (no query → no results region), searching (loading), populated results → select resolves a
 * line, empty results, search error, freeform create → resolves a line, the terminal NOT_FOUND status
 * (surfaced + freeform fallback offered, per FR-007), the addByName async-resolution entry point (R5), and
 * the full UNRESOLVED disambiguation matrix. Queries use role/label/text only.
 *
 * Migrated (CP-6 T3) off `vi.mock('@kitchensink/recipe-service-client/hooks', ...)` onto the type-checked
 * fake-client seam: `renderWithRecipeClient` mounts the picker through the REAL `useIngredientResolver`
 * (`@commise/features-recipes/hooks`), the real query/mutation hooks it composes, and a real,
 * network-guarded `RecipeServiceClient` (`createFakeRecipeServiceClient`), stubbed per test with
 * type-checked `vi.spyOn(client, '<method>')`. `useIngredientResolver` has no debounce and mounts all five
 * hooks unconditionally (gated only by TanStack's own `enabled`), so the full idle → searching → results /
 * terminal → disambiguating → resolving matrix drives cleanly through a live `QueryClient` with
 * `findBy*`/`waitFor` — no forced hook-state shortcuts were needed here.
 */
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FoodResolutionStatus } from '@kitchensink/recipe-core';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import type { RecipeServiceClient } from '@kitchensink/recipe-service-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithRecipeClient } from '@commise/test-utils';

import { IngredientPicker } from '@/components/recipes/IngredientPicker';

import { makeIngredient } from './__fixtures__/ingredientFixtures';

afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
});

describe('IngredientPicker', () => {
    it('shows no results region until the search box has a query', () => {
        const client = createFakeRecipeServiceClient();

        renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);

        expect(screen.getByRole('searchbox', { name: 'Search ingredients' })).toBeInTheDocument();
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('renders a loading indicator while the search is in flight', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'searchIngredients').mockReturnValue(new Promise(() => {}));

        renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);

        await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'oli');

        expect(await screen.findByRole('status', { name: 'Searching ingredients' })).toBeInTheDocument();
    });

    it('selects a catalog match, resolving the line to its ingredientId + name', async () => {
        const user = userEvent.setup();
        const onSelect = vi.fn();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'searchIngredients').mockResolvedValue([
            makeIngredient({ id: 'ing_9', name: 'Olive oil', foodResolutionStatus: FoodResolutionStatus.RESOLVED }),
        ]);

        renderWithRecipeClient(<IngredientPicker onSelect={onSelect} />, client);

        await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'oli');
        await user.click(await screen.findByRole('button', { name: 'Olive oil' }));

        expect(onSelect).toHaveBeenCalledWith({
            ingredientId: 'ing_9',
            name: 'Olive oil',
            quantity: 1,
            resolutionStatus: FoodResolutionStatus.RESOLVED,
        });
    });

    it('shows an empty state and a freeform option when nothing matches', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'searchIngredients').mockResolvedValue([]);

        renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);

        await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'zzz');

        expect(await screen.findByText('No matching ingredients found.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Add “zzz” as a custom ingredient' })).toBeInTheDocument();
    });

    it('surfaces a search error', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'searchIngredients').mockRejectedValue(new Error('network down'));

        renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);

        await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'oli');

        expect(await screen.findByRole('alert')).toHaveTextContent('We couldn’t search ingredients.');
    });

    it('creates a freeform ingredient and resolves the line to the new id + status', async () => {
        const user = userEvent.setup();
        const onSelect = vi.fn();
        const created = makeIngredient({
            id: 'ing_new',
            name: 'Heirloom tomato',
            isUserEntered: true,
            foodResolutionStatus: FoodResolutionStatus.PENDING,
        });
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'searchIngredients').mockResolvedValue([]);
        vi.spyOn(client, 'createIngredient').mockResolvedValue(created);

        renderWithRecipeClient(<IngredientPicker onSelect={onSelect} />, client);

        await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'Heirloom tomato');
        await user.click(await screen.findByRole('button', { name: 'Add “Heirloom tomato” as a custom ingredient' }));

        expect(onSelect).toHaveBeenCalledWith({
            ingredientId: 'ing_new',
            name: 'Heirloom tomato',
            quantity: 1,
            resolutionStatus: FoodResolutionStatus.PENDING,
        });
    });

    it('surfaces a terminal NOT_FOUND match and still offers the freeform fallback (FR-007)', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'searchIngredients').mockResolvedValue([
            makeIngredient({
                id: 'ing_x',
                name: 'Mystery spice',
                foodResolutionStatus: FoodResolutionStatus.NOT_FOUND,
            }),
        ]);

        renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);

        await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'mystery');

        expect(await screen.findByText('No match found')).toBeInTheDocument();
        expect(screen.getByRole('note')).toHaveTextContent(/custom ingredient or remove it/i);
        expect(screen.getByRole('button', { name: 'Add “mystery” as a custom ingredient' })).toBeInTheDocument();
    });

    describe('addByName — the async-resolution entry point (R5)', () => {
        it('offers "Find nutrition for …" (addByName) as the PRIMARY action for a typed name', async () => {
            const user = userEvent.setup();
            const client = createFakeRecipeServiceClient();
            vi.spyOn(client, 'searchIngredients').mockResolvedValue([]);

            renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);

            await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'zzz');

            // Both the primary (find nutrition) and the fallback (custom ingredient) are available.
            expect(await screen.findByRole('button', { name: 'Find nutrition for “zzz”' })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Add “zzz” as a custom ingredient' })).toBeInTheDocument();
        });

        it('addByName adds a PENDING line the container will poll — via addByName, NOT createFreeform', async () => {
            const user = userEvent.setup();
            const onSelect = vi.fn();
            const client = createFakeRecipeServiceClient();
            vi.spyOn(client, 'searchIngredients').mockResolvedValue([]);
            const addByNameSpy = vi.spyOn(client, 'addIngredientByName').mockResolvedValue(
                makeIngredient({
                    id: 'ing_food',
                    name: 'Quinoa',
                    foodResolutionStatus: FoodResolutionStatus.PENDING,
                }),
            );
            const createSpy = vi.spyOn(client, 'createIngredient');

            renderWithRecipeClient(<IngredientPicker onSelect={onSelect} />, client);
            await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'Quinoa');
            await user.click(await screen.findByRole('button', { name: 'Find nutrition for “Quinoa”' }));

            // The line is added PENDING (the container polls it to RESOLVED).
            await vi.waitFor(() =>
                expect(onSelect).toHaveBeenCalledWith({
                    ingredientId: 'ing_food',
                    name: 'Quinoa',
                    quantity: 1,
                    resolutionStatus: FoodResolutionStatus.PENDING,
                }),
            );
            // Mutation guard: the primary add path MUST call addByName (the food-resolving route) with the
            // typed name — a regression that routed it to createFreeform (the plain freeform create) fails
            // BOTH lines.
            expect(addByNameSpy).toHaveBeenCalledWith('Quinoa');
            expect(createSpy).not.toHaveBeenCalled();
        });

        it('addByName that comes back UNRESOLVED opens disambiguation instead of adding a line', async () => {
            const user = userEvent.setup();
            const onSelect = vi.fn();
            const client = createFakeRecipeServiceClient();
            vi.spyOn(client, 'searchIngredients').mockResolvedValue([]);
            vi.spyOn(client, 'addIngredientByName').mockResolvedValue(
                makeIngredient({ id: 'ing_u', name: 'Pepper', foodResolutionStatus: FoodResolutionStatus.UNRESOLVED }),
            );
            vi.spyOn(client, 'getIngredientCandidates').mockResolvedValue([
                { candidateId: 'cand-a', source: 'usda', externalKey: 'k1', name: 'Black pepper', summary: null },
            ]);

            renderWithRecipeClient(<IngredientPicker onSelect={onSelect} />, client);
            await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'Pepper');
            await user.click(await screen.findByRole('button', { name: 'Find nutrition for “Pepper”' }));

            // No line yet — the UNRESOLVED add routes into disambiguation (keyed on the new food-backed id).
            expect(await screen.findByRole('group', { name: 'Which “Pepper” did you mean?' })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: /Black pepper/ })).toBeInTheDocument();
            expect(onSelect).not.toHaveBeenCalled();
        });

        it('surfaces an addByName failure and keeps the freeform fallback available', async () => {
            const user = userEvent.setup();
            const client = createFakeRecipeServiceClient();
            vi.spyOn(client, 'searchIngredients').mockResolvedValue([]);
            vi.spyOn(client, 'addIngredientByName').mockRejectedValue(new Error('network down'));

            renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);
            await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'zzz');
            await user.click(await screen.findByRole('button', { name: 'Find nutrition for “zzz”' }));

            expect(await screen.findByRole('alert')).toHaveTextContent(/couldn’t add that ingredient/i);
            expect(screen.getByRole('button', { name: 'Add “zzz” as a custom ingredient' })).toBeInTheDocument();
        });
    });

    describe('UNRESOLVED disambiguation (R5)', () => {
        const CANDIDATE = {
            candidateId: 'cand-a',
            source: 'usda',
            externalKey: 'k1',
            name: 'Quinoa, cooked',
            summary: 'Boiled',
        };

        /** Stubs the client's search to return a single UNRESOLVED match named "Quinoa". */
        function searchWithUnresolved(client: RecipeServiceClient): void {
            vi.spyOn(client, 'searchIngredients').mockResolvedValue([
                makeIngredient({ id: 'ing_u', name: 'Quinoa', foodResolutionStatus: FoodResolutionStatus.UNRESOLVED }),
            ]);
        }

        it('opens the disambiguation panel (candidates), and does NOT resolve the line yet', async () => {
            const user = userEvent.setup();
            const onSelect = vi.fn();
            const client = createFakeRecipeServiceClient();
            searchWithUnresolved(client);
            vi.spyOn(client, 'getIngredientCandidates').mockResolvedValue([CANDIDATE]);

            renderWithRecipeClient(<IngredientPicker onSelect={onSelect} />, client);
            await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'quin');
            await user.click(await screen.findByRole('button', { name: 'Quinoa' }));

            // The line is NOT added on the UNRESOLVED click — disambiguation is required first.
            expect(screen.getByRole('group', { name: 'Which “Quinoa” did you mean?' })).toBeInTheDocument();
            expect(await screen.findByRole('button', { name: /Quinoa, cooked/ })).toBeInTheDocument();
            expect(onSelect).not.toHaveBeenCalled();
        });

        it('resolves the line from the picked candidate — sending the RIGHT candidate id', async () => {
            const user = userEvent.setup();
            const onSelect = vi.fn();
            const client = createFakeRecipeServiceClient();
            searchWithUnresolved(client);
            vi.spyOn(client, 'getIngredientCandidates').mockResolvedValue([
                CANDIDATE,
                { ...CANDIDATE, candidateId: 'cand-b', name: 'Quinoa, raw' },
            ]);
            const resolved = makeIngredient({
                id: 'ing_u',
                name: 'Quinoa',
                foodResolutionStatus: FoodResolutionStatus.RESOLVED,
            });
            const resolveSpy = vi.spyOn(client, 'resolveIngredient').mockResolvedValue(resolved);

            renderWithRecipeClient(<IngredientPicker onSelect={onSelect} />, client);
            await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'quin');
            await user.click(await screen.findByRole('button', { name: 'Quinoa' }));
            await user.click(await screen.findByRole('button', { name: /Quinoa, cooked/ }));

            await vi.waitFor(() =>
                expect(onSelect).toHaveBeenCalledWith({
                    ingredientId: 'ing_u',
                    name: 'Quinoa',
                    quantity: 1,
                    resolutionStatus: FoodResolutionStatus.RESOLVED,
                }),
            );
            // Mutation guard: the picked candidate's id must be the one sent — picking "cooked" (cand-a),
            // not "raw" (cand-b). A wrong/swapped id fails here.
            expect(resolveSpy).toHaveBeenCalledWith('ing_u', ['cand-a']);
        });

        it('shows a loading indicator while candidates load', async () => {
            const user = userEvent.setup();
            const client = createFakeRecipeServiceClient();
            searchWithUnresolved(client);
            vi.spyOn(client, 'getIngredientCandidates').mockReturnValue(new Promise(() => {}));

            renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);
            await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'quin');
            await user.click(await screen.findByRole('button', { name: 'Quinoa' }));

            expect(await screen.findByRole('status', { name: 'Loading options' })).toBeInTheDocument();
        });

        it('surfaces a candidates-load error', async () => {
            const user = userEvent.setup();
            const client = createFakeRecipeServiceClient();
            searchWithUnresolved(client);
            vi.spyOn(client, 'getIngredientCandidates').mockRejectedValue(new Error('network down'));

            renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);
            await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'quin');
            await user.click(await screen.findByRole('button', { name: 'Quinoa' }));

            expect(await screen.findByRole('alert')).toHaveTextContent('We couldn’t load options for that ingredient.');
        });

        it('offers the freeform fallback when there are no candidates to choose from', async () => {
            const user = userEvent.setup();
            const client = createFakeRecipeServiceClient();
            searchWithUnresolved(client);
            vi.spyOn(client, 'getIngredientCandidates').mockResolvedValue([]);

            renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);
            await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'quin');
            await user.click(await screen.findByRole('button', { name: 'Quinoa' }));

            expect(await screen.findByText(/No options to choose from/)).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Add “Quinoa” as a custom ingredient' })).toBeInTheDocument();
        });

        it('surfaces a resolve failure without adding a line', async () => {
            const user = userEvent.setup();
            const onSelect = vi.fn();
            const client = createFakeRecipeServiceClient();
            searchWithUnresolved(client);
            vi.spyOn(client, 'getIngredientCandidates').mockResolvedValue([CANDIDATE]);
            vi.spyOn(client, 'resolveIngredient').mockRejectedValue(new Error('network down'));

            renderWithRecipeClient(<IngredientPicker onSelect={onSelect} />, client);
            await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'quin');
            await user.click(await screen.findByRole('button', { name: 'Quinoa' }));
            await user.click(await screen.findByRole('button', { name: /Quinoa, cooked/ }));

            expect(await screen.findByRole('alert')).toHaveTextContent('We couldn’t resolve that ingredient.');
            expect(onSelect).not.toHaveBeenCalled();
        });

        it('returns to search from the disambiguation panel', async () => {
            const user = userEvent.setup();
            const client = createFakeRecipeServiceClient();
            searchWithUnresolved(client);
            vi.spyOn(client, 'getIngredientCandidates').mockResolvedValue([CANDIDATE]);

            renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);
            await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'quin');
            await user.click(await screen.findByRole('button', { name: 'Quinoa' }));
            expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();

            await user.click(await screen.findByRole('button', { name: 'Back to search' }));
            expect(screen.getByRole('searchbox', { name: 'Search ingredients' })).toBeInTheDocument();
        });
    });
});
