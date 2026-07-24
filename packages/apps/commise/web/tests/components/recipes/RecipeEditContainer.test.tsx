/**
 * Component tests for RecipeEditContainer (T067 web recipe-edit wiring + T070/W7 concurrent-edit conflict
 * resolution). Covers: loading while the recipe loads; a distinct not-found affordance (no retry) and a
 * generic error (with retry) mirroring the detail route; seeding the form from the loaded RecipeDetail; a
 * valid edit mapping to the update wire shape (carrying `expectedVersion` for optimistic concurrency) then
 * navigating back to the detail on success; and the version-conflict path (W7 Task 3's banner + A/B/C option
 * cards) — a 409 enters conflict mode (rendering the server-first banner, the three cards, and the changed
 * fields), Option B ("overwrite") re-submits against the FRESH server version then navigates, Option C
 * ("merge") re-submits the field-by-field merged draft, and Option A ("keep server") exits the conflict view
 * without a write or navigation (its FULL discard-terminal navigation is W7 Task 6's scope). The Next router
 * stays mocked; the photo uploader (its own container, its own hooks) stays stubbed out. Queries use
 * role/label/text only.
 *
 * Migrated (CP-6 T3) off `vi.mock('@kitchensink/recipe-service-client/hooks', ...)` onto the type-checked
 * fake-client seam: `renderWithRecipeClient` mounts the container through the REAL query/mutation hooks
 * (including the embedded `IngredientPicker`'s four supporting hooks) over a real, network-guarded
 * `RecipeServiceClient` (`createFakeRecipeServiceClient`), stubbed per test with type-checked
 * `vi.spyOn(client, '<method>')`. The `IngredientPicker`'s `useAddIngredientByName`/`useIngredientStatus`/
 * `useIngredientCandidates`/`useResolveIngredient` need NO stubbing at all: `useSearchIngredients`/
 * `useIngredientCandidates` stay `enabled: false` (empty query / no active disambiguation), and the two
 * mutations never fire unless a test actually drives the picker's search/disambiguate UI, which none here
 * do — so they never reach the network guard. The hand-rolled `versionAwareMutation` fake (inspecting
 * `vars.input.expectedVersion` to decide success vs conflict) becomes `conflictClient`'s
 * `vi.spyOn(client, 'updateRecipe').mockImplementation(...)`, doing the same job against the REAL client
 * method signature — a rename/reshape there now fails `tsc`. The 409-triggered refetch that used to be a
 * hand-wired `refetchMock` is now the container's own `query.refetch()` calling the REAL `getRecipeById` a
 * second time, modeled with `mockResolvedValueOnce` twice (seed, then the fresh "theirs").
 */
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NotFoundError, VersionConflictError } from '@kitchensink/recipe-service-client';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import type { RecipeDetail, RecipeSnapshot, VersionConflictSide } from '@kitchensink/recipe-core';
import type { RecipeServiceClient } from '@kitchensink/recipe-service-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithRecipeClient } from '@commise/test-utils';

import { RecipeEditContainer } from '@/components/recipes/RecipeEditContainer';

import { makeRecipeDetail } from './__fixtures__/recipeFixtures';

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: pushMock }),
}));

// The photo uploader is its own container with its own hooks (covered by RecipePhotoUploaderContainer.test);
// stub it here so this suite exercises only the edit form / conflict logic and needs no photo-hook stubs.
vi.mock('@/components/recipes/RecipePhotoUploaderContainer', () => ({
    RecipePhotoUploaderContainer: () => null,
}));

/**
 * Project a {@link RecipeDetail} to the {@link VersionConflictSide} shape a real 409's `server`/`base` side
 * carries (W8-a.5) — `useRecipeEditor` reads this straight off the error (NO refetch, W7 Task 2), so a fake
 * conflict must carry the winning content on the error itself, not just on a second `getRecipeById` resolve.
 */
function toVersionConflictSide(detail: RecipeDetail): VersionConflictSide {
    const snapshot: RecipeSnapshot = {
        version: detail.currentVersion,
        title: detail.title,
        description: detail.description,
        servings: detail.servings,
        prepTimeMinutes: detail.prepTimeMinutes,
        cookTimeMinutes: detail.cookTimeMinutes,
        steps: detail.steps.map((step, index) => ({
            id: `step_${index}`,
            recipeId: detail.id,
            stepNumber: step.stepNumber,
            instruction: step.instruction,
            ...(step.timerSeconds === undefined ? {} : { timerSeconds: step.timerSeconds }),
        })),
        ingredients: detail.ingredients.map((ingredient, index) => ({
            id: `ri_${index}`,
            recipeId: detail.id,
            ingredientId: ingredient.ingredientId,
            quantity: ingredient.quantity,
            unit: ingredient.unit ?? '',
            sortOrder: index,
            ingredientName: ingredient.name,
            isUserEntered: ingredient.isUserEntered,
            ...(ingredient.notes === undefined ? {} : { displayText: ingredient.notes }),
        })),
    };

    return {
        versionNumber: detail.currentVersion,
        deviceLabel: 'iPhone',
        updatedAt: '2026-05-09T14:30:00.000Z',
        snapshot,
    };
}

/**
 * A client whose `getRecipeById` seeds `mine` on the initial load, and whose `updateRecipe` models
 * optimistic concurrency: a submit carrying `theirs.currentVersion` (the server's fresh CAS token) succeeds;
 * any other `expectedVersion` 409s with a {@link VersionConflictError} carrying `theirs` as the enriched
 * `server` side (W8-a.5) — mirroring what the real server does on a stale write.
 */
function conflictClient(mine: RecipeDetail, theirs: RecipeDetail): RecipeServiceClient {
    const client = createFakeRecipeServiceClient();
    vi.spyOn(client, 'getRecipeById').mockResolvedValue(mine);
    vi.spyOn(client, 'updateRecipe').mockImplementation((_id, input) =>
        input.expectedVersion === theirs.currentVersion
            ? Promise.resolve(makeRecipeDetail({ id: 'rec_1', currentVersion: theirs.currentVersion + 1 }))
            : Promise.reject(
                  new VersionConflictError(theirs.currentVersion, input.expectedVersion, 'Recipe version conflict', {
                      server: toVersionConflictSide(theirs),
                  }),
              ),
    );

    return client;
}

afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
});

describe('RecipeEditContainer', () => {
    it('renders the loading state while the recipe loads', () => {
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'getRecipeById').mockReturnValue(new Promise(() => {}));

        renderWithRecipeClient(<RecipeEditContainer locale="en" recipeId="rec_1" />, client);

        expect(screen.getByRole('status', { name: 'Loading recipe' })).toBeInTheDocument();
    });

    it('renders a distinct not-found message with no retry for a 404', async () => {
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'getRecipeById').mockRejectedValue(new NotFoundError());

        renderWithRecipeClient(<RecipeEditContainer locale="en" recipeId="missing" />, client);

        expect(await screen.findByText(/couldn.t find that recipe/i)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    });

    it('renders a generic error with retry when the load fails', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        const getRecipeSpy = vi.spyOn(client, 'getRecipeById').mockRejectedValue(new Error('network down'));

        renderWithRecipeClient(<RecipeEditContainer locale="en" recipeId="rec_1" />, client);

        await user.click(await screen.findByRole('button', { name: 'Try again' }));

        await vi.waitFor(() => expect(getRecipeSpy).toHaveBeenCalledTimes(2));
    });

    it('seeds the 4-step wizard from the loaded recipe, one step at a time', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'getRecipeById').mockResolvedValue(makeRecipeDetail({ title: 'Weeknight Pasta' }));

        renderWithRecipeClient(<RecipeEditContainer locale="en" recipeId="rec_1" />, client);

        // Step 1 (Basic) is seeded and shown first.
        expect(await screen.findByRole('textbox', { name: 'Title' })).toHaveValue('Weeknight Pasta');
        expect(screen.getByText('Step 1 of 4')).toBeInTheDocument();

        // Step 2 (Ingredients) is seeded, reached via the footer nav.
        await user.click(screen.getByRole('button', { name: /Next: Ingredients/ }));
        expect(screen.getByRole('textbox', { name: 'Ingredient 1 name' })).toHaveValue('Olive oil');

        // Step 3 (Instructions) is seeded too.
        await user.click(screen.getByRole('button', { name: /Next: Instructions/ }));
        expect(screen.getByRole('textbox', { name: 'Step 1 instruction' })).toHaveValue('Combine the ingredients.');
    });

    it('maps the edited form to the update input (with expectedVersion) and navigates on success', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'getRecipeById').mockResolvedValue(
            makeRecipeDetail({ title: 'Weeknight Pasta', currentVersion: 3 }),
        );
        const updateSpy = vi.spyOn(client, 'updateRecipe').mockResolvedValue(makeRecipeDetail({ id: 'rec_1' }));

        renderWithRecipeClient(<RecipeEditContainer locale="en" recipeId="rec_1" />, client);

        await user.type(await screen.findByRole('textbox', { name: 'Title' }), ' Deluxe');
        await user.click(screen.getByRole('button', { name: 'Publish' }));

        await vi.waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
        const [id, input] = updateSpy.mock.calls[0]!;
        expect(id).toBe('rec_1');
        expect(input.title).toBe('Weeknight Pasta Deluxe');
        expect(input.expectedVersion).toBe(3);
        expect(input.ingredients).toEqual([{ ingredientId: 'ing_1', name: 'Olive oil', quantity: 2, unit: 'tbsp' }]);
        await vi.waitFor(() => expect(pushMock).toHaveBeenCalledWith('/en/recipes/rec_1'));
    });

    it('enters conflict mode on a 409, rendering the server-first banner, the three option cards, and the changed fields', async () => {
        const user = userEvent.setup();
        const mine = makeRecipeDetail({ title: 'Weeknight Pasta', currentVersion: 3 });
        const theirs = makeRecipeDetail({ title: 'Server Pasta', currentVersion: 4 });
        const client = conflictClient(mine, theirs);

        renderWithRecipeClient(<RecipeEditContainer locale="en" recipeId="rec_1" />, client);

        await user.type(await screen.findByRole('textbox', { name: 'Title' }), ' Deluxe');
        await user.click(screen.getByRole('button', { name: 'Publish' }));

        // The conflict view replaces the form: the per-side banner (server first, X7/X3) …
        expect(await screen.findByText('This recipe changed while you were editing')).toBeInTheDocument();
        expect(screen.getByText(/^Server version \(v4\): Saved .* on iPhone$/)).toBeInTheDocument();
        expect(screen.getByText('Your version: local unsaved changes')).toBeInTheDocument();
        // … the three A/B/C option cards (X2) …
        expect(screen.getByRole('button', { name: 'Keep server version' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Overwrite with your version' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Merge manually' })).toBeInTheDocument();
        // … and the changed-fields list carrying the in-progress title and the server's title.
        expect(screen.getByText('Your version: Weeknight Pasta Deluxe')).toBeInTheDocument();
        expect(screen.getByText('Latest saved version: Server Pasta')).toBeInTheDocument();
        // The edit form is gone while resolving the conflict.
        expect(screen.queryByRole('textbox', { name: 'Title' })).not.toBeInTheDocument();
        expect(pushMock).not.toHaveBeenCalled();
    });

    it('Option B (overwrite) re-submits against the server’s fresh currentVersion and navigates on success', async () => {
        const user = userEvent.setup();
        const mine = makeRecipeDetail({ title: 'Weeknight Pasta', currentVersion: 3 });
        const theirs = makeRecipeDetail({ title: 'Server Pasta', currentVersion: 4 });
        const client = conflictClient(mine, theirs);
        const updateSpy = vi.mocked(client.updateRecipe);

        renderWithRecipeClient(<RecipeEditContainer locale="en" recipeId="rec_1" />, client);

        await user.type(await screen.findByRole('textbox', { name: 'Title' }), ' Deluxe');
        await user.click(screen.getByRole('button', { name: 'Publish' }));

        await user.click(await screen.findByRole('button', { name: 'Overwrite with your version' }));

        await vi.waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(2));
        // First submit carried the stale version (3, → 409); the re-submit carries the fresh server version (4).
        const [, firstInput] = updateSpy.mock.calls[0]!;
        const [, secondInput] = updateSpy.mock.calls[1]!;
        expect(firstInput.expectedVersion).toBe(3);
        expect(secondInput.expectedVersion).toBe(4);
        expect(secondInput.title).toBe('Weeknight Pasta Deluxe');
        await vi.waitFor(() => expect(pushMock).toHaveBeenCalledWith('/en/recipes/rec_1'));
    });

    it('Option C (merge) re-submits the field-by-field merged draft against the fresh version and navigates', async () => {
        const user = userEvent.setup();
        // Theirs differs on both title and servings; the merged result keeps MY title but takes THEIR servings.
        const mine = makeRecipeDetail({ title: 'Weeknight Pasta', currentVersion: 3, servings: 4 });
        const theirs = makeRecipeDetail({ title: 'Server Pasta', currentVersion: 4, servings: 8 });
        const client = conflictClient(mine, theirs);
        const updateSpy = vi.mocked(client.updateRecipe);

        renderWithRecipeClient(<RecipeEditContainer locale="en" recipeId="rec_1" />, client);

        await user.type(await screen.findByRole('textbox', { name: 'Title' }), ' Deluxe');
        await user.click(screen.getByRole('button', { name: 'Publish' }));

        // Enter the merge panel and pull servings from the latest saved version, keeping my title.
        await user.click(await screen.findByRole('button', { name: 'Merge manually' }));
        const servingsGroup = screen.getByRole('radiogroup', { name: 'Servings' });
        await user.click(within(servingsGroup).getByRole('radio', { name: 'Latest saved version: 8' }));
        await user.click(screen.getByRole('button', { name: 'Save merged version' }));

        await vi.waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(2));
        const [, firstInput] = updateSpy.mock.calls[0]!;
        const [, secondInput] = updateSpy.mock.calls[1]!;
        // Mutation lens (stale version): the resubmit MUST carry the fresh server version (4), not the stale
        // 3 the first save carried — otherwise the merge would re-409 and never navigate.
        expect(firstInput.expectedVersion).toBe(3);
        expect(secondInput.expectedVersion).toBe(4);
        // Mutation lens (per-field): the merged write is my title + their servings, not one whole side.
        expect(secondInput.title).toBe('Weeknight Pasta Deluxe');
        expect(secondInput.servings).toBe(8);
        await vi.waitFor(() => expect(pushMock).toHaveBeenCalledWith('/en/recipes/rec_1'));
    });

    // Option A ("keep server") is a DISTINCT terminal outcome (`status: 'discarded'`, no write — see
    // `useRecipeEditor`'s module doc). The FULL post-discard navigation (OQ-1: navigate to the recipe's
    // detail view without "Saved!" messaging) is W7 Task 6's container-wiring scope; here, minimally, Option
    // A must exit the conflict view without writing or navigating.
    it('Option A (keep server) exits the conflict view without submitting a write or navigating', async () => {
        const user = userEvent.setup();
        const mine = makeRecipeDetail({ title: 'Weeknight Pasta', currentVersion: 3 });
        const theirs = makeRecipeDetail({ title: 'Server Pasta', currentVersion: 4 });
        const client = conflictClient(mine, theirs);
        const updateSpy = vi.mocked(client.updateRecipe);

        renderWithRecipeClient(<RecipeEditContainer locale="en" recipeId="rec_1" />, client);

        await user.type(await screen.findByRole('textbox', { name: 'Title' }), ' Deluxe');
        await user.click(screen.getByRole('button', { name: 'Publish' }));

        await user.click(await screen.findByRole('button', { name: 'Keep server version' }));

        expect(screen.queryByText('This recipe changed while you were editing')).not.toBeInTheDocument();
        expect(updateSpy).toHaveBeenCalledTimes(1); // only the original (rejected) submit — no resubmit.
        expect(pushMock).not.toHaveBeenCalled();
    });

    it('Save Draft on a recipe seeded as "draft" persists with a draft status, then navigates (onSaved)', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'getRecipeById').mockResolvedValue(
            makeRecipeDetail({ title: 'Weeknight Pasta', status: 'draft' }),
        );
        const updateSpy = vi
            .spyOn(client, 'updateRecipe')
            .mockResolvedValue(makeRecipeDetail({ id: 'rec_1', status: 'draft' }));

        renderWithRecipeClient(<RecipeEditContainer locale="en" recipeId="rec_1" />, client);

        await screen.findByRole('textbox', { name: 'Title' });
        await user.click(screen.getByRole('button', { name: 'Save Draft' }));

        await vi.waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
        const [, input] = updateSpy.mock.calls[0]!;
        expect(input.status).toBe('draft');
        // `useRecipeEditor`'s `onSaved` fires on every successful save (draft or publish) — same navigation
        // the pre-wizard "Save changes" always used.
        await vi.waitFor(() => expect(pushMock).toHaveBeenCalledWith('/en/recipes/rec_1'));
    });

    // Regression (opus review, Important #1): Save Draft must never downgrade an already-published recipe —
    // it used to send `status: 'draft'` unconditionally, which would silently unpublish a live recipe.
    it('Save Draft on a recipe seeded as "published" does NOT downgrade — preserves status: "published"', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'getRecipeById').mockResolvedValue(
            makeRecipeDetail({ title: 'Weeknight Pasta', status: 'published' }),
        );
        const updateSpy = vi
            .spyOn(client, 'updateRecipe')
            .mockResolvedValue(makeRecipeDetail({ id: 'rec_1', status: 'published' }));

        renderWithRecipeClient(<RecipeEditContainer locale="en" recipeId="rec_1" />, client);

        await screen.findByRole('textbox', { name: 'Title' });
        await user.click(screen.getByRole('button', { name: 'Save Draft' }));

        await vi.waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
        const [, input] = updateSpy.mock.calls[0]!;
        expect(input.status).toBe('published');
        expect(input.status).not.toBe('draft');
        await vi.waitFor(() => expect(pushMock).toHaveBeenCalledWith('/en/recipes/rec_1'));
    });

    it('Publish is blocked while the ingredients step is invalid, and flags that step in the rail', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'getRecipeById').mockResolvedValue(
            makeRecipeDetail({ title: 'Weeknight Pasta', ingredients: [] }),
        );
        const updateSpy = vi.spyOn(client, 'updateRecipe');

        renderWithRecipeClient(<RecipeEditContainer locale="en" recipeId="rec_1" />, client);

        await screen.findByRole('textbox', { name: 'Title' });
        await user.click(screen.getByRole('button', { name: 'Publish' }));

        expect(updateSpy).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: /Ingredients: needs attention/ })).toBeInTheDocument();
        expect(pushMock).not.toHaveBeenCalled();
    });

    it('Cancel with unsaved edits shows the discard-confirmation dialog; confirming navigates to the detail route', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'getRecipeById').mockResolvedValue(makeRecipeDetail({ title: 'Weeknight Pasta' }));

        renderWithRecipeClient(<RecipeEditContainer locale="en" recipeId="rec_1" />, client);

        await user.type(await screen.findByRole('textbox', { name: 'Title' }), ' Deluxe');
        await user.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(await screen.findByRole('alertdialog', { name: 'Discard unsaved changes?' })).toBeInTheDocument();
        expect(pushMock).not.toHaveBeenCalled();

        await user.click(screen.getByRole('button', { name: 'Discard changes' }));

        expect(pushMock).toHaveBeenCalledWith('/en/recipes/rec_1');
    });

    it('Cancel with no unsaved edits navigates to the detail route immediately (no dialog)', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'getRecipeById').mockResolvedValue(makeRecipeDetail({ title: 'Weeknight Pasta' }));

        renderWithRecipeClient(<RecipeEditContainer locale="en" recipeId="rec_1" />, client);

        await screen.findByRole('textbox', { name: 'Title' });
        await user.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
        expect(pushMock).toHaveBeenCalledWith('/en/recipes/rec_1');
    });
});
