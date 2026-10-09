import { expect, test } from '@playwright/test';

import { route } from './utils/basePath';
import { simulateOutage } from './utils/outage';
import { E2E_RECIPE_IDS, makeCollection, makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * Recipe ids as UUIDs rather than readable `rec_*` slugs, because this spec puts a recipe id in a REQUEST BODY:
 * `addRecipeToCollectionRequestSchema.recipeId` is `z.uuid()`, and the client parses outbound — so a slug makes
 * "add to collection" throw `InvalidRequestError` before any request, leaving the membership silently absent. It is
 * not the only body that carries one: every card grid's deferred calorie batch does too (`E2E_RECIPE_IDS` in
 * `utils/recipeApi` records that trap), so a `rec_*` slug on any card surface silently skips its calorie request.
 */
const RECIPE_IDS = {
    pasta: E2E_RECIPE_IDS.pasta,
    soup: E2E_RECIPE_IDS.lentilSoup,
    family: E2E_RECIPE_IDS.familyStew,
    risotto: E2E_RECIPE_IDS.risotto,
    duck: E2E_RECIPE_IDS.duck,
    tart: E2E_RECIPE_IDS.tart,
} as const;

/**
 * Collections happy path (T109, US1 — "organize recipes into collections"), driven through the real web UI
 * (Next dev server + Clerk session + client hooks + routing) with the recipe-service HTTP contract
 * intercepted (`utils/recipeApi`). The real backend is covered separately by the recipe-service's own e2e +
 * k6 tiers. Selectors are role/label only (repo policy); no `data-testid`, no `waitForTimeout`.
 *
 * Requirement → test:
 * - FR-008 (create a collection) → "creates a collection and lands on it, then lists it"
 * - FR-009 (ADD a recipe to a collection) → `collectionPicker.spec.ts` (the add-recipes sheet)
 * - FR-009 (remove a recipe from a collection, with Undo) + FR-008 (delete a collection)
 *   → "removes a recipe from a collection, then deletes the collection"
 * - The 404 read path (a collection that is absent or not the caller's) → "shows a not-found message …"
 * - FR-011 (clone a collection) → "clones a collection and lands on the new private clone …" (W5 Task 13)
 * - FR-011 (pull-from-source preview → commit) → "previews then commits a pull from source …" (W5 Task 13,
 *   the highest-value new spec — it exercises the Task 5/10/12 preview→commit→cache-invalidate wiring)
 * - FR-010 (premium visibility toggle, persisted) → "a premium viewer toggles a collection … and it
 *   persists" (W5 Task 13)
 * - W5/C7 (server-paged collection list "Load more") → "loads the next page of collections on demand"
 *   (W5 Task 13)
 * - A failed read recovers through the boundary's retry, on the detail, picker and rename routes →
 *   "recovering from a failed read"
 *
 * Slice 5 (`buildSpec.md` §5.2, §5.3): the detail screen has one primary (Add recipes) and one ⋯ menu named for the
 * collection (Rename · Make private/public · Save a copy · Pull updates for a copy · Delete collection). Rename is a
 * sheet, delete a confirmation, removing a member hides it and offers Undo, and Add recipes opens the picker sheet. The
 * `/collections/{id}/add` and `/rename` routes are gone.
 */
test.describe('collections (T109)', () => {
    test('creates a collection and lands on it, then lists it', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, collections: [] });

        // A successful load with nothing in it is the EMPTY state, not an error.
        await page.goto(route('/collections'));
        // Collections is a segment of the Recipes tab, so the large title is "Recipes" (slice 3).
        await expect(page.getByRole('heading', { level: 1, name: 'Recipes' })).toBeVisible();
        await expect(page.getByRole('heading', { level: 2, name: 'Group recipes your way' })).toBeVisible();

        // CREATE — slice 4 (`buildSpec.md` §5.1): the new-collection SHEET, over the list (the page is deleted). Name
        // it and submit; a successful create closes the sheet and opens the new collection's detail.
        await page.getByRole('button', { name: 'New collection' }).first().click();
        const sheet = page.getByRole('dialog', { name: 'New collection' });
        await expect(sheet).toBeVisible();
        await expect(page).toHaveURL(/\/collections$/);

        await sheet.getByRole('textbox', { name: 'Name' }).fill('Weeknight dinners');
        await sheet.getByRole('button', { name: 'Create collection' }).click();

        // The detail renders the collection the server created — with no members yet.
        await expect(page).toHaveURL(/\/collections\/col_new_/);
        await expect(page.getByRole('heading', { name: 'Weeknight dinners' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'No recipes here yet' })).toBeVisible();

        // …and it is now the caller's collection: the list shows it in place of the empty state.
        await page.goto(route('/collections'));
        await expect(page.getByRole('link', { name: 'Weeknight dinners' })).toBeVisible();
        await expect(page.getByText('Group recipes your way')).toHaveCount(0);
    });

    test('removes a recipe from a collection, with Undo, then deletes the collection', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            recipes: [
                makeRecipeDetail({ id: RECIPE_IDS.pasta, ownerId: viewerId, title: 'Weeknight Pasta' }),
                makeRecipeDetail({ id: RECIPE_IDS.soup, ownerId: viewerId, title: 'Lentil Soup' }),
            ],
            collections: [
                makeCollection({
                    id: 'col_dinners',
                    ownerId: viewerId,
                    name: 'Weeknight dinners',
                    recipeIds: [RECIPE_IDS.pasta, RECIPE_IDS.soup],
                }),
            ],
        });

        // VIEW — the collection detail lists exactly its members, each card a link named by its recipe.
        await page.goto(route('/collections/col_dinners'));
        await expect(page.getByRole('heading', { level: 1, name: 'Weeknight dinners' })).toBeVisible();
        await expect(page.getByRole('link', { name: 'Weeknight Pasta', exact: true })).toBeVisible();
        await expect(page.getByRole('link', { name: 'Lentil Soup', exact: true })).toBeVisible();

        // REMOVE — the row leaves at once and a snackbar offers Undo; nothing has been sent yet.
        await page.getByRole('button', { name: 'More actions for Weeknight Pasta' }).click();
        await page.getByRole('menuitem', { name: 'Remove from collection' }).click();
        await expect(page.getByRole('link', { name: 'Weeknight Pasta', exact: true })).toHaveCount(0);
        await expect(page.getByText('Removed Weeknight Pasta from Weeknight dinners.')).toBeVisible();
        await expect(page.getByRole('link', { name: 'Lentil Soup', exact: true })).toBeVisible();

        // UNDO — the row is back, and a reload proves the removal was never sent.
        await page.getByRole('button', { name: 'Undo' }).click();
        await expect(page.getByRole('link', { name: 'Weeknight Pasta', exact: true })).toBeVisible();
        await page.reload();
        await expect(page.getByRole('link', { name: 'Weeknight Pasta', exact: true })).toBeVisible();

        // REMOVE again and let the snackbar run out: the removal is sent, and a reload proves it landed. The send
        // follows the snackbar's timeout by a render, so the reload waits for the request itself: reloading the moment
        // the text leaves raced it and could abort the removal before it went.
        const removal = page.waitForResponse(
            (response) =>
                response.request().method() === 'DELETE' &&
                /\/api\/v1\/collections\/col_dinners\/recipes\/[^/]+$/u.test(response.url()),
            { timeout: 20_000 },
        );
        await page.getByRole('button', { name: 'More actions for Weeknight Pasta' }).click();
        await page.getByRole('menuitem', { name: 'Remove from collection' }).click();
        await expect(page.getByText('Removed Weeknight Pasta from Weeknight dinners.')).toHaveCount(0, {
            timeout: 15_000,
        });
        expect((await removal).status()).toBe(204);
        await page.reload();
        await expect(page.getByRole('link', { name: 'Lentil Soup', exact: true })).toBeVisible();
        await expect(page.getByRole('link', { name: 'Weeknight Pasta', exact: true })).toHaveCount(0);

        // DELETE — a confirmation names what stays; Keep leaves it alone, Delete goes and lands on the (empty) list.
        await page.getByRole('button', { name: 'More actions for Weeknight dinners' }).click();
        await page.getByRole('menuitem', { name: 'Delete collection' }).click();
        const confirm = page.getByRole('alertdialog', { name: 'Delete Weeknight dinners?' });
        await confirm.getByRole('button', { name: 'Keep collection' }).click();
        await expect(confirm).toHaveCount(0);

        await page.getByRole('button', { name: 'More actions for Weeknight dinners' }).click();
        await page.getByRole('menuitem', { name: 'Delete collection' }).click();
        await page
            .getByRole('alertdialog', { name: 'Delete Weeknight dinners?' })
            .getByRole('button', { name: 'Delete collection' })
            .click();
        await expect(page).toHaveURL(/\/collections(?:\?|$)/);
        await expect(page.getByText('Group recipes your way')).toBeVisible();
    });

    test('renames a collection in the sheet, which opens filled in', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            collections: [makeCollection({ id: 'col_dinners', ownerId: viewerId, name: 'Weeknight dinners' })],
        });

        await page.goto(route('/collections/col_dinners'));
        await page.getByRole('button', { name: 'More actions for Weeknight dinners' }).click();
        await page.getByRole('menuitem', { name: 'Rename' }).click();

        const sheet = page.getByRole('dialog', { name: 'Rename collection' });
        const name = sheet.getByRole('textbox', { name: 'Name' });
        await expect(name).toHaveValue('Weeknight dinners');
        // No page of its own: the URL stays on the collection.
        await expect(page).toHaveURL(/\/collections\/col_dinners$/);

        await name.fill('Weeknights');
        await sheet.getByRole('button', { name: 'Save name' }).click();

        await expect(sheet).toHaveCount(0);
        await expect(page.getByRole('heading', { level: 1, name: 'Weeknights' })).toBeVisible();
    });

    test('shows a not-found message for a collection that is not the caller’s', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, collections: [] });

        // Proves the whole wire→UI error chain, which no component test can: a real HTTP 404 must travel
        // through ky → the client's `NotFoundError` → `isNotFoundError` → the localized not-found copy.
        // A generic error message here means the 404 lost its type on the way up.
        //
        // ⛔ NO EXPLICIT TIMEOUT — Playwright's default is part of the assertion now. This used to carry a
        // 20s bound and a paragraph explaining that the wait was REAL: `RecipeProviders` built a bare
        // `new QueryClient()`, so TanStack's default `retry: 3` with exponential backoff applied to a 404
        // as much as to a network blip, and the cook waited ~7s while the API took four requests to say
        // "no". That is fixed — the shared retry policy in `@commise/query` refuses to retry a failure
        // that repeating cannot fix — so the generous bound became the thing HIDING a regression. At the
        // default, a 404 that starts retrying again fails here instead of passing slowly.
        //
        // (The old comment pointed at "the T109 follow-ups" for the fix. Nothing on disk ever tracked it:
        // T109 is a COMPLETED task about adding these very Playwright tests and says nothing about
        // retries. The pointer is removed rather than re-aimed.)
        // The `filter` is not decoration: Next's App Router injects its own permanent
        // `<div role="alert" id="__next-route-announcer__">`, so "the" alert has to be named by its copy.
        // This still fails for every regression worth catching — a plain <div> (no alert role) or the
        // GENERIC error copy (a 404 that lost its type on the way up) both leave it unmatched.
        await page.goto(route('/collections/col_missing'));
        const notFound = page.getByRole('alert').filter({ hasText: 'We couldn’t find that collection.' });
        await expect(notFound).toBeVisible();
        // A not-found is terminal — retrying it would just 404 again, so no retry action is offered.
        await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
    });

    /**
     * Recovery from a failed read, on each non-prefetched collection route. Each read suspends under ONE error
     * boundary whose "Try again" resets the boundary AND the failed query, so the retry has to issue a real
     * second request. The chain is wire → client error → boundary → reset → refetch. No component test crosses
     * the real HTTP half, and a reset that re-rendered the same rejected query would leave the error on screen.
     *
     * ⚠️ These three carry a long `LOAD_ERROR_TIMEOUT`, unlike the not-found test above, and the wait is real: a
     * `503` is exactly what the shared retry policy DOES retry (three times, TanStack's default backoff, about
     * 7 s) before the boundary sees it.
     */
    test.describe('recovering from a failed read', () => {
        /** TanStack's default backoff over `MAX_QUERY_RETRIES` (1 s + 2 s + 4 s), plus headroom for CI. */
        const LOAD_ERROR_TIMEOUT = 15_000;
        const COLLECTION_READ = /\/api\/v1\/collections\/col_dinners$/;

        test('the collection view recovers when Try again succeeds', async ({ page }) => {
            await signInWithTicket(page);
            const viewerId = await readViewerAppId(page);
            await mockRecipeApi(page, {
                viewerId,
                recipes: [makeRecipeDetail({ id: RECIPE_IDS.pasta, ownerId: viewerId, title: 'Weeknight Pasta' })],
                collections: [
                    makeCollection({
                        id: 'col_dinners',
                        ownerId: viewerId,
                        name: 'Weeknight dinners',
                        recipeIds: [RECIPE_IDS.pasta],
                    }),
                ],
            });
            const outage = await simulateOutage(page, COLLECTION_READ);

            await page.goto(route('/collections/col_dinners'));
            const loadError = page.getByRole('alert').filter({ hasText: 'We couldn’t load this collection.' });
            await expect(loadError).toBeVisible({ timeout: LOAD_ERROR_TIMEOUT });

            outage.end();
            await page.getByRole('button', { name: 'Try again' }).click();

            await expect(page.getByRole('heading', { level: 1, name: 'Weeknight dinners' })).toBeVisible();
            await expect(page.getByRole('link', { name: 'Weeknight Pasta', exact: true })).toBeVisible();
            await expect(loadError).toHaveCount(0);
        });

        test('the picker keeps Done reachable through a failed read and recovers on Try again', async ({ page }) => {
            await signInWithTicket(page);
            const viewerId = await readViewerAppId(page);
            await mockRecipeApi(page, {
                viewerId,
                recipes: [makeRecipeDetail({ id: RECIPE_IDS.soup, ownerId: viewerId, title: 'Lentil Soup' })],
                collections: [makeCollection({ id: 'col_dinners', ownerId: viewerId, name: 'Weeknight dinners' })],
            });
            await page.goto(route('/collections/col_dinners'));
            await expect(page.getByRole('heading', { level: 1, name: 'Weeknight dinners' })).toBeVisible();

            // The CANDIDATES read fails, not the collection read: the sheet's title names the collection, so the
            // frame staying named proves the frame sits outside the boundary.
            const outage = await simulateOutage(page, /\/api\/v1\/recipes(?:\?|$)/);
            await page.getByRole('button', { name: 'Add recipes' }).first().click();
            const sheet = page.getByRole('dialog', { name: 'Add to Weeknight dinners' });
            await expect(sheet.getByRole('alert').filter({ hasText: /couldn.t load/i })).toBeVisible({
                timeout: LOAD_ERROR_TIMEOUT,
            });
            await expect(sheet.getByRole('button', { name: 'Done' })).toBeVisible();

            outage.end();
            await sheet.getByRole('button', { name: 'Try again' }).click();

            await expect(sheet.getByRole('checkbox', { name: 'Lentil Soup' })).toBeVisible();
        });
    });

    /**
     * Clone (FR-011, W5 Task 13). There is no collection-DISCOVERY surface in this app (only `/discover` for
     * public recipes), so the reachable path the UI actually exposes is cloning a collection the caller
     * already owns — the same self-clone reasoning the Maestro mirror (`collectionsSaveCopy.yaml`) documents.
     * The service's own `cloneCollection` guard only blocks a NON-owned, NON-public source, so a self-owned
     * PUBLIC collection clones unconditionally and exercises the real endpoint/UI wiring end-to-end.
     */
    test('saves a copy of a collection and lands on the new private copy with source attribution', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        const recipe = makeRecipeDetail({
            id: RECIPE_IDS.family,
            ownerId: viewerId,
            title: 'Family Lasagna',
            visibility: 'public',
        });
        const source = makeCollection({
            id: 'col_source',
            ownerId: viewerId,
            name: 'Sunday Suppers',
            visibility: 'public',
            recipeIds: [RECIPE_IDS.family],
        });
        await mockRecipeApi(page, {
            viewerId,
            recipes: [recipe],
            collections: [source],
            authorHandles: { [viewerId]: 'chef_e2e' },
        });

        await page.goto(route('/collections/col_source'));
        await expect(page.getByRole('heading', { name: 'Sunday Suppers' })).toBeVisible();

        await page.getByRole('button', { name: 'More actions for Sunday Suppers' }).click();
        await page.getByRole('menuitem', { name: 'Save a copy' }).click();

        // A successful copy navigates to the NEW copy's own detail.
        await expect(page).toHaveURL(/\/collections\/col_clone_/);
        await expect(page.getByRole('heading', { level: 1, name: 'Sunday Suppers' })).toBeVisible();

        // "Copied from …" renders ONLY for a real copy, with the source attribution FROZEN at copy time (W5 Task 2) —
        // proving this is a genuine copy, not merely a same-named collection.
        await expect(page.getByRole('button', { name: /^Copied from / })).toBeVisible();

        // A copy always starts PRIVATE (FR-010), regardless of the source's own visibility: the meta line says so, and the
        // menu offers the way back.
        await expect(page.getByText('Private', { exact: true })).toBeVisible();
        await page.getByRole('button', { name: 'More actions for Sunday Suppers' }).click();
        await expect(page.getByRole('menuitem', { name: 'Make public' })).toBeVisible();
        await page.keyboard.press('Escape');

        // The seeded member carried over as a `clone_seed` row.
        await expect(page.getByRole('link', { name: 'Family Lasagna', exact: true })).toBeVisible();
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
            id: RECIPE_IDS.risotto,
            ownerId: sourceOwnerId,
            title: 'Herb Risotto',
            visibility: 'public',
        });
        const duck = makeRecipeDetail({
            id: RECIPE_IDS.duck,
            ownerId: sourceOwnerId,
            title: 'Pan-Seared Duck',
            visibility: 'public',
        });
        const tart = makeRecipeDetail({
            id: RECIPE_IDS.tart,
            ownerId: sourceOwnerId,
            title: 'Lemon Tart',
            visibility: 'public',
        });
        const source = makeCollection({
            id: 'col_source',
            ownerId: sourceOwnerId,
            name: 'Weekend Picks',
            visibility: 'public',
            recipeIds: [RECIPE_IDS.risotto, RECIPE_IDS.duck, RECIPE_IDS.tart],
        });
        // The clone was seeded BEFORE "Lemon Tart" existed in the source — the source has since drifted
        // ahead by exactly that one recipe, which the preview/commit below must surface.
        const clone = makeCollection({
            id: 'col_clone',
            ownerId: viewerId,
            name: 'Weekend Picks',
            visibility: 'private',
            recipeIds: [RECIPE_IDS.risotto, RECIPE_IDS.duck],
            memberAddedVia: { [RECIPE_IDS.risotto]: 'clone_seed', [RECIPE_IDS.duck]: 'clone_seed' },
            sourceCollectionId: 'col_source',
            sourceOwnerHandle: 'chef_marco',
            sourceCollectionName: 'Weekend Picks',
        });
        await mockRecipeApi(page, { viewerId, recipes: [risotto, duck, tart], collections: [source, clone] });

        await page.goto(route('/collections/col_clone'));
        await expect(page.getByRole('heading', { level: 1, name: 'Weekend Picks' })).toBeVisible();

        await page.getByRole('button', { name: 'More actions for Weekend Picks' }).click();
        await page.getByRole('menuitem', { name: 'Pull updates' }).click();

        // The preview dialog opens on the diff-driven counts — before anything is applied.
        await expect(page.getByRole('heading', { name: 'Pull Updates from Source Collection' })).toBeVisible();
        await expect(page.getByText('1 new public recipes will be added')).toBeVisible();
        await expect(page.getByText('0 recipes removed from source')).toBeVisible();
        await expect(page.getByText('2 already in this collection (no changes)')).toBeVisible();
        await expect(page.getByRole('link', { name: 'Lemon Tart', exact: true })).toHaveCount(0);
        // No "Last pulled" yet — this clone has never been pulled.
        await expect(page.getByText(/Last pulled:/)).toHaveCount(0);

        await page.getByRole('button', { name: 'Pull 1 Recipes' }).click();

        // The dialog closes; the pulled member is now a real row, and "Last pulled" renders in the header —
        // the two signals that prove the pull actually APPLIED, not merely that the dialog closed.
        await expect(page.getByRole('heading', { name: 'Pull Updates from Source Collection' })).toHaveCount(0);
        await expect(page.getByRole('link', { name: 'Lemon Tart', exact: true })).toBeVisible();
        await expect(page.getByText(/Last pulled:/)).toBeVisible();

        // The pre-existing (clone_seed) members are untouched by the pull.
        await expect(page.getByRole('link', { name: 'Herb Risotto', exact: true })).toBeVisible();
        await expect(page.getByRole('link', { name: 'Pan-Seared Duck', exact: true })).toBeVisible();
    });

    /**
     * Visibility, premium-gated (FR-010, C1; `buildSpec.md` §5.2). The menu's "Make private" changes the collection AT
     * ONCE and says so in a snackbar with Undo, which changes it back; a free-tier cook gets the Premium sheet and
     * nothing is sent. The mocked viewer profile defaults to `tier: 'premium'` (`utils/recipeApi`'s `mockRecipeApi`).
     */
    test('a premium viewer makes a collection private at once, and Undo changes it back', async ({ page }) => {
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
        await expect(page.getByRole('heading', { level: 1, name: 'Weeknight dinners' })).toBeVisible();
        await expect(page.getByText('Public', { exact: true })).toBeVisible();

        await page.getByRole('button', { name: 'More actions for Weeknight dinners' }).click();
        await page.getByRole('menuitem', { name: 'Make private' }).click();

        await expect(page.getByText('Collection is now private.')).toBeVisible();
        await expect(page.getByText('Private', { exact: true })).toBeVisible();

        await page.getByRole('button', { name: 'Undo' }).click();
        await expect(page.getByText('Public', { exact: true })).toBeVisible();

        // PERSISTED — a reload reads the server's own answer, which only the compensating write can have restored.
        await page.reload();
        await expect(page.getByText('Public', { exact: true })).toBeVisible();
    });

    test('a free-tier viewer meets the Premium sheet for Make private, and nothing is sent', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            tier: 'free',
            collections: [
                makeCollection({
                    id: 'col_dinners',
                    ownerId: viewerId,
                    name: 'Weeknight dinners',
                    visibility: 'public',
                }),
            ],
        });

        await page.goto(route('/collections/col_dinners'));
        await page.getByRole('button', { name: 'More actions for Weeknight dinners' }).click();
        await page.getByRole('menuitem', { name: 'Make private' }).click();

        const sheet = page.getByRole('dialog', { name: 'Private collections are part of Premium.' });
        await expect(sheet).toBeVisible();
        await sheet.getByRole('button', { name: 'Not now' }).click();
        await expect(sheet).toHaveCount(0);

        // Still public: the sheet is the whole answer for a free-tier cook.
        await page.reload();
        await expect(page.getByText('Public', { exact: true })).toBeVisible();
    });

    /**
     * Pagination — server-paged "Load more" (W5/C7, W5 Task 13). Seeds more collections than fit on one
     * (mock-configured, small) page, so the control is guaranteed to render on the FIRST load, then asserts
     * the next page's row appears — and the control itself vanishes — once the last page has loaded.
     */
    test('asks before discarding a typed name, and refuses an empty one', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, collections: [] });

        await page.goto(route('/collections'));
        await page.getByRole('button', { name: 'New collection' }).first().click();
        const sheet = page.getByRole('dialog', { name: 'New collection' });

        // An empty name is refused in place, with the reason under the field and focus on it (SC 3.3.1).
        await sheet.getByRole('button', { name: 'Create collection' }).click();
        await expect(sheet.getByText('Give your collection a name.')).toBeVisible();
        await expect(sheet.getByRole('textbox', { name: 'Name' })).toBeFocused();

        // A typed name is not lost to a stray close.
        await sheet.getByRole('textbox', { name: 'Name' }).fill('Picnics');
        await sheet.getByRole('button', { name: 'Cancel' }).click();
        const confirm = page.getByRole('alertdialog', { name: 'Discard this collection?' });
        await expect(confirm).toBeVisible();
        await confirm.getByRole('button', { name: 'Discard' }).click();
        await expect(page.getByRole('dialog', { name: 'New collection' })).toHaveCount(0);
    });

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
        await expect(page.getByRole('link', { name: 'Weeknight dinners' })).toBeVisible();
        await expect(page.getByRole('link', { name: 'Holiday baking' })).toBeVisible();
        await expect(page.getByRole('link', { name: 'Sunday brunch' })).toHaveCount(0);

        const loadMore = page.getByRole('button', { name: 'Load more' });
        await expect(loadMore).toBeVisible();

        await loadMore.click();

        // SECOND PAGE — appended (not replacing) the first; the control disappears once the last page,
        // which reports no further pages, has loaded.
        await expect(page.getByRole('link', { name: 'Sunday brunch' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Load more' })).toHaveCount(0);
    });
});
