import { expect, test, type Page } from '@playwright/test';
import type { RecipeIngredientView } from '@kitchensink/recipe-core';

import { route } from './utils/basePath';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';
import { mockFoodApi } from './utils/foodApi';
import { addStep, openIngredientEditor, setServings } from './utils/recipeEditor';

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
        await mockFoodApi(page);

        await page.goto(route('/recipes'));
        await page.getByRole('button', { name: 'New recipe' }).click();
        await expect(page).toHaveURL(/\/recipes\/new/);

        // Details.
        await page.getByLabel('Title').fill('E2E Marinade Bowl');
        await setServings(page, 4);

        // Ingredients — REWRITTEN for the overhaul (build spec §7.5.3, §7.5.5): name a group first, then type the
        // amount, the food and, after a comma, the preparation into that group's add field, and pick the food.
        await page.getByRole('button', { name: 'Add a group' }).click();
        await page.getByRole('textbox', { name: 'Group name' }).fill('For the marinade');
        await page.getByRole('button', { name: 'Save' }).click();
        await expect(page.getByRole('heading', { name: 'For the marinade' })).toBeVisible();

        await page.getByRole('combobox', { name: 'Add to For the marinade' }).fill('2 cups salt, finely chopped');
        await page
            .getByRole('group', { name: 'Food catalog' })
            .getByRole('option', { name: 'Salt', exact: true })
            .click();

        // ⛔ The line lands in the group, read amount first with its preparation after the name. REWRITTEN for owner
        // ruling D21 (`ownerDecisions.md`): the row shows the cook's OWN amount and unit ("2 cups"), then the catalog
        // food name, then the preparation. It used to show the reader's canonical unit ("2 cup"); that spelling is no
        // longer shown, so the row's name and text carry the unit as typed.
        await expect(
            page.getByRole('list', { name: 'For the marinade' }).getByRole('button', { name: 'Edit 2 cups Salt' }),
        ).toHaveText('2 cupsSalt · finely chopped');

        await addStep(page, 'Marinate and grill.');
        await page.getByRole('button', { name: 'Publish' }).click();

        // VIEW — the preparation is on the surface a cook actually cooks from, as its own text and NOT
        // welded into the food's name.
        await expect(page.getByRole('heading', { name: 'E2E Marinade Bowl' })).toBeVisible();
        // The name and the preparation sit in one flowing line of text (namelessLineCopy.md §2c), each its OWN
        // element, so the preparation is never concatenated into the food's name (U26). REWRITTEN for slice 6: the
        // whole row is now the checkbox, named with the full line (build spec §6.3) — the food, then the
        // preparation as its own clause after a comma.
        const ingredients = page.getByRole('region', { name: 'Ingredients' });
        await expect(ingredients.getByText('finely chopped', { exact: true })).toBeVisible();
        await expect(ingredients.getByText('Salt', { exact: true })).toBeVisible();
        await expect(ingredients.getByRole('checkbox', { name: /Salt, finely chopped$/u })).toBeVisible();

        // RE-OPEN — both values are re-seeded. Dropping either here is the narrowing defect.
        await page.getByRole('link', { name: 'Edit recipe' }).click();

        await expect(page.getByRole('heading', { name: 'For the marinade' })).toBeVisible();
        const fields = await openIngredientEditor(page, 'Salt');

        await expect(fields.getByLabel('Preparation')).toHaveValue('finely chopped');
    });

    test('⛔ an UNGROUPED recipe stays a flat list, with no section chrome anywhere', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, tier: 'premium' });
        await mockFoodApi(page);

        await page.goto(route('/recipes'));
        await page.getByRole('button', { name: 'New recipe' }).click();

        await page.getByLabel('Title').fill('E2E Flat Loaf');
        await setServings(page, 2);

        await page.getByRole('combobox', { name: 'Add an ingredient' }).fill('salt');
        await page
            .getByRole('group', { name: 'Food catalog' })
            .getByRole('option', { name: 'Salt', exact: true })
            .click();

        // ⛔ The whole Ingredients section carries NO ingredient-section heading. `level: 3` is that heading's level;
        // the editor section's own "Ingredients" heading is a level 2 and is unaffected.
        const section = page.getByRole('region', { name: 'Ingredients' });
        await expect(section.getByRole('heading', { level: 3 })).toHaveCount(0);

        await addStep(page, 'Bake.');
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

/**
 * Curated U15 — the read view's variant line, end to end through the real detail route
 * (`docs/design/ingredientSpecialization.md` §S1, §S5, §S15; origin F3, R25, R27 to R29, D16). The lines use the
 * curated seed's two device-test roots (KTD-16): AE1's brisket variant, and the chicken variant whose one part is
 * `fried`.
 *
 * Each line is found by its checkbox's accessible name, which on a variant-bound line carries every part
 * comma-joined (R27). The screen shows the parts with a middle dot and never as a comma-joined label: the row text is
 * asserted against that label, and a line whose notes carry the same phrase in the cook's own words is the control
 * that shows the assertion can fail.
 */
const VARIANT_RECIPE_ID = 'db000000-0000-4000-8000-0000000000a1';
const AE1_PARTS = ['flat half', 'separable lean and fat', '1/8-inch trim', 'select', 'braised'] as const;
const AE1_SPOKEN = AE1_PARTS.join(', ');
const AE1_VARIANT_PARTS = [
    { attribute: 'cut', text: 'flat half' },
    { attribute: 'fat', text: 'separable lean and fat' },
    { attribute: 'trim', text: '1/8-inch trim' },
    { attribute: 'grade', text: 'select' },
    { attribute: 'cookingMethod', text: 'braised' },
];

const rootBrisket: RecipeIngredientView = {
    ingredientId: 'db000000-0000-4000-8000-0000000000b1',
    name: 'beef brisket',
    foodId: 'food_beef_brisket',
    hasVariants: true,
    quantity: { kind: 'exact', value: 1 },
    unit: 'lb',
    isUserEntered: false,
};

const flatHalfBrisket: RecipeIngredientView = {
    ingredientId: 'db000000-0000-4000-8000-0000000000b2',
    name: 'beef brisket',
    foodId: 'food_beef_brisket',
    variant: { id: 'fdc:169432', parts: AE1_VARIANT_PARTS },
    quantity: { kind: 'exact', value: 2 },
    unit: 'lb',
    isUserEntered: false,
};

const friedChicken: RecipeIngredientView = {
    ingredientId: 'db000000-0000-4000-8000-0000000000b3',
    name: 'boneless skinless chicken breasts',
    foodId: 'food_boneless_skinless_chicken_breasts',
    variant: { id: 'fdc:171078', parts: [{ attribute: 'cookingMethod', text: 'fried' }] },
    quantity: { kind: 'exact', value: 4 },
    isUserEntered: false,
};

/** The list item whose checkbox has the accessible name `name`. */
const lineItem = (page: Page, name: string) =>
    page
        .getByRole('region', { name: 'Ingredients' })
        .getByRole('listitem')
        .filter({ has: page.getByRole('checkbox', { name, exact: true }) });

/** Seed one recipe with `ingredients` and open its detail. */
async function openRecipeWith(page: Page, ingredients: readonly RecipeIngredientView[]): Promise<void> {
    await signInWithTicket(page);
    const viewerId = await readViewerAppId(page);
    await mockRecipeApi(page, {
        viewerId,
        tier: 'premium',
        recipes: [
            makeRecipeDetail({
                id: VARIANT_RECIPE_ID,
                ownerId: viewerId,
                title: 'Brisket and Chicken',
                ingredients: [...ingredients],
            }),
        ],
    });
    await page.goto(route(`/recipes/${VARIANT_RECIPE_ID}`));
    await expect(page.getByRole('heading', { name: 'Brisket and Chicken' })).toBeVisible();
}

test.describe('variant details on the read view (curated U15)', () => {
    test('a variant-bound line shows its root name and every part; a root-bound line shows the name only (F3)', async ({
        page,
    }) => {
        await openRecipeWith(page, [rootBrisket, flatHalfBrisket, friedChicken]);

        const root = lineItem(page, '1 lb beef brisket');
        const flatHalf = lineItem(page, `2 lb beef brisket, ${AE1_SPOKEN}`);
        const chicken = lineItem(page, '4 boneless skinless chicken breasts, fried');

        await expect(root).toContainText('beef brisket');
        await expect(root).not.toContainText('·');

        for (const part of AE1_PARTS) {
            await expect(flatHalf).toContainText(part);
        }

        await expect(flatHalf).toContainText('flat half ·');
        await expect(chicken).toContainText('fried');
        await expect(chicken).not.toContainText('·');
    });

    test('no line shows a comma-joined variant label; the cook’s own comma-joined words do show', async ({ page }) => {
        await openRecipeWith(page, [flatHalfBrisket, { ...rootBrisket, notes: 'flat half, separable lean and fat' }]);

        await expect(lineItem(page, '1 lb beef brisket')).toContainText('flat half, separable lean and fat');
        await expect(lineItem(page, `2 lb beef brisket, ${AE1_SPOKEN}`)).not.toContainText(
            'flat half, separable lean and fat',
        );
    });

    test('a line bound to a retired variant keeps its name, parts and numbers (R29)', async ({ page }) => {
        // The read view draws the line from its own binding. That a retired variant keeps its binding and numbers is
        // the service's (curated U9); the figure here is the seeded recipe's.
        await openRecipeWith(page, [{ ...flatHalfBrisket, variant: { id: 'fdc:retired', parts: AE1_VARIANT_PARTS } }]);

        const line = lineItem(page, `2 lb beef brisket, ${AE1_SPOKEN}`);
        await expect(line).toContainText('beef brisket');
        await expect(line).toContainText('1/8-inch trim');
        await expect(page.getByRole('region', { name: 'Nutrition (per serving)' })).toContainText('420');
    });

    test('the nutrition note names no single source and links to Data sources (§S15, D16)', async ({ page }) => {
        await openRecipeWith(page, [
            flatHalfBrisket,
            {
                ingredientId: 'db000000-0000-4000-8000-0000000000b4',
                name: 'Grandma’s spice mix',
                quantity: { kind: 'exact', value: 1 },
                unit: 'tbsp',
                isUserEntered: true,
            },
        ]);

        const nutrition = page.getByRole('region', { name: 'Nutrition (per serving)' });
        await expect(nutrition).toContainText('Nutrition comes from public food databases.');
        await expect(nutrition).toContainText('Custom ingredients count only the nutrition you entered for them.');
        await expect(page.getByRole('article', { name: 'Brisket and Chicken' })).not.toContainText('USDA');

        await page.route('**/api/v1/foods/sources', (request) => request.fulfill({ json: { sources: [] } }));
        await nutrition.getByRole('link', { name: 'Data sources' }).click();

        await expect(page).toHaveURL(/\/legal\/sources$/u);
        await expect(page.getByRole('heading', { level: 1, name: 'Data sources' })).toBeVisible();
    });
});
