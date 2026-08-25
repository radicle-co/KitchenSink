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

/**
 * Reach the wizard's final step (Review) via the rail. The action bar's primary is `Publish` on the last
 * step only — it is not live on steps 1–3 — so any publish flow must first land on Review. The
 * rail permits UNGATED forward navigation regardless of a step's validity, which is what lets the
 * invalid-step Publish-gate test reach the button at all.
 */
async function goToReview(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    await user.click(screen.getByRole('button', { name: /Review:/ }));
}

/**
 * Open the header's overflow ("More actions") menu (U6 chrome): Save Draft and Cancel were demoted off the
 * top-level header into this `role="menu"` disclosure, so reaching either now goes through this trigger first.
 */
async function openActionsMenu(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    await user.click(screen.getByRole('button', { name: 'More actions' }));
}

describe('RecipeEditContainer', () => {
    it('renders the loading state while the recipe loads', () => {
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'getRecipeById').mockReturnValue(new Promise(() => {}));

        renderWithRecipeClient(<RecipeEditContainer locale="en" recipeId="rec_1" />, client);

        expect(screen.getByRole('status', { name: 'Loading recipe' })).toBeInTheDocument();
    });

    it('announces the loading label as the live region CONTENT, not only its aria-label', () => {
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'getRecipeById').mockReturnValue(new Promise(() => {}));

        renderWithRecipeClient(<RecipeEditContainer locale="en" recipeId="rec_1" />, client);

        // A `role="status"` node rendered EMPTY is doubly broken: zero-height (nothing for a sighted viewer,
        // and Playwright resolves it as `hidden`) AND silent, because a live region announces its CONTENT, not
        // its label. The localized label must be the visible caption.
        expect(screen.getByRole('status', { name: 'Loading recipe' })).toHaveTextContent('Loading recipe');
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
        // Hoisted so the ingredient assertion below DERIVES its expectation from the same Object Mother the
        // component was fed, rather than restating it. The literal it used to hardcode (`ingredientId: 'ing_1'`)
        // went stale silently when the fixture moved to a real UUID — the wire field is a `z.uuid()`, and
        // `'ing_1'` was never a value the catalog API could return. A hardcoded copy of fixture data is the same
        // drift this contract work exists to remove, one layer down.
        const loaded = makeRecipeDetail({ title: 'Weeknight Pasta', currentVersion: 3 });
        vi.spyOn(client, 'getRecipeById').mockResolvedValue(loaded);
        const updateSpy = vi.spyOn(client, 'updateRecipe').mockResolvedValue(makeRecipeDetail({ id: 'rec_1' }));

        renderWithRecipeClient(<RecipeEditContainer locale="en" recipeId="rec_1" />, client);

        await user.type(await screen.findByRole('textbox', { name: 'Title' }), ' Deluxe');
        await goToReview(user);
        await user.click(screen.getByRole('button', { name: 'Publish' }));

        await vi.waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
        const [id, input] = updateSpy.mock.calls[0]!;
        expect(id).toBe('rec_1');
        expect(input.title).toBe('Weeknight Pasta Deluxe');
        expect(input.expectedVersion).toBe(3);
        expect(input.ingredients).toEqual(
            loaded.ingredients.map(({ ingredientId, name, quantity, unit }) => ({
                ingredientId,
                name,
                quantity,
                unit,
            })),
        );
        await vi.waitFor(() => expect(pushMock).toHaveBeenCalledWith('/en/recipes/rec_1'));
    });

    it('enters conflict mode on a 409, rendering the server-first banner, the three option cards, and the changed fields — built from the 409 itself, never a refetch', async () => {
        const user = userEvent.setup();
        const mine = makeRecipeDetail({ title: 'Weeknight Pasta', currentVersion: 3 });
        const theirs = makeRecipeDetail({ title: 'Server Pasta', currentVersion: 4 });
        const client = conflictClient(mine, theirs);
        const getRecipeSpy = vi.mocked(client.getRecipeById);

        renderWithRecipeClient(<RecipeEditContainer locale="en" recipeId="rec_1" />, client);

        await user.type(await screen.findByRole('textbox', { name: 'Title' }), ' Deluxe');
        await goToReview(user);
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
        // The conflict view is built straight off the 409's OWN server/base sides — no follow-up round-trip.
        expect(getRecipeSpy).toHaveBeenCalledTimes(1);
    });

    // Phantom fast-path (W7 Task 2, wired through the container in Task 6): a 409 whose 3-way diff is EMPTY
    // (the user's in-progress edit already matches what the server saved) never interrupts the user with the
    // conflict UI — the hook resubmits the SAME draft against the fresh CAS token behind the scenes instead.
    it('a phantom zero-diff 409 auto-resolves without ever showing the conflict UI', async () => {
        const user = userEvent.setup();
        // `theirs` already carries the EXACT title the user is about to type — every other field matches the
        // shared fixture defaults, so mine/theirs agree on every field once the edit lands: the diff is empty.
        const mine = makeRecipeDetail({ title: 'Weeknight Pasta', currentVersion: 3 });
        const theirs = makeRecipeDetail({ title: 'Weeknight Pasta Deluxe', currentVersion: 4 });
        const client = conflictClient(mine, theirs);
        const updateSpy = vi.mocked(client.updateRecipe);

        renderWithRecipeClient(<RecipeEditContainer locale="en" recipeId="rec_1" />, client);

        await user.type(await screen.findByRole('textbox', { name: 'Title' }), ' Deluxe');
        await goToReview(user);
        await user.click(screen.getByRole('button', { name: 'Publish' }));

        await vi.waitFor(() => expect(pushMock).toHaveBeenCalledWith('/en/recipes/rec_1'));
        expect(updateSpy).toHaveBeenCalledTimes(2);
        const [, secondInput] = updateSpy.mock.calls[1]!;
        expect(secondInput.expectedVersion).toBe(4);
        // The conflict view was NEVER shown — the phantom 409 auto-resolved instead of interrupting the user.
        expect(screen.queryByText('This recipe changed while you were editing')).not.toBeInTheDocument();
    });

    it('Option B (overwrite) re-submits against the server’s fresh currentVersion and navigates on success', async () => {
        const user = userEvent.setup();
        const mine = makeRecipeDetail({ title: 'Weeknight Pasta', currentVersion: 3 });
        const theirs = makeRecipeDetail({ title: 'Server Pasta', currentVersion: 4 });
        const client = conflictClient(mine, theirs);
        const updateSpy = vi.mocked(client.updateRecipe);

        renderWithRecipeClient(<RecipeEditContainer locale="en" recipeId="rec_1" />, client);

        await user.type(await screen.findByRole('textbox', { name: 'Title' }), ' Deluxe');
        await goToReview(user);
        await user.click(screen.getByRole('button', { name: 'Publish' }));

        // This fake conflict carries no `base` (W8-a.5 real conflicts may also lack one — the base-evicted
        // case), so the W7 Task 5 / X6 stale-base gate applies: confirm before Overwrite proceeds.
        await screen.findByRole('button', { name: 'Overwrite with your version' });
        await user.click(screen.getByRole('checkbox', { name: 'I understand — continue anyway' }));
        await user.click(screen.getByRole('button', { name: 'Overwrite with your version' }));

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
        await goToReview(user);
        await user.click(screen.getByRole('button', { name: 'Publish' }));

        // Enter the merge panel and pull servings from the latest saved version, keeping my title. This fake
        // conflict carries no `base`, so the W7 Task 5 / X6 stale-base gate applies here too.
        await user.click(await screen.findByRole('button', { name: 'Merge manually' }));
        const servingsGroup = screen.getByRole('radiogroup', { name: 'Servings' });
        await user.click(within(servingsGroup).getByRole('radio', { name: 'Latest saved version: 8' }));
        await user.click(screen.getByRole('checkbox', { name: 'I understand — continue anyway' }));
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
    // `useRecipeEditor`'s module doc). OQ-1 (W7 Task 6): a discard still navigates to the SAME recipe detail
    // route a save's `onSaved` uses, just without any "Saved!" messaging (there is none to suppress today —
    // the container's own effect fires only off `status: 'discarded'`, never `'saved'`).
    it('Option A (keep server) discards without a write, then navigates to the detail route (no "Saved!" messaging)', async () => {
        const user = userEvent.setup();
        const mine = makeRecipeDetail({ title: 'Weeknight Pasta', currentVersion: 3 });
        const theirs = makeRecipeDetail({ title: 'Server Pasta', currentVersion: 4 });
        const client = conflictClient(mine, theirs);
        const updateSpy = vi.mocked(client.updateRecipe);

        renderWithRecipeClient(<RecipeEditContainer locale="en" recipeId="rec_1" />, client);

        await user.type(await screen.findByRole('textbox', { name: 'Title' }), ' Deluxe');
        await goToReview(user);
        await user.click(screen.getByRole('button', { name: 'Publish' }));

        await user.click(await screen.findByRole('button', { name: 'Keep server version' }));

        expect(screen.queryByText('This recipe changed while you were editing')).not.toBeInTheDocument();
        expect(updateSpy).toHaveBeenCalledTimes(1); // only the original (rejected) submit — no resubmit.
        await vi.waitFor(() => expect(pushMock).toHaveBeenCalledWith('/en/recipes/rec_1'));
        // No success indication anywhere in the document — a discard never wrote anything.
        expect(screen.queryByText(/saved/i)).not.toBeInTheDocument();
    });

    // "Discard and close" (wireframe gap #1 — MAJOR wireframe-parity fix) is the conflict view's header exit:
    // unlike the three A/B/C options, it never resolves anything — it reuses the SAME `status: 'discarded'`
    // terminal `keepServer` produces (see `useRecipeEditor`'s module doc), so this container's existing
    // `discarded` → detail-route `useEffect` fires identically, with no separate wiring.
    it('"Discard and close" exits the conflict view WITHOUT submitting any resolution, then navigates to the detail route', async () => {
        const user = userEvent.setup();
        const mine = makeRecipeDetail({ title: 'Weeknight Pasta', currentVersion: 3 });
        const theirs = makeRecipeDetail({ title: 'Server Pasta', currentVersion: 4 });
        const client = conflictClient(mine, theirs);
        const updateSpy = vi.mocked(client.updateRecipe);

        renderWithRecipeClient(<RecipeEditContainer locale="en" recipeId="rec_1" />, client);

        await user.type(await screen.findByRole('textbox', { name: 'Title' }), ' Deluxe');
        await goToReview(user);
        await user.click(screen.getByRole('button', { name: 'Publish' }));

        await screen.findByText('This recipe changed while you were editing');
        updateSpy.mockClear(); // isolate the assertion below to what "Discard and close" itself does.

        await user.click(screen.getByRole('button', { name: 'Discard and close' }));

        expect(screen.queryByText('This recipe changed while you were editing')).not.toBeInTheDocument();
        // The mutate boundary was never touched by the discard itself — no resolution was submitted.
        expect(updateSpy).not.toHaveBeenCalled();
        await vi.waitFor(() => expect(pushMock).toHaveBeenCalledWith('/en/recipes/rec_1'));
        expect(screen.queryByText(/saved/i)).not.toBeInTheDocument();
    });

    // Opus-review-class gap (W7 Task 2's `conflictDataUnavailable`, wired through the container in Task 6): a
    // 409 that IS a VersionConflictError but carries no `server` side (a malformed/un-enriched body) cannot be
    // 3-way-diffed or displayed — without this flag the user would click Save, eat a 409, and see nothing.
    it('shows a localized, actionable error when the 409 cannot be resolved into a conflict view, and stays editing (retryable)', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'getRecipeById').mockResolvedValue(
            makeRecipeDetail({ title: 'Weeknight Pasta', currentVersion: 3 }),
        );
        vi.spyOn(client, 'updateRecipe').mockRejectedValue(
            new VersionConflictError(undefined, 3, 'Recipe version conflict'),
        );

        renderWithRecipeClient(<RecipeEditContainer locale="en" recipeId="rec_1" />, client);

        await user.type(await screen.findByRole('textbox', { name: 'Title' }), ' Deluxe');
        await goToReview(user);
        await user.click(screen.getByRole('button', { name: 'Publish' }));

        expect(await screen.findByText('This recipe was changed elsewhere. Reload and try again.')).toBeInTheDocument();
        // Never the fabricated conflict view — there is no server/base to build it from.
        expect(screen.queryByText('This recipe changed while you were editing')).not.toBeInTheDocument();
        // Stays editing (retryable) — the typed edit survived the recoverable error. REWRITTEN for U33: the
        // Preview overlay this used to open is deleted, and the step the blocked Publish left us on IS the
        // read-only summary now, so the live draft is confirmed straight from the Review body. That is
        // strictly better evidence: it reads the surface a cook is actually looking at, and it needs no
        // toggle to avoid tripping the backward-nav discard guard.
        expect(
            within(screen.getByRole('region', { name: 'Review' })).getByText('Weeknight Pasta Deluxe'),
        ).toBeInTheDocument();
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
        await openActionsMenu(user);
        await user.click(screen.getByRole('menuitem', { name: 'Save Draft' }));

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
        await openActionsMenu(user);
        await user.click(screen.getByRole('menuitem', { name: 'Save Draft' }));

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
        // Publish is the footer's final-step primary (U6: no longer live on steps 1–3); reach it via the rail,
        // whose FORWARD navigation is ungated even though the Ingredients step is invalid.
        await goToReview(user);
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
        await openActionsMenu(user);
        await user.click(screen.getByRole('menuitem', { name: 'Cancel' }));

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
        await openActionsMenu(user);
        await user.click(screen.getByRole('menuitem', { name: 'Cancel' }));

        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
        expect(pushMock).toHaveBeenCalledWith('/en/recipes/rec_1');
    });
});
