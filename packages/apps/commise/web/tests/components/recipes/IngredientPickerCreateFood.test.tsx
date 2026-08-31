/**
 * Component tests for the U16 create-your-own-food vertical in the web ingredient picker — every state
 * of the shared sub-machine, driven through the REAL `useIngredientResolver` over the type-checked
 * fake-client seam (only the transport is stubbed).
 *
 * The states, per `authoredFoodCreate.model.ts`: the affordance itself, the open form (with the typed
 * query prefilled), inline per-field validation, submitting, the resolved create-and-attach, the
 * ⛔ DISTINCT duplicate state with its reuse affordance, the retryable submit failure, and cancel.
 *
 * Queries use role/label/text only (`getByRole`/`getByLabelText` — no test ids).
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithRecipeClient } from '@commise/test-utils';

import { IngredientPicker } from '@/components/recipes/IngredientPicker';

import { makeIngredient } from './__fixtures__/ingredientFixtures';

/** Mount with an always-empty local suggest, so the create affordance is the natural next step. */
function mount(onSelect = vi.fn()): {
    readonly client: ReturnType<typeof createFakeRecipeServiceClient>;
    readonly user: ReturnType<typeof userEvent.setup>;
    readonly onSelect: ReturnType<typeof vi.fn>;
} {
    const client = createFakeRecipeServiceClient();
    vi.spyOn(client, 'suggestIngredients').mockResolvedValue({ suggestions: [], catalogAvailability: 'ok' });
    renderWithRecipeClient(<IngredientPicker onSelect={onSelect} />, client);

    return { client, user: userEvent.setup(), onSelect };
}

/** Type a query and open the create form from the affordance. */
async function openForm(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'grandma blend');
    await user.click(await screen.findByRole('button', { name: 'Create your own food' }));
}

/** Fill the four macro fields with a valid profile. */
async function fillMacros(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    await user.type(screen.getByLabelText('Calories (kcal)'), '100');
    await user.type(screen.getByLabelText('Protein (g)'), '10');
    await user.type(screen.getByLabelText('Carbs (g)'), '20');
    await user.type(screen.getByLabelText('Fat (g)'), '5');
}

afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
});

describe('IngredientPicker — the U16 create-your-own-food vertical', () => {
    it('offers the affordance on an EMPTY result set, and opens the form with the query prefilled', async () => {
        const { user } = mount();

        await openForm(user);

        expect(screen.getByRole('form', { name: /Create .grandma blend./u })).toBeInTheDocument();
        expect(screen.getByLabelText('Food name')).toHaveValue('grandma blend');
        // The only-you promise (D9a/U11) is on screen before anything is submitted.
        expect(screen.getByText('Only you can see foods you create.')).toBeInTheDocument();
    });

    it('renders INLINE per-field errors on an invalid submit — nothing reaches the wire', async () => {
        const { client, user } = mount();
        const create = vi.spyOn(client, 'createAuthoredFoodViaPicker');

        await openForm(user);
        await user.click(screen.getByRole('button', { name: 'Create and add' }));

        // The four empty macros each carry their own inline error; the create call never fired.
        expect(screen.getAllByRole('alert').map((node) => node.textContent)).toEqual([
            'Required',
            'Required',
            'Required',
            'Required',
        ]);
        expect(create).not.toHaveBeenCalled();
    });

    it('creates and ATTACHES in one flow — the resolved line reaches onSelect and the picker resets', async () => {
        const { client, user, onSelect } = mount();
        const admitted = makeIngredient({ id: 'ing-a1', name: 'grandma blend', foodId: 'F_new' });

        vi.spyOn(client, 'createAuthoredFoodViaPicker').mockResolvedValue({ created: true, ingredient: admitted });

        await openForm(user);
        await fillMacros(user);
        await user.click(screen.getByRole('button', { name: 'Create and add' }));

        await waitFor(() => {
            expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ ingredientId: 'ing-a1' }));
        });
        // The form closed and the picker reset to a blank search — same convergence as every pick.
        expect(screen.queryByRole('form', { name: /Create/u })).not.toBeInTheDocument();
        expect(screen.getByRole('searchbox', { name: 'Search ingredients' })).toHaveValue('');
    });

    it('⛔ the per-author duplicate renders its OWN sentence and a working reuse affordance', async () => {
        const { client, user, onSelect } = mount();
        const existing = makeIngredient({ id: 'ing-prior', name: 'grandma blend', foodId: 'F_prior' });

        vi.spyOn(client, 'createAuthoredFoodViaPicker').mockResolvedValue({
            created: false,
            reason: 'duplicate',
            existingFoodId: 'F_prior',
        });
        const byFood = vi.spyOn(client, 'addIngredientByFood').mockResolvedValue(existing);

        await openForm(user);
        await fillMacros(user);
        await user.click(screen.getByRole('button', { name: 'Create and add' }));

        // A DISTINCT sentence — not the generic validation copy, and not an alert (nothing failed).
        expect(await screen.findByText('You already have a food named “grandma blend”.')).toBeInTheDocument();
        expect(screen.queryByText('Outside the allowed range')).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Use that one' }));

        await waitFor(() => {
            expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ ingredientId: 'ing-prior' }));
        });
        expect(byFood).toHaveBeenCalledWith('F_prior');
    });

    it('a FAILED create surfaces the retryable alert with every field intact', async () => {
        const { client, user } = mount();

        vi.spyOn(client, 'createAuthoredFoodViaPicker').mockRejectedValue(new Error('down'));

        await openForm(user);
        await fillMacros(user);
        await user.click(screen.getByRole('button', { name: 'Create and add' }));

        expect(
            await screen.findByText('Could not create the food. Check your connection and try again.'),
        ).toBeInTheDocument();
        // The draft survives — a retry does not mean re-typing four numbers.
        expect(screen.getByLabelText('Calories (kcal)')).toHaveValue('100');
    });

    it('cancel closes the form and returns to the search results', async () => {
        const { user } = mount();

        await openForm(user);
        await user.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(screen.queryByRole('form', { name: /Create/u })).not.toBeInTheDocument();
        expect(screen.getByRole('searchbox', { name: 'Search ingredients' })).toBeInTheDocument();
    });
});
