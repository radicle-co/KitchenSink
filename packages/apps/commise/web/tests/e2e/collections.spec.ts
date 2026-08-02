import { expect, test } from '@playwright/test';

import { route } from './utils/basePath';
import { makeCollection, makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * Collections happy path (T109, US1 — "organize recipes into collections"), driven through the real web UI
 * (Next dev server + Clerk session + client hooks + routing) with the recipe-service HTTP contract
 * intercepted (`utils/recipeApi`). The real backend is covered separately by the recipe-service's own e2e +
 * k6 tiers. Selectors are role/label only (repo policy); no `data-testid`, no `waitForTimeout`.
 *
 * Requirement → test:
 * - FR-008 (create a collection) → "creates a collection and lands on it, then lists it"
 * - FR-009 (ADD a recipe to a collection) → "adds a recipe to a collection from the picker"
 * - FR-009 (remove a recipe from a collection) + FR-008 (delete a collection)
 *   → "removes a recipe from a collection, then deletes the collection"
 * - The 404 read path (a collection that is absent or not the caller's) → "shows a not-found message …"
 * - FR-011 (clone a collection) → "clones a collection and lands on the new private clone …" (W5 Task 13)
 * - FR-011 (pull-from-source preview → commit) → "previews then commits a pull from source …" (W5 Task 13,
 *   the highest-value new spec — it exercises the Task 5/10/12 preview→commit→cache-invalidate wiring)
 * - FR-010 (premium visibility toggle, persisted) → "a premium viewer toggles a collection … and it
 *   persists" (W5 Task 13)
 * - W5/C7 (server-paged collection list "Load more") → "loads the next page of collections on demand"
 *   (W5 Task 13)
 *
 * The ADD leg drives the REAL flow end-to-end: the detail view's "Add a recipe" control → the picker route
 * → the `useAddRecipeToCollection` mutation → `POST /api/v1/collections/{id}/recipes`. The mock models membership
 * as a join (see `utils/recipeApi`), so the add is observable: the picker row flips to the inert "in this
 * collection" marker and, on return, the recipe appears as a member of the collection.
 */
test.describe('collections (T109)', () => {
    test('creates a collection and lands on it, then lists it', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, collections: [] });

        // A successful load with nothing in it is the EMPTY state, not an error.
        await page.goto(route('/collections'));
        await expect(page.getByRole('heading', { name: 'Collections' })).toBeVisible();
        await expect(page.getByText('No collections yet')).toBeVisible();

        // CREATE — name it and submit; a successful create navigates to the new collection's detail.
        await page.getByRole('button', { name: 'New collection' }).click();
        await expect(page).toHaveURL(/\/collections\/new/);

        await page.getByLabel('Collection name').fill('Weeknight dinners');
        await page.getByRole('button', { name: 'Create', exact: true }).click();

        // The detail renders the collection the server created — with no members yet.
        await expect(page).toHaveURL(/\/collections\/col_new_/);
        await expect(page.getByRole('heading', { name: 'Weeknight dinners' })).toBeVisible();
        await expect(page.getByText('No recipes in this collection yet')).toBeVisible();

        // …and it is now the caller's collection: the list shows it in place of the empty state.
        await page.goto(route('/collections'));
        await expect(page.getByRole('button', { name: 'Weeknight dinners' })).toBeVisible();
        await expect(page.getByText('No collections yet')).toHaveCount(0);
    });

    test('adds a recipe to a collection from the picker', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            recipes: [
                makeRecipeDetail({ id: 'rec_pasta', ownerId: viewerId, title: 'Weeknight Pasta' }),
                makeRecipeDetail({ id: 'rec_soup', ownerId: viewerId, title: 'Lentil Soup' }),
            ],
            // An EMPTY collection — the add flow is what puts a recipe in it.
            collections: [makeCollection({ id: 'col_dinners', ownerId: viewerId, name: 'Weeknight dinners' })],
        });

        // The empty collection offers the add affordance.
        await page.goto(route('/collections/col_dinners'));
        await expect(page.getByText('No recipes in this collection yet')).toBeVisible();
        await page.getByRole('button', { name: 'Add a recipe' }).click();

        // The picker names the collection and lists the caller's own recipes as add candidates.
        await expect(page).toHaveURL(/\/collections\/col_dinners\/add/);
        await expect(page.getByRole('heading', { name: 'Add recipes to Weeknight dinners' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Add Lentil Soup' })).toBeVisible();

        // ADD — the mutation hits the real endpoint; the row flips to the inert member marker (its add
        // control is gone) and the success is announced. This is only observable because the mock persists
        // the join, so the collection re-read returns the new member.
        await page.getByRole('button', { name: 'Add Weeknight Pasta' }).click();
        await expect(page.getByRole('button', { name: 'Weeknight Pasta is in this collection' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Add Weeknight Pasta' })).toHaveCount(0);
        await expect(page.getByRole('status').filter({ hasText: 'Added Weeknight Pasta' })).toBeVisible();

        // DONE — back on the detail view, the recipe is now a member of the collection.
        await page.getByRole('button', { name: 'Done' }).click();
        await expect(page).toHaveURL(/\/collections\/col_dinners(?:\?|$)/);
        await expect(page.getByRole('button', { name: 'Weeknight Pasta', exact: true })).toBeVisible();
        await expect(page.getByText('No recipes in this collection yet')).toHaveCount(0);
    });

    test('removes a recipe from a collection, then deletes the collection', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            recipes: [
                makeRecipeDetail({ id: 'rec_pasta', ownerId: viewerId, title: 'Weeknight Pasta' }),
                makeRecipeDetail({ id: 'rec_soup', ownerId: viewerId, title: 'Lentil Soup' }),
            ],
            // Seeded membership — the app has no add-to-collection control (see the file header).
            collections: [
                makeCollection({
                    id: 'col_dinners',
                    ownerId: viewerId,
                    name: 'Weeknight dinners',
                    recipeIds: ['rec_pasta', 'rec_soup'],
                }),
            ],
        });

        // VIEW — the collection detail lists exactly its members. `exact` matters: each row's remove
        // control is named "Remove <title>", which a substring match would also select.
        await page.goto(route('/collections/col_dinners'));
        await expect(page.getByRole('heading', { name: 'Weeknight dinners' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Weeknight Pasta', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Lentil Soup', exact: true })).toBeVisible();

        // REMOVE — the removed member disappears; the other one is untouched.
        await page.getByRole('button', { name: 'Remove Weeknight Pasta' }).click();
        await expect(page.getByRole('button', { name: 'Weeknight Pasta', exact: true })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Lentil Soup', exact: true })).toBeVisible();

        // DELETE — the collection goes and the app lands back on the (now empty) list.
        await page.getByRole('button', { name: 'Delete', exact: true }).click();
        await expect(page).toHaveURL(/\/collections(?:\?|$)/);
        await expect(page.getByText('No collections yet')).toBeVisible();
    });

    test('shows a not-found message for a collection that is not the caller’s', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, collections: [] });

        // Proves the whole wire→UI error chain, which no component test can: a real HTTP 404 must travel
        // through ky → the client's `NotFoundError` → `isNotFoundError` → the localized not-found copy.
        // A generic error message here means the 404 lost its type on the way up.
        //
        // The long timeout is not padding — it is the cost of a real defect: `RecipeProviders` builds a
        // bare `new QueryClient()`, so TanStack Query's DEFAULT retry (3 attempts, exponential backoff)
        // applies to a 404 as much as to a network blip. The user waits ~7s and the API takes 4 requests
        // to say "no". Scoped here rather than papered over globally; see the T109 report / follow-ups.
        // The `filter` is not decoration: Next's App Router injects its own permanent
        // `<div role="alert" id="__next-route-announcer__">`, so "the" alert has to be named by its copy.
        // This still fails for every regression worth catching — a plain <div> (no alert role) or the
        // GENERIC error copy (a 404 that lost its type on the way up) both leave it unmatched.
        await page.goto(route('/collections/col_missing'));
        const notFound = page.getByRole('alert').filter({ hasText: 'We couldn’t find that collection.' });
        await expect(notFound).toBeVisible({ timeout: 20_000 });
        // A not-found is terminal — retrying it would just 404 again, so no retry action is offered.
        await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
    });

    /**
     * Clone (FR-011, W5 Task 13). There is no collection-DISCOVERY surface in this app (only `/discover` for
     * public recipes), so the reachable path the UI actually exposes is cloning a collection the caller
     * already owns — the same self-clone reasoning the Maestro mirror (`collections-clone.yaml`) documents.
     * The service's own `cloneCollection` guard only blocks a NON-owned, NON-public source, so a self-owned
     * PUBLIC collection clones unconditionally and exercises the real endpoint/UI wiring end-to-end.
     */
    test('clones a collection and lands on the new private clone with source attribution', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        const recipe = makeRecipeDetail({
            id: 'rec_family',
            ownerId: viewerId,
            title: 'Family Lasagna',
            visibility: 'public',
        });
        const source = makeCollection({
            id: 'col_source',
            ownerId: viewerId,
            name: 'Sunday Suppers',
            visibility: 'public',
            recipeIds: ['rec_family'],
        });
        await mockRecipeApi(page, {
            viewerId,
            recipes: [recipe],
            collections: [source],
            authorHandles: { [viewerId]: 'chef_e2e' },
        });

        await page.goto(route('/collections/col_source'));
        await expect(page.getByRole('heading', { name: 'Sunday Suppers' })).toBeVisible();

        await page.getByRole('button', { name: 'Clone Collection' }).click();

        // A successful clone navigates to the NEW clone's own detail.
        await expect(page).toHaveURL(/\/collections\/col_clone_/);
        await expect(page.getByRole('heading', { name: 'Sunday Suppers' })).toBeVisible();

        // A clone always starts PRIVATE (FR-010), regardless of the source's own visibility.
        await expect(page.getByRole('radio', { name: 'Private' })).toBeChecked();

        // The Clone Info panel (C5) renders ONLY for a real clone, with the source attribution FROZEN at
        // clone time (W5 Task 2) — proving this is a genuine clone, not merely a same-named collection.
        const cloneInfo = page.getByRole('region', { name: 'Clone Info' });
        await expect(cloneInfo).toBeVisible();
        await expect(cloneInfo.getByText('@chef_e2e / "Sunday Suppers"')).toBeVisible();

        // The seeded member carried over as a `clone_seed` row.
        await expect(page.getByRole('button', { name: 'Family Lasagna', exact: true })).toBeVisible();
    });

    /**
     * Pull-from-source preview → commit (FR-011, W5 Task 13 — the highest-value new spec). Opens a CLONED
     * collection whose source has drifted ahead by one recipe since the clone, runs the preview (asserting
     * the diff-driven counts before anything is applied), then commits and asserts the new member actually
     * lands as a real member row and "Last pulled" appears — not merely that the dialog closed.
     */
    test('previews then commits a pull from source, adding the new member and stamping last-pulled', async ({
        page,
    }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        const sourceOwnerId = 'usr_chef_marco';
        const risotto = makeRecipeDetail({
            id: 'rec_risotto',
            ownerId: sourceOwnerId,
            title: 'Herb Risotto',
            visibility: 'public',
        });
        const duck = makeRecipeDetail({
            id: 'rec_duck',
            ownerId: sourceOwnerId,
            title: 'Pan-Seared Duck',
            visibility: 'public',
        });
        const tart = makeRecipeDetail({
            id: 'rec_tart',
            ownerId: sourceOwnerId,
            title: 'Lemon Tart',
            visibility: 'public',
        });
        const source = makeCollection({
            id: 'col_source',
            ownerId: sourceOwnerId,
            name: 'Weekend Picks',
            visibility: 'public',
            recipeIds: ['rec_risotto', 'rec_duck', 'rec_tart'],
        });
        // The clone was seeded BEFORE "Lemon Tart" existed in the source — the source has since drifted
        // ahead by exactly that one recipe, which the preview/commit below must surface.
        const clone = makeCollection({
            id: 'col_clone',
            ownerId: viewerId,
            name: 'Weekend Picks',
            visibility: 'private',
            recipeIds: ['rec_risotto', 'rec_duck'],
            memberAddedVia: { rec_risotto: 'clone_seed', rec_duck: 'clone_seed' },
            sourceCollectionId: 'col_source',
            sourceOwnerHandle: 'chef_marco',
            sourceCollectionName: 'Weekend Picks',
        });
        await mockRecipeApi(page, { viewerId, recipes: [risotto, duck, tart], collections: [source, clone] });

        await page.goto(route('/collections/col_clone'));
        await expect(page.getByRole('heading', { name: 'Weekend Picks' })).toBeVisible();

        await page.getByRole('button', { name: 'Pull Updates from Source' }).click();

        // The preview dialog opens on the diff-driven counts — before anything is applied.
        await expect(page.getByRole('heading', { name: 'Pull Updates from Source Collection' })).toBeVisible();
        await expect(page.getByText('1 new public recipes will be added')).toBeVisible();
        await expect(page.getByText('0 recipes removed from source')).toBeVisible();
        await expect(page.getByText('2 already in this collection (no changes)')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Lemon Tart', exact: true })).toHaveCount(0);
        // No "Last pulled" yet — this clone has never been pulled.
        await expect(page.getByText(/Last pulled:/)).toHaveCount(0);

        await page.getByRole('button', { name: 'Pull 1 Recipes' }).click();

        // The dialog closes; the pulled member is now a real row, and "Last pulled" renders in the header —
        // the two signals that prove the pull actually APPLIED, not merely that the dialog closed.
        await expect(page.getByRole('heading', { name: 'Pull Updates from Source Collection' })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Lemon Tart', exact: true })).toBeVisible();
        await expect(page.getByText(/Last pulled:/)).toBeVisible();

        // The pre-existing (clone_seed) members are untouched by the pull.
        await expect(page.getByRole('button', { name: 'Herb Risotto', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Pan-Seared Duck', exact: true })).toBeVisible();
    });

    /**
     * Visibility toggle, premium-gated (FR-010, C1, W5 Task 13). The mocked viewer profile defaults to
     * `tier: 'premium'` (`utils/recipeApi`'s `mockRecipeApi`), stated explicitly here so the premium gate is
     * OPEN; a free-tier gated case is covered end-to-end by the recipe-level `cloneVisibility.spec.ts` and,
     * for THIS surface, by the component tests (`CollectionDetailContainer.test.tsx`) — the shared
     * `canGoPrivate` predicate is identical across both surfaces, so re-proving the gate itself here would be
     * redundant coverage, not new signal.
     */
    test('a premium viewer toggles a collection from public to private and it persists', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        const collection = makeCollection({
            id: 'col_dinners',
            ownerId: viewerId,
            name: 'Weeknight dinners',
            visibility: 'public',
        });
        await mockRecipeApi(page, { viewerId, tier: 'premium', collections: [collection] });

        await page.goto(route('/collections/col_dinners'));
        await expect(page.getByRole('heading', { name: 'Weeknight dinners' })).toBeVisible();

        const privateOption = page.getByRole('radio', { name: 'Private' });
        await expect(privateOption).toBeEnabled();
        await expect(privateOption).not.toBeChecked();

        const saveButton = page.getByRole('button', { name: 'Save changes' });
        await expect(saveButton).toBeDisabled();

        // SELECT — a pending (unsaved) choice; nothing has been written yet.
        await privateOption.click();
        await expect(privateOption).toBeChecked();
        await expect(saveButton).toBeEnabled();

        // SAVE — the mutation fires; on success the collection detail is refetched.
        await saveButton.click();

        // PERSISTED — once the refetch resolves, the server-reported visibility matches the pending
        // selection again, so Save goes back to disabled. That transition can only happen via a real 200
        // from `PATCH /api/v1/collections/{id}` and a subsequent GET, not from local state alone.
        await expect(saveButton).toBeDisabled();
    });

    /**
     * Pagination — server-paged "Load more" (W5/C7, W5 Task 13). Seeds more collections than fit on one
     * (mock-configured, small) page, so the control is guaranteed to render on the FIRST load, then asserts
     * the next page's row appears — and the control itself vanishes — once the last page has loaded.
     */
    test('loads the next page of collections on demand', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            collectionsPageSize: 2,
            collections: [
                makeCollection({ id: 'col_1', ownerId: viewerId, name: 'Weeknight dinners' }),
                makeCollection({ id: 'col_2', ownerId: viewerId, name: 'Holiday baking' }),
                makeCollection({ id: 'col_3', ownerId: viewerId, name: 'Sunday brunch' }),
            ],
        });

        await page.goto(route('/collections'));

        // FIRST PAGE — exactly the mocked page size; the third collection is not yet loaded.
        await expect(page.getByRole('button', { name: 'Weeknight dinners' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Holiday baking' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Sunday brunch' })).toHaveCount(0);

        const loadMore = page.getByRole('button', { name: 'Load more' });
        await expect(loadMore).toBeVisible();

        await loadMore.click();

        // SECOND PAGE — appended (not replacing) the first; the control disappears once the last page,
        // which reports no further pages, has loaded.
        await expect(page.getByRole('button', { name: 'Sunday brunch' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Load more' })).toHaveCount(0);
    });
});
