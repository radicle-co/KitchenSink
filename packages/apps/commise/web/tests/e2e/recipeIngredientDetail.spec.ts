import { expect, test } from '@playwright/test';

import { route } from './utils/basePath';
import { mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * A line's PREPARATION and its SECTION, end to end (plan U26 / U27).
 *
 * This is the INTEGRATION tier for the two fields: the component suites prove each leaf renders each state,
 * and only a run through the real editor + router + client hooks proves the values survive being typed,
 * submitted, re-read and re-seeded. Three round trips are exercised, because they fail differently:
 *
 *  1. A PREPARATION. The failure it guards is the field that saves and vanishes — a cook types
 *     "finely chopped", the recipe page never mentions it, and every assertion about "the recipe was saved"
 *     still passes.
 *  2. A SECTION. The failure it guards is silent NARROWING across the wire, the same class U9's range work
 *     was written against: a mapper that drops the label lets a grouped recipe re-open flat, with nothing
 *     to signal the loss.
 *  3. An UNGROUPED recipe. The failure it guards is the OPPOSITE — section chrome appearing where nobody
 *     asked for it, which makes every ordinary recipe look unfinished. Most recipes will never group, and
 *     the brief is explicit that those must not look half-filled.
 *
 * The recipe-service HTTP contract is intercepted (`utils/recipeApi`), which round-trips the body through
 * the same zod schema the service publishes — so a body this editor could not really have produced fails
 * loudly in the double rather than passing quietly. Selectors are role/label only (repo policy). Serial
 * (Clerk-authed).
 */
test.describe('ingredient preparation + section (U26/U27)', () => {
    test('states a preparation and a section, renders them, and re-opens the editor with both', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, tier: 'premium' });

        await page.goto(route('/recipes'));
        await page.getByRole('button', { name: 'New recipe' }).click();
        // U34: the FAB is a menu TRIGGER now — its ONE destination is what opens the wizard.
        await page.getByRole('menuitem', { name: 'Create from Scratch' }).click();
        await expect(page).toHaveURL(/\/recipes\/new/);

        // Step 1 (Details).
        await expect(page.getByText('Step 1 of 4')).toBeVisible();
        await page.getByLabel('Title').fill('E2E Marinade Bowl');
        await page.getByLabel('Servings').fill('4');
        await page.getByRole('button', { name: 'Next: Ingredients' }).click();

        // Step 2 (Ingredients) — resolve a catalog line, then state its preparation and its section.
        await expect(page.getByText('Step 2 of 4')).toBeVisible();
        await page.getByRole('searchbox', { name: 'Search ingredients' }).fill('salt');
        await page.getByRole('button', { name: 'Salt', exact: true }).click();

        await page.getByLabel('Ingredient 1 quantity').fill('2');
        await page.getByLabel('Ingredient 1 unit').fill('cups');
        await page.getByLabel('Ingredient 1 preparation').fill('finely chopped');
        await page.getByLabel('Ingredient 1 section').fill('For the marinade');

        // ⛔ THE SECTION HEADING APPEARS, in the editor, as soon as a line carries a label — the fold is
        // derived from the draft, not from a save.
        await expect(page.getByRole('heading', { name: 'For the marinade' })).toBeVisible();

        await page.getByRole('button', { name: 'Next: Instructions' }).click();
        await page.getByRole('button', { name: 'Add step' }).click();
        await page.getByLabel('Step 1 instruction').fill('Marinate and grill.');
        await page.getByRole('button', { name: 'Next: Review' }).click();
        await page.getByRole('button', { name: 'Publish' }).click();

        // VIEW — the preparation is on the surface a cook actually cooks from, as its own text and NOT
        // welded into the food's name.
        await expect(page.getByRole('heading', { name: 'E2E Marinade Bowl' })).toBeVisible();
        const ingredients = page.getByRole('region', { name: 'Ingredients' });
        await expect(ingredients.getByText('finely chopped')).toBeVisible();
        await expect(ingredients.getByText('Salt finely chopped')).toHaveCount(0);

        // RE-OPEN — both values are re-seeded. Dropping either here is the narrowing defect.
        await page.getByRole('link', { name: 'Edit recipe' }).click();
        await expect(page.getByText('Step 1 of 4')).toBeVisible();
        await page.getByRole('button', { name: 'Next: Ingredients' }).click();
        await expect(page.getByText('Step 2 of 4')).toBeVisible();

        await expect(page.getByLabel('Ingredient 1 preparation')).toHaveValue('finely chopped');
        await expect(page.getByLabel('Ingredient 1 section')).toHaveValue('For the marinade');
        await expect(page.getByRole('heading', { name: 'For the marinade' })).toBeVisible();
    });

    test('⛔ an UNGROUPED recipe stays a flat list, with no section chrome anywhere', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, tier: 'premium' });

        await page.goto(route('/recipes'));
        await page.getByRole('button', { name: 'New recipe' }).click();
        // U34: the FAB is a menu TRIGGER now — its ONE destination is what opens the wizard.
        await page.getByRole('menuitem', { name: 'Create from Scratch' }).click();

        await page.getByLabel('Title').fill('E2E Flat Loaf');
        await page.getByLabel('Servings').fill('2');
        await page.getByRole('button', { name: 'Next: Ingredients' }).click();

        await page.getByRole('searchbox', { name: 'Search ingredients' }).fill('salt');
        await page.getByRole('button', { name: 'Salt', exact: true }).click();
        await page.getByLabel('Ingredient 1 quantity').fill('1');

        // ⛔ The whole ingredients step carries NO section heading. `level: 3` is the section-heading level;
        // the step's own "Ingredients" heading is a level 2 and is unaffected.
        const step = page.getByRole('region', { name: 'Ingredients' });
        await expect(step.getByRole('heading', { level: 3 })).toHaveCount(0);

        await page.getByRole('button', { name: 'Next: Instructions' }).click();
        await page.getByRole('button', { name: 'Add step' }).click();
        await page.getByLabel('Step 1 instruction').fill('Bake.');
        await page.getByRole('button', { name: 'Next: Review' }).click();
        await page.getByRole('button', { name: 'Publish' }).click();

        await expect(page.getByRole('heading', { name: 'E2E Flat Loaf' })).toBeVisible();
        // `level: 3` again — the detail's Ingredients region carries its OWN `h2` ("Ingredients"), so an
        // unscoped heading query finds that one and would fail for a reason that has nothing to do with
        // sections. Level 3 is the section-heading level on both the editor and the detail.
        await expect(page.getByRole('region', { name: 'Ingredients' }).getByRole('heading', { level: 3 })).toHaveCount(
            0,
        );
    });
});
