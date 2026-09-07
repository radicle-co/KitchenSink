import { expect, test } from '@playwright/test';

import { route } from './utils/basePath';
import { mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * Recipe CRUD happy path (T079; rewritten w3/e7 for the 4-step edit/create wizard): create → view → edit →
 * delete, driven through the real web UI (Next dev server + Clerk session + client hooks + routing) with the
 * recipe-service HTTP contract intercepted (`utils/recipeApi`). The real backend is covered separately by the
 * recipe-service's own e2e + k6. Owner actions (edit/delete) gate on the Clerk `external_id` claim, so the
 * mock seeds recipes owned by the live viewer (see `readViewerAppId`). Selectors are role/label only (per
 * repo policy). Serial (Clerk-authed).
 *
 * The wizard walk (both create and edit): Details (`Title`/`Description`/`Cuisine`/`Servings`/`Prep time
 * (minutes)`/`Cook time (minutes)`/`Difficulty`) → `Next: Ingredients` → Ingredients (`Search ingredients` +
 * pick a result) → `Next: Instructions` → Instructions (`Add step` + `Step 1 instruction`) → `Next: Review` →
 * Review → `Publish` (w3/e7: the wizard's final CTA is named for what it DOES — sets `status: 'published'` —
 * in both create and edit mode, replacing the old mode-named `Create recipe`/`Save changes` labels). U6 chrome:
 * `Publish` is the footer's FINAL-step primary only (no longer live on steps 1–3), so both the create and the
 * edit path advance to Review (step 4) before publishing — the edit path via a rail jump (its seed is valid).
 */
test.describe('recipe CRUD (T079)', () => {
    test('create → view → edit → delete a recipe', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, tier: 'premium' });

        // The list surface renders with its chrome.
        await page.goto(route('/recipes'));
        await expect(page.getByRole('heading', { name: 'Recipes' })).toBeVisible();

        // CREATE — this spec runs against the mock's DEFAULT seed, so the library is POPULATED, and L1 says
        // exactly one create control exists per state: the pinned FAB ("New recipe"). The empty-state CTA
        // belongs to the first-run library and must NOT be here.
        //
        // Asserted state-specifically on purpose. This used to be a permissive
        // `/New recipe|Create your first recipe/` alternation, which passes in EITHER state and so could not
        // report which one the page was in — that tolerance is part of why a first-run library rendering a
        // permanent skeleton reached a human. The first-run state has its own spec now
        // (`recipeListEmptyStates.spec.ts`); this one pins the populated state it actually exercises.
        await expect(page.getByRole('button', { name: 'Seed Recipe' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Create your first recipe' })).toHaveCount(0);
        await page.getByRole('button', { name: 'New recipe' }).click();
        // U34: the FAB is a menu TRIGGER now — its ONE destination is what opens the wizard.
        await page.getByRole('menuitem', { name: 'Create from Scratch' }).click();
        await expect(page).toHaveURL(/\/recipes\/new/);

        // Step 1 (Basic) — the wizard opens here (Step 1 of 4).
        await expect(page.getByText('Step 1 of 4')).toBeVisible();
        await page.getByLabel('Title').fill('E2E Ratatouille');
        await page.getByLabel('Description').fill('A rustic roasted vegetable stew.');
        await page.getByLabel('Cuisine').selectOption('French');
        await page.getByLabel('Servings').fill('4');
        await page.getByLabel('Prep time (minutes)').fill('15');
        await page.getByLabel('Cook time (minutes)').fill('30');
        // State a difficulty (FR-001b) — the picker is a radiogroup; select Hard.
        await page.getByRole('radio', { name: 'Hard' }).click();

        await page.getByRole('button', { name: 'Next: Ingredients' }).click();

        // Step 2 (Ingredients).
        await expect(page.getByText('Step 2 of 4')).toBeVisible();
        await page.getByRole('searchbox', { name: 'Search ingredients' }).fill('salt');
        // Wait for the search RESULT button (exact 'Salt'), not the freeform "Add 'salt' as a custom
        // ingredient" fallback (which a substring match on 'Salt' would also hit); clicking it resolves the
        // ingredient line synchronously.
        await page.getByRole('button', { name: 'Salt', exact: true }).click();

        await page.getByRole('button', { name: 'Next: Instructions' }).click();

        // Step 3 (Instructions).
        await expect(page.getByText('Step 3 of 4')).toBeVisible();
        await page.getByRole('button', { name: 'Add step' }).click();
        await page.getByLabel('Step 1 instruction').fill('Roast the vegetables.');

        await page.getByRole('button', { name: 'Next: Review' }).click();

        // Step 4 (Review) — U33 replaced the old Photos step with Review and moved photos onto step 1, and
        // U32 made Publish the action bar's FINAL-step primary rather than a top-bar action live everywhere.
        await expect(page.getByText('Step 4 of 4')).toBeVisible();
        await page.getByRole('button', { name: 'Publish' }).click();

        // VIEW — landed on the new recipe's detail.
        await expect(page.getByRole('heading', { name: 'E2E Ratatouille' })).toBeVisible();
        const createdId = new URL(page.url()).pathname.split('/recipes/')[1]?.split('/')[0];
        expect(createdId).toBeTruthy();

        // C1 wireframe parity — an in-app Back control returns to the recipe list without relying on the
        // browser's own back button.
        await expect(page.getByRole('link', { name: 'Back' })).toHaveAttribute('href', /\/recipes$/);

        // W2/D1 — the detail is no longer a dead end: the owner's version-history entry point is reachable,
        // behind the "More" overflow menu (C4 — Edit stays the sole primary header control).
        await page.getByRole('button', { name: 'More', exact: true }).click();
        await expect(page.getByRole('link', { name: 'Version history' })).toBeVisible();
        // W2/D5 — ingredient checkboxes are real, trackable controls (not decorative).
        const saltCheckbox = page.getByRole('checkbox', { name: /Salt/ });
        await saltCheckbox.click();
        await expect(saltCheckbox).toBeChecked();

        // REQ-034 — the disclosure notice is GATED to recipes with a user-entered ingredient. This recipe's
        // only ingredient ("Salt") is food-database-resolved, so the notice must NOT render (see
        // `ingredientTypeahead.spec.ts` for the positive case with a freeform ingredient).
        await expect(
            page.getByText('Nutrition includes USDA database items; user-entered ingredients are marked Custom.'),
        ).toHaveCount(0);

        // EDIT — reach the editor through the RESTORED Edit entry point (W2/D1), not a raw URL. The wizard
        // seeds at step 1 (already valid); the difficulty stated at create round-tripped, so Hard is
        // pre-selected. Change the title and CLEAR the difficulty ("Not stated") on step 1, then advance to
        // Photos (step 4) and Publish — the footer's final-step primary (U6). The three-state update sends an
        // explicit clear, not an omit.
        await page.getByRole('link', { name: 'Edit recipe' }).click();
        await expect(page).toHaveURL(new RegExp(`/recipes/${createdId}/edit`));
        await expect(page.getByText('Step 1 of 4')).toBeVisible();
        await expect(page.getByRole('radio', { name: 'Hard' })).toBeChecked();
        await page.getByLabel('Title').fill('E2E Ratatouille (edited)');
        await page.getByRole('radio', { name: 'Not stated' }).click();
        // The edited recipe is fully valid, so the rail can jump straight to the final step; forward navigation
        // is ungated even with the unsaved title/difficulty edits (only backward navigation is guarded).
        await page.getByRole('button', { name: /Review:/ }).click();
        await expect(page.getByText('Step 4 of 4')).toBeVisible();
        await page.getByRole('button', { name: 'Publish' }).click();
        await expect(page.getByRole('heading', { name: 'E2E Ratatouille (edited)' })).toBeVisible();

        // The clear persisted: re-opening the editor shows Not stated selected, never the stale Hard.
        await page.goto(route(`/recipes/${createdId}/edit`));
        await expect(page.getByRole('radio', { name: 'Not stated' })).toBeChecked();
        await expect(page.getByRole('radio', { name: 'Hard' })).not.toBeChecked();

        // DELETE — the delete affordance lives on the recipe's detail page, not the editor, so return to it
        // first; it is behind the "More" overflow menu (C4). Confirm the destructive dialog, then land back
        // on the list without the recipe.
        await page.goto(route(`/recipes/${createdId}`));
        await page.getByRole('button', { name: 'More', exact: true }).click();
        await page.getByRole('button', { name: 'Delete recipe' }).click();
        await page.getByRole('button', { name: 'Delete', exact: true }).click();
        await expect(page).toHaveURL(/\/recipes(?:\?|$)/);
        await expect(page.getByRole('heading', { name: 'E2E Ratatouille (edited)' })).toHaveCount(0);
    });
});
