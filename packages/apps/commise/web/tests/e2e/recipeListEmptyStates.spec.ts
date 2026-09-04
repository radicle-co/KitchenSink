import { expect, test } from '@playwright/test';

import { route } from './utils/basePath';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * The recipe list's ZERO-ROW states, driven through the real web UI (Next dev server + Clerk session + the
 * SSR prefetch/hydration boundary + client hooks) with the recipe-service HTTP contract intercepted
 * (`utils/recipeApi`). Selectors are role/label only (repo policy); no `data-testid`, no `waitForTimeout`.
 *
 * **Why this file exists.** A first-run account — the very first screen a new user sees — reached the owner
 * showing a permanent loading skeleton, and no spec in this suite could have caught it, because
 * `mockRecipeApi` SEEDS ONE RECIPE by default: nothing here had ever rendered `/recipes` with an empty
 * library. The one spec that touched the state (`recipeCrud.spec.ts`) asserted a permissive
 * `/New recipe|Create your first recipe/` alternation, which passes in EITHER state and therefore cannot
 * report which one the page is in. A test written to be tolerant hid the defect.
 *
 * So both specs below assert their state POSITIVELY, by the copy only that state renders, and pin the
 * discriminators that the tolerant assertion threw away:
 *
 *  - **No live loading region.** `RecipeCardGridSkeleton` renders `role="status"` captioned "Loading
 *    recipes"; a settled first-run list must not carry one. This is the assertion that fails against the
 *    reported bug — an unbounded client wait leaves `status === 'loading'` forever, so the skeleton stays and
 *    the empty branch is never reached (see `DEFAULT_REQUEST_TIMEOUT_MS` in the recipe-service client).
 *  - **Which create control is on screen (L1: exactly one per state).** The pinned FAB ("New recipe") is
 *    present while erroring and while populated, and SUPPRESSED in the true empty state, where the
 *    empty-state CTA ("Create your first recipe") takes over. The PAIR is the discriminator — the FAB alone
 *    is not, which is exactly why the mobile `list-detail` flow's `assertVisible: 'New recipe'` also passed
 *    against a hung load.
 *
 *    ⚠️ The FAB is now withheld while the list is LOADING as well, so its absence no longer separates
 *    first-run from a hung skeleton on its own — the live-region assertion above carries that alone. It was
 *    mounted over an unsettled list and then unmounted as the empty library resolved, taking an already-open
 *    create menu with it; `shouldShowCreateDial`'s JSDoc has the account.
 *
 * The second spec pins the state a recently-fixed defect got WRONG: a quick-filter chip that narrows to zero
 * is a NO-MATCH (the viewer has recipes; their own criteria excluded them), never first-run — it keeps the
 * FAB and must never show "No recipes yet"/"Create your first recipe". Both leaves derive that from the one
 * shared `isListNarrowed` predicate; this is its observable proof on the real surface.
 */
test.describe('recipe list — zero-row states', () => {
    test('a first-run library renders the empty state, not a permanent skeleton', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        // The whole point: an EMPTY library. The mock's default seed (one recipe) is what hid this state.
        await mockRecipeApi(page, { viewerId, tier: 'premium', recipes: [] });

        // A successful load with nothing in it is the EMPTY state — not an error, and not a wait.
        await page.goto(route('/recipes'));
        await expect(page.getByRole('heading', { name: 'Recipes' })).toBeVisible();
        await expect(page.getByText('No recipes yet')).toBeVisible();
        await expect(page.getByText('Create your first recipe to see it here.')).toBeVisible();

        // The empty-state CTA is the SOLE create control here, and the pinned FAB is suppressed (L1) — the
        // PAIR is what names this state. ⚠️ The FAB's absence alone no longer separates first-run from a
        // stuck skeleton: it is now withheld while the list is LOADING too (it used to mount over an
        // unsettled library and then unmount as the empty state resolved). The live-region assertion below
        // carries that discrimination on its own.
        await expect(page.getByRole('button', { name: 'Create your first recipe' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'New recipe' })).toHaveCount(0);

        // …and the list has SETTLED: no live "Loading recipes" region survives alongside the empty state.
        // Asserted after the positive copy above, so it cannot pass merely by running before the skeleton
        // mounts. This is the assertion that fails when the request never resolves.
        await expect(page.getByRole('status', { name: 'Loading recipes' })).toHaveCount(0);

        // The empty state is not a dead end: its CTA opens the create wizard.
        await page.getByRole('button', { name: 'Create your first recipe' }).click();
        await expect(page).toHaveURL(/\/recipes\/new/);
    });

    test('a chip-narrowed zero is a no-match — it keeps the FAB and never the first-run copy', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        // Two recipes whose facets do NOT intersect: one vegetarian but slow, one quick but not vegetarian.
        // Selecting both chips (they AND together) is therefore the only way to reach zero rows from a
        // library that genuinely has recipes — a single chip can never do it, since the chips are DERIVED
        // from the loaded rows.
        await mockRecipeApi(page, {
            viewerId,
            tier: 'premium',
            recipes: [
                makeRecipeDetail({
                    id: 'rec_slow_veg',
                    ownerId: viewerId,
                    title: 'Slow Ratatouille',
                    dietaryFlags: ['Vegetarian'],
                    totalTimeMinutes: 45,
                }),
                makeRecipeDetail({
                    id: 'rec_quick_steak',
                    ownerId: viewerId,
                    title: 'Quick Steak Bites',
                    dietaryFlags: [],
                    totalTimeMinutes: 10,
                }),
            ],
        });

        await page.goto(route('/recipes'));
        await expect(page.getByRole('button', { name: 'Slow Ratatouille' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Quick Steak Bites' })).toBeVisible();

        const chips = page.getByRole('group', { name: 'Quick filters' });
        await chips.getByRole('button', { name: 'Vegetarian' }).click();
        await expect(page.getByRole('button', { name: 'Quick Steak Bites' })).toHaveCount(0);

        // Both chips active → no recipe satisfies all of them. The rows are gone because the VIEWER narrowed
        // them, so this is the no-match state, with the first-run copy nowhere on the page.
        await chips.getByRole('button', { name: 'Quick (<30m)' }).click();
        await expect(page.getByRole('button', { name: 'Slow Ratatouille' })).toHaveCount(0);
        await expect(page.getByText('No matching recipes')).toBeVisible();
        await expect(page.getByText('No recipes yet')).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Create your first recipe' })).toHaveCount(0);

        // …and the viewer is not stranded: the no-match body carries no CTA, so the pinned FAB must survive
        // (the defect suppressed it here, leaving the state with no create affordance at all).
        await expect(page.getByRole('button', { name: 'New recipe' })).toBeVisible();

        // Clearing the chips restores the full library — the narrowing is derived, never destructive.
        await chips.getByRole('button', { name: 'All' }).click();
        await expect(page.getByRole('button', { name: 'Slow Ratatouille' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Quick Steak Bites' })).toBeVisible();
    });
});
