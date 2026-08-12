/**
 * Component tests for RecipeCreateContainer (w3/e1,e2: rewired onto the 4-step `Wizard` shell). Covers: the
 * wizard renders seeded at step 1; an invalid form blocks submission (no mutation, validation surfaced on
 * the current step); a valid form — filled across steps 1/2/3 via the footer `Next` nav — maps to the
 * `CreateRecipeRequest` wire shape (with the ingredient resolved via the picker on step 2) and navigates to
 * the new recipe on success; Save Draft persists with a draft status; poll-after-add (a PENDING line
 * resolves to RESOLVED via the poller, on step 2); and a persistence failure surfaces. The Next router stays
 * mocked; queries use role/label/text only.
 *
 * Migrated (CP-6 T3) off `vi.mock('@kitchensink/recipe-service-client/hooks', ...)` onto the type-checked
 * fake-client seam: `renderWithRecipeClient` mounts the container through the REAL recipe-service hooks
 * (`useCreateRecipe`, plus the embedded `IngredientPicker`'s `useSearchIngredients`/`useAddIngredientByName`/
 * `useIngredientStatus` via the shared `useIngredientResolver`) over a real, network-guarded
 * `RecipeServiceClient`, stubbed per test with type-checked `vi.spyOn(client, '<method>')`.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FoodResolutionStatus } from '@kitchensink/recipe-core';
import type { CreateRecipeRequest } from '@kitchensink/schema-recipe';
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

/**
 * Reach the wizard's final step (Photos) via the rail. U6 chrome made `Publish` the footer's FINAL-step
 * primary only — no longer live on steps 1–3 — so any publish flow must first land on Photos. The rail
 * permits UNGATED forward navigation regardless of a step's validity, which lets the invalid-form
 * submission-gate test reach the button even from the invalid Basic step.
 */
async function goToPhotos(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    await user.click(screen.getByRole('button', { name: /Photos:/ }));
}

/**
 * Open the header's overflow ("More actions") menu (U6 chrome): Save Draft and Cancel were demoted off the
 * top-level header into this `role="menu"` disclosure, so reaching either now goes through this trigger first.
 */
async function openActionsMenu(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    await user.click(screen.getByRole('button', { name: 'More actions' }));
}

describe('RecipeCreateContainer', () => {
    it('renders the create wizard, seeded at step 1', () => {
        const client = createFakeRecipeServiceClient();

        renderWithRecipeClient(<RecipeCreateContainer locale="en" />, client);

        expect(screen.getByRole('textbox', { name: 'Title' })).toBeInTheDocument();
        expect(screen.getByText('Step 1 of 4')).toBeInTheDocument();
        // U6 chrome: step 1's contextual footer primary is `Next: Ingredients >`, not `Publish` (which is now
        // only the FINAL step's primary). Its presence confirms the wizard chrome rendered at step 1.
        expect(screen.getByRole('button', { name: /Next: Ingredients/ })).toBeInTheDocument();
    });

    it('blocks submission and surfaces validation on the current step when the form is invalid', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        const createSpy = vi.spyOn(client, 'createRecipe');

        renderWithRecipeClient(<RecipeCreateContainer locale="en" />, client);

        // Publish is the final step's footer primary (U6: no longer on steps 1–3). Reach it via the rail —
        // FORWARD navigation is ungated even from the invalid Basic step — then attempt to submit.
        await goToPhotos(user);
        await user.click(screen.getByRole('button', { name: 'Publish' }));

        // Submission is blocked (no create) and the rail flags the invalid Basic step …
        expect(createSpy).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: /Basic: needs attention/ })).toBeInTheDocument();
        // … and returning to Basic surfaces the field-level validation on the current step. The form is not
        // dirty (no edits), so this backward rail navigation does not trip the discard guard.
        await user.click(screen.getByRole('button', { name: /Basic:/ }));
        expect(screen.getByText('A title is required.')).toBeInTheDocument();
    });

    it('maps a valid form (filled across steps) to the wire input and navigates to the new recipe on success', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        // Search Stage 2: the picker reads the BLENDED envelope. This container only exercises picking one
        // of the caller's OWN ingredients, so the fixture is a `local` suggestion.
        vi.spyOn(client, 'suggestIngredients').mockResolvedValue({
            suggestions: [
                {
                    provenance: 'local',
                    ingredient: makeIngredient({
                        id: 'ing_9',
                        name: 'Olive oil',
                        foodResolutionStatus: FoodResolutionStatus.RESOLVED,
                    }),
                },
            ],
            catalogAvailability: 'ok',
        });
        vi.spyOn(client, 'createRecipe').mockResolvedValue(makeRecipeDetail({ id: 'rec_created' }));

        renderWithRecipeClient(<RecipeCreateContainer locale="en" />, client);

        // Step 1: title.
        await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Test Recipe');
        await user.click(screen.getByRole('button', { name: /Next: Ingredients/ }));

        // Step 2: resolve an ingredient via the picker so the line carries an ingredientId.
        await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'oli');
        await user.click(await screen.findByRole('button', { name: 'Olive oil' }));
        await user.click(screen.getByRole('button', { name: /Next: Instructions/ }));

        // Step 3: add and fill one instruction step.
        await user.click(screen.getByRole('button', { name: 'Add step' }));
        await user.type(screen.getByRole('textbox', { name: 'Step 1 instruction' }), 'Combine everything.');

        // Advance to the final step (Photos), whose footer primary is `Publish` (U6: Publish is the final
        // step's contextual primary, no longer live on the earlier steps).
        await user.click(screen.getByRole('button', { name: /Next: Photos/ }));
        await user.click(screen.getByRole('button', { name: 'Publish' }));

        const createSpy = vi.mocked(client.createRecipe);
        await vi.waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));
        const [input] = createSpy.mock.calls[0] as [CreateRecipeRequest];
        expect(input.title).toBe('Test Recipe');
        expect(input.ingredients).toEqual([{ ingredientId: 'ing_9', name: 'Olive oil', quantity: 1 }]);
        expect(input.steps).toEqual([{ instruction: 'Combine everything.' }]);
        expect(input.status).toBe('published');
        await vi.waitFor(() => expect(pushMock).toHaveBeenCalledWith('/en/recipes/rec_created'));
    });

    it('Save Draft persists with a draft status under the relaxed step-1-only floor', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'createRecipe').mockResolvedValue(makeRecipeDetail({ id: 'rec_created' }));

        renderWithRecipeClient(<RecipeCreateContainer locale="en" />, client);

        // No ingredients/steps filled at all — Save Draft's floor is step 1 only (title/servings/times).
        await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Draft Recipe');
        await openActionsMenu(user);
        await user.click(screen.getByRole('menuitem', { name: 'Save Draft' }));

        const createSpy = vi.mocked(client.createRecipe);
        await vi.waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));
        const [input] = createSpy.mock.calls[0] as [CreateRecipeRequest];
        expect(input.title).toBe('Draft Recipe');
        expect(input.status).toBe('draft');
        await vi.waitFor(() => expect(pushMock).toHaveBeenCalledWith('/en/recipes/rec_created'));
    });

    it('poll-after-add: a line added PENDING is polled and its badge resolves to RESOLVED', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'suggestIngredients').mockResolvedValue({ suggestions: [], catalogAvailability: 'ok' });
        // addByName returns a PENDING food-backed ingredient (the line is added still resolving).
        vi.spyOn(client, 'addIngredientByName').mockResolvedValue(
            makeIngredient({ id: 'ing_food', name: 'Quinoa', foodResolutionStatus: FoodResolutionStatus.PENDING }),
        );
        // The poll (useIngredientStatus) reports the food has RESOLVED — this is what must flip the line badge.
        vi.spyOn(client, 'getIngredientStatus').mockResolvedValue(
            makeIngredient({ id: 'ing_food', name: 'Quinoa', foodResolutionStatus: FoodResolutionStatus.RESOLVED }),
        );

        renderWithRecipeClient(<RecipeCreateContainer locale="en" />, client);

        // Step 1 must be valid (a non-blank title) before Next can advance to step 2.
        await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Quinoa Bowl');
        await user.click(screen.getByRole('button', { name: /Next: Ingredients/ }));
        await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'Quinoa');
        await user.click(await screen.findByRole('button', { name: 'Find nutrition for “Quinoa”' }));

        // Mutation lens: the poll wired the RESOLVED status onto the line's badge. Had the poller not updated
        // the line (regression), the badge would still read the PENDING label 'Resolving…' — so the waitFor
        // below times out and fails rather than passing vacuously.
        //
        // The text is awaited, not asserted synchronously after the `findBy`. `findByLabelText` resolves as
        // soon as the badge EXISTS, and it exists immediately — reading 'Resolving…', since the line is added
        // PENDING and only the poll's later response flips it. Synchronously asserting the content on the
        // element that `findBy` returned therefore raced the poll, and lost under CI load (observed on this
        // branch at a2d0231a: "Expected 'Resolved', received 'Resolving…'"). The element's existence is the
        // wrong synchronisation point for a claim about its text; the text is.
        const badge = await screen.findByLabelText('Ingredient 1 status');
        await waitFor(() => expect(badge).toHaveTextContent('Resolved'));
        // The poll drove the line to a non-PENDING state and stopped there.
        expect(screen.queryByText('Resolving…')).not.toBeInTheDocument();
    });

    it('surfaces an error when creating the recipe fails', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        // Search Stage 2: the picker reads the BLENDED envelope. This container only exercises picking one
        // of the caller's OWN ingredients, so the fixture is a `local` suggestion.
        vi.spyOn(client, 'suggestIngredients').mockResolvedValue({
            suggestions: [
                {
                    provenance: 'local',
                    ingredient: makeIngredient({
                        id: 'ing_9',
                        name: 'Olive oil',
                        foodResolutionStatus: FoodResolutionStatus.RESOLVED,
                    }),
                },
            ],
            catalogAvailability: 'ok',
        });
        vi.spyOn(client, 'createRecipe').mockRejectedValue(new Error('boom'));

        renderWithRecipeClient(<RecipeCreateContainer locale="en" />, client);

        await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Test Recipe');
        await user.click(screen.getByRole('button', { name: /Next: Ingredients/ }));
        await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'oli');
        await user.click(await screen.findByRole('button', { name: 'Olive oil' }));
        await user.click(screen.getByRole('button', { name: /Next: Instructions/ }));
        await user.click(screen.getByRole('button', { name: 'Add step' }));
        await user.type(screen.getByRole('textbox', { name: 'Step 1 instruction' }), 'Combine everything.');
        await user.click(screen.getByRole('button', { name: /Next: Photos/ }));
        await user.click(screen.getByRole('button', { name: 'Publish' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('We couldn’t save this recipe. Please try again.');
    });

    it('Cancel with unsaved edits shows the discard-confirmation dialog; confirming navigates to the recipe list', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();

        renderWithRecipeClient(<RecipeCreateContainer locale="en" />, client);

        await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Test Recipe');
        await openActionsMenu(user);
        await user.click(screen.getByRole('menuitem', { name: 'Cancel' }));

        expect(await screen.findByRole('alertdialog', { name: 'Discard unsaved changes?' })).toBeInTheDocument();
        expect(pushMock).not.toHaveBeenCalled();

        await user.click(screen.getByRole('button', { name: 'Discard changes' }));

        expect(pushMock).toHaveBeenCalledWith('/en/recipes');
    });
});
