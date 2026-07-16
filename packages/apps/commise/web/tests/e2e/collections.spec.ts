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
 *
 * The ADD leg drives the REAL flow end-to-end: the detail view's "Add a recipe" control → the picker route
 * → the `useAddRecipeToCollection` mutation → `POST /v1/collections/{id}/recipes`. The mock models membership
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
});
