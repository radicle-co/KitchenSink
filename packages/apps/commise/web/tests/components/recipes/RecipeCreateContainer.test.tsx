/**
 * Component tests for RecipeCreateContainer (T067 web recipe-create wiring). Covers: the create form
 * renders; an invalid form blocks submission (no mutation, validation surfaced); a valid form maps to the
 * `CreateRecipeInput` wire shape (with the ingredient resolved via the picker) and navigates to the new
 * recipe on success; poll-after-add (a PENDING line resolves to RESOLVED via the poller); and a persistence
 * failure surfaces. The Next router stays mocked; queries use role/label/text only.
 *
 * Migrated (CP-6 T3) off `vi.mock('@kitchensink/recipe-service-client/hooks', ...)` onto the type-checked
 * fake-client seam: `renderWithRecipeClient` mounts the container through the REAL recipe-service hooks
 * (`useCreateRecipe`, plus the embedded `IngredientPicker`'s `useSearchIngredients`/`useAddIngredientByName`/
 * `useIngredientStatus` via the shared `useIngredientResolver`) over a real, network-guarded
 * `RecipeServiceClient`, stubbed per test with type-checked `vi.spyOn(client, '<method>')`. This is a FULL
 * migration — no narrow hook-level mock remains. `useIngredientCandidates`/`useResolveIngredient` need no
 * stub at all: the resolver only enables/calls them once a match enters disambiguation (`UNRESOLVED`), which
 * none of these tests ever drive into, so the real (disabled) query/never-called mutation touch the client
 * exactly zero times.
 */
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FoodResolutionStatus } from '@kitchensink/recipe-core';
import type { CreateRecipeInput } from '@kitchensink/recipe-core';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithRecipeClient } from '@commise/test-utils';

import { RecipeCreateContainer } from '@/components/recipes/RecipeCreateContainer';

import { makeIngredient } from './__fixtures__/ingredientFixtures';
import { makeRecipeDetail } from './__fixtures__/recipeFixtures';

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: pushMock }),
}));

afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
});

describe('RecipeCreateContainer', () => {
    it('renders the create form', () => {
        const client = createFakeRecipeServiceClient();

        renderWithRecipeClient(<RecipeCreateContainer locale="en" />, client);

        expect(screen.getByRole('heading', { level: 1, name: 'New recipe' })).toBeInTheDocument();
    });

    it('blocks submission and surfaces validation when the form is invalid', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        const createSpy = vi.spyOn(client, 'createRecipe');

        renderWithRecipeClient(<RecipeCreateContainer locale="en" />, client);

        await user.click(screen.getByRole('button', { name: 'Create recipe' }));

        expect(createSpy).not.toHaveBeenCalled();
        expect(screen.getByText('A title is required.')).toBeInTheDocument();
    });

    it('maps a valid form to the wire input and navigates to the new recipe on success', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'searchIngredients').mockResolvedValue([
            makeIngredient({ id: 'ing_9', name: 'Olive oil', foodResolutionStatus: FoodResolutionStatus.RESOLVED }),
        ]);
        vi.spyOn(client, 'createRecipe').mockResolvedValue(makeRecipeDetail({ id: 'rec_created' }));

        renderWithRecipeClient(<RecipeCreateContainer locale="en" />, client);

        await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Test Recipe');

        // Resolve an ingredient via the picker so the line carries an ingredientId.
        await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'oli');
        await user.click(await screen.findByRole('button', { name: 'Olive oil' }));

        // Add and fill one instruction step.
        await user.click(screen.getByRole('button', { name: 'Add step' }));
        await user.type(screen.getByRole('textbox', { name: 'Step 1 instruction' }), 'Combine everything.');

        await user.click(screen.getByRole('button', { name: 'Create recipe' }));

        const createSpy = vi.mocked(client.createRecipe);
        await vi.waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));
        const [input] = createSpy.mock.calls[0] as [CreateRecipeInput];
        expect(input.title).toBe('Test Recipe');
        expect(input.ingredients).toEqual([{ ingredientId: 'ing_9', name: 'Olive oil', quantity: 1 }]);
        expect(input.steps).toEqual([{ instruction: 'Combine everything.' }]);
        await vi.waitFor(() => expect(pushMock).toHaveBeenCalledWith('/en/recipes/rec_created'));
    });

    it('poll-after-add: a line added PENDING is polled and its badge resolves to RESOLVED', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'searchIngredients').mockResolvedValue([]);
        // addByName returns a PENDING food-backed ingredient (the line is added still resolving).
        vi.spyOn(client, 'addIngredientByName').mockResolvedValue(
            makeIngredient({ id: 'ing_food', name: 'Quinoa', foodResolutionStatus: FoodResolutionStatus.PENDING }),
        );
        // The poll (useIngredientStatus) reports the food has RESOLVED — this is what must flip the line badge.
        vi.spyOn(client, 'getIngredientStatus').mockResolvedValue(
            makeIngredient({ id: 'ing_food', name: 'Quinoa', foodResolutionStatus: FoodResolutionStatus.RESOLVED }),
        );

        renderWithRecipeClient(<RecipeCreateContainer locale="en" />, client);

        await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'Quinoa');
        await user.click(await screen.findByRole('button', { name: 'Find nutrition for “Quinoa”' }));

        // Mutation lens: the poll wired the RESOLVED status onto the line's badge. Had the poller not updated
        // the line (regression), the badge would still read the PENDING label 'Resolving…'.
        const badge = await screen.findByLabelText('Ingredient 1 status');
        expect(badge).toHaveTextContent('Resolved');
        // The poll drove the line to a non-PENDING state and stopped there.
        expect(screen.queryByText('Resolving…')).not.toBeInTheDocument();
    });

    it('surfaces an error when creating the recipe fails', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'searchIngredients').mockResolvedValue([
            makeIngredient({ id: 'ing_9', name: 'Olive oil', foodResolutionStatus: FoodResolutionStatus.RESOLVED }),
        ]);
        vi.spyOn(client, 'createRecipe').mockRejectedValue(new Error('boom'));

        renderWithRecipeClient(<RecipeCreateContainer locale="en" />, client);

        await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Test Recipe');
        await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'oli');
        await user.click(await screen.findByRole('button', { name: 'Olive oil' }));
        await user.click(screen.getByRole('button', { name: 'Add step' }));
        await user.type(screen.getByRole('textbox', { name: 'Step 1 instruction' }), 'Combine everything.');
        await user.click(screen.getByRole('button', { name: 'Create recipe' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('We couldn’t save this recipe. Please try again.');
    });
});
