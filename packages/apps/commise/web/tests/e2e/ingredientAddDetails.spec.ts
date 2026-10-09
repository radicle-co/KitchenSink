import { expect, test, type Page } from '@playwright/test';
import type { FoodResponse, VariantView } from '@kitchensink/food-service-client';
import type { RecipeDetail } from '@kitchensink/recipe-core';
import { addIngredientByFoodVariantRequestSchema } from '@kitchensink/schema-recipe';

import { signInWithTicket } from './utils/auth';
import { mockFoodApi } from './utils/foodApi';
import { mockRebind } from './utils/rebindApi';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { ingredientOpen, openNewRecipe, openRecipeEditor } from './utils/recipeEditor';

/**
 * Curated U15 (`docs/design/ingredientSpecialization.md` §S7, F1, AE1), through the real web app with the recipe and
 * food contracts intercepted: a cook adds a detail to a root-bound line from the row's `⋮`, changes it, removes it, and
 * finds one by searching, and each saved line shows the root's name with the variant's dotted line under it.
 *
 * What only this tier proves: the row's `⋮` reaches the dialog in a real browser, the dialog's read reaches the FOOD
 * origin, and each pick reaches the wire through the route `docs/design/rowEditorBlueprint.md` decision 7 gives it — on
 * a saved line, ONE rebind command at the line's STORED position carrying the version the previous write answered; on
 * the create form, ONE `by-food-variant` admission and no recipe write. The per-state rules are pinned by the
 * component tests (`RecipeIngredientsFields.rowEditor.test.tsx`, `VariantDetailsDialog.test.tsx`).
 *
 * The root is a KTD-16 seed root, `boneless skinless chicken breasts`, whose eight live variants are copied from
 * `features/recipes/src/details/__fixtures__/seedVariants.ts` (a fixture this workspace cannot import). Eight is the
 * long list, so the dialog has its search; `fried` is the one variant a search for "fried" leaves. Selectors are role,
 * label and text only.
 */
const ROOT_ID = 'food_chicken_breasts';
const ROOT_NAME = 'boneless skinless chicken breasts';
const RECIPE_ID = 'ec000000-0000-4000-8000-000000000002';
const LINE_ID = '77777777-7777-4777-8777-777777777771';
const SALT_LINE_ID = '77777777-7777-4777-8777-777777777772';

const VARIANTS: readonly VariantView[] = [
    { id: 'fdc:171078', parts: [{ attribute: 'cookingMethod', text: 'fried' }], caloriesPer100g: 187 },
    { id: 'fdc:171477', parts: [{ attribute: 'cookingMethod', text: 'roasted' }], caloriesPer100g: 165 },
    { id: 'fdc:171478', parts: [{ attribute: 'cookingMethod', text: 'stewed' }], caloriesPer100g: 151 },
    { id: 'fdc:171509', parts: [{ attribute: 'pack', text: 'with added solution' }], caloriesPer100g: 108 },
    { id: 'fdc:171534', parts: [{ attribute: 'cookingMethod', text: 'grilled' }], caloriesPer100g: 151 },
    {
        id: 'fdc:171535',
        parts: [
            { attribute: 'pack', text: 'with added solution' },
            { attribute: 'cookingMethod', text: 'braised' },
        ],
        caloriesPer100g: 145,
    },
    { id: 'fdc:331960', parts: [{ attribute: 'cookingMethod', text: 'braised' }], caloriesPer100g: 166 },
    {
        id: 'fdc:171536',
        parts: [
            { attribute: 'pack', text: 'with added solution' },
            { attribute: 'cookingMethod', text: 'grilled' },
        ],
        caloriesPer100g: 148,
    },
];
const FRIED = 'fdc:171078';
const ROASTED = 'fdc:171477';

const variantOf = (id: string): VariantView => {
    const variant = VARIANTS.find((each) => each.id === id);

    if (variant === undefined) {
        throw new Error(`no variant ${id} in the copied seed rows`);
    }

    return variant;
};

const ROOT: FoodResponse = {
    id: ROOT_ID,
    name: ROOT_NAME,
    description: null,
    kind: 'generic',
    status: 'RESOLVED',
    nutrients: [],
    portions: [],
    provenance: {},
    variants: [...VARIANTS],
};

/** The editor's batch read says the root has a live variant (`hasVariants`), which offers `Add details`. */
const ROOT_HAS_VARIANTS = { [ROOT_ID]: { caloriesPer100g: 165, hasVariants: true } };

/**
 * The food origin answers the root's read. Only the root's exact path is answered, so `/api/v1/foods/sources` still
 * reaches its own handler.
 *
 * @sideEffect Registers a `page.route` handler.
 */
async function mockRootRead(page: Page): Promise<void> {
    await page.route(`**/api/v1/foods/${ROOT_ID}`, (intercepted) => intercepted.fulfill({ json: ROOT }));
}

/** What the rebind double can bind this root's line to: its variants, and the root itself (Remove details). */
const REBIND_CATALOG = {
    foodNames: { [ROOT_ID]: ROOT_NAME },
    variantParts: Object.fromEntries(VARIANTS.map((variant) => [variant.id, variant.parts])),
};

/** Records any `by-food-variant` admission, then lets the next handler answer it. @sideEffect Registers a route. */
async function recordVariantAdmissions(page: Page): Promise<readonly unknown[]> {
    const admissions: unknown[] = [];

    await page.route('**/api/v1/ingredients/by-food-variant', async (intercepted) => {
        admissions.push(intercepted.request().postDataJSON());
        await intercepted.fallback();
    });

    return admissions;
}

/** A saved recipe whose SECOND stored line is the root, so the command's position is not the default 0. */
const savedRecipe = (viewerId: string): RecipeDetail =>
    makeRecipeDetail({
        id: RECIPE_ID,
        ownerId: viewerId,
        title: 'Chicken supper',
        currentVersion: 1,
        ingredients: [
            {
                ingredientId: SALT_LINE_ID,
                name: 'Salt',
                quantity: { kind: 'exact', value: 1 },
                unit: 'tsp',
                isUserEntered: false,
                resolutionStatus: 'RESOLVED',
            },
            {
                ingredientId: LINE_ID,
                foodId: ROOT_ID,
                name: ROOT_NAME,
                quantity: { kind: 'exact', value: 1 },
                unit: 'lb',
                isUserEntered: false,
                resolutionStatus: 'RESOLVED',
            },
        ],
    });

async function openIngredientsSection(page: Page): Promise<void> {
    await openRecipeEditor(page, RECIPE_ID);
}

test.describe('Add details from the row’s ⋮ (curated U15, F1, AE1)', () => {
    test('a saved line: add by search, change, then remove — each one rebind at the stored position', async ({
        page,
    }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        const store = await mockRecipeApi(page, {
            viewerId,
            recipes: [savedRecipe(viewerId)],
            foodNutrition: ROOT_HAS_VARIANTS,
        });

        await mockRootRead(page);
        const rebinds = await mockRebind(page, store, REBIND_CATALOG);
        const variantAdmissions = await recordVariantAdmissions(page);
        await openIngredientsSection(page);
        const ingredients = page.getByRole('region', { name: 'Ingredients' });
        const row = ingredients.getByRole('listitem').nth(1);

        // Add, by search: "fried" leaves one option. The long list opens with no active row in add mode, so Down makes it
        // active and Enter commits it; the arrow alone commits nothing (§S8.5, §S9 SC 2.1.1).
        await ingredients.getByRole('button', { name: `Actions for ${ROOT_NAME}` }).click();
        await page.getByRole('menuitem', { name: 'Add details' }).click();
        const adding = page.getByRole('dialog', { name: /Add details/ });

        await expect(adding).toBeVisible();
        await adding.getByRole('combobox', { name: 'Search 8 options' }).fill('fried');
        await expect(adding.getByRole('option')).toHaveCount(1);
        await expect(adding.getByRole('option')).toHaveAccessibleName(/^fried, 187 cal/);
        await page.keyboard.press('ArrowDown');
        await expect(adding.getByRole('option')).toHaveAttribute('aria-selected', 'true');
        expect(rebinds).toEqual([]);
        await page.keyboard.press('Enter');

        await expect(adding).toBeHidden();
        await expect(row).toContainText('fried');
        await expect(ingredientOpen(ingredients, ROOT_NAME)).toBeVisible();
        // Focus is back on the row's ⋮, which now names the detail too (decision 5, item 6).
        await expect(ingredients.getByRole('button', { name: `Actions for ${ROOT_NAME}, fried` })).toBeFocused();
        expect(rebinds.map((each) => [each.path, each.body])).toEqual([
            [
                `/api/v1/recipes/${RECIPE_ID}/ingredients/1/rebind`,
                { expectedVersion: 1, target: { kind: 'catalogVariant', foodVariantId: FRIED } },
            ],
        ]);

        // Change: the second command carries the version the first one answered.
        await ingredients.getByRole('button', { name: `Actions for ${ROOT_NAME}, fried` }).click();
        await page.getByRole('menuitem', { name: 'Edit details' }).click();
        const editing = page.getByRole('dialog', { name: /Edit details/ });

        await editing.getByRole('option', { name: /^roasted, 165 cal/ }).click();

        await expect(editing).toBeHidden();
        await expect(row).toContainText('roasted');
        await expect(row).not.toContainText('fried');
        expect(rebinds.at(-1)?.body).toEqual({
            expectedVersion: 2,
            target: { kind: 'catalogVariant', foodVariantId: ROASTED },
        });

        // Remove details: back to the root, by the same command.
        await ingredients.getByRole('button', { name: `Actions for ${ROOT_NAME}, roasted` }).click();
        await page.getByRole('menuitem', { name: 'Edit details' }).click();
        await page
            .getByRole('dialog', { name: /Edit details/ })
            .getByRole('button', { name: 'Remove details' })
            .click();

        await expect(page.getByRole('dialog', { name: /Edit details/ })).toBeHidden();
        await expect(row).not.toContainText('roasted');
        await expect(ingredients.getByRole('button', { name: `Actions for ${ROOT_NAME}`, exact: true })).toBeVisible();
        expect(rebinds.at(-1)?.body).toEqual({
            expectedVersion: 3,
            target: { kind: 'catalogFood', foodId: ROOT_ID },
        });

        // Three writes in all, each a rebind; nothing went through the draft's admission route.
        expect(rebinds).toHaveLength(3);
        expect(variantAdmissions).toEqual([]);
        expect(store.get(RECIPE_ID)?.currentVersion).toBe(4);
        expect(store.get(RECIPE_ID)?.ingredients[1]?.variant).toBeUndefined();
        // The other line was never touched.
        expect(store.get(RECIPE_ID)?.ingredients[0]?.ingredientId).toBe(SALT_LINE_ID);
    });

    test('closing the dialog writes nothing, and focus returns to the row’s ⋮', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        const store = await mockRecipeApi(page, {
            viewerId,
            recipes: [savedRecipe(viewerId)],
            foodNutrition: ROOT_HAS_VARIANTS,
        });

        await mockRootRead(page);
        const rebinds = await mockRebind(page, store, REBIND_CATALOG);
        const variantAdmissions = await recordVariantAdmissions(page);
        await openIngredientsSection(page);
        const ingredients = page.getByRole('region', { name: 'Ingredients' });
        const trigger = ingredients.getByRole('button', { name: `Actions for ${ROOT_NAME}`, exact: true });

        await trigger.click();
        await page.getByRole('menuitem', { name: 'Add details' }).click();
        await expect(page.getByRole('dialog', { name: /Add details/ })).toBeVisible();
        await page.keyboard.press('Escape');

        await expect(page.getByRole('dialog', { name: /Add details/ })).toBeHidden();
        await expect(trigger).toBeFocused();
        expect(rebinds).toEqual([]);
        expect(variantAdmissions).toEqual([]);
        expect(store.get(RECIPE_ID)?.currentVersion).toBe(1);
    });
});

test.describe('Add details on a new recipe (curated U15, decision 7: the draft route)', () => {
    test('a pick is ONE by-food-variant admission, the row shows the detail, and no recipe is written', async ({
        page,
    }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        const variantAdmissions: unknown[] = [];
        let recipeWrites = 0;

        await mockRecipeApi(page, { viewerId, tier: 'premium', foodNutrition: ROOT_HAS_VARIANTS });
        await mockRootRead(page);
        // The catalog's hit is the root, and its admission binds the root (the double's own `by-food` admits only its
        // fixed foods).
        await mockFoodApi(page, { catalog: () => [{ id: ROOT_ID, name: ROOT_NAME, score: 0.9 }] });
        await page.route('**/api/v1/ingredients/by-food', (intercepted) =>
            intercepted.fulfill({
                json: {
                    id: LINE_ID,
                    name: ROOT_NAME,
                    foodId: ROOT_ID,
                    foodResolutionStatus: 'RESOLVED',
                    isUserEntered: false,
                    createdAt: '2026-10-02T09:00:00.000Z',
                },
            }),
        );
        await page.route('**/api/v1/ingredients/by-food-variant', async (intercepted) => {
            const body = addIngredientByFoodVariantRequestSchema.parse(intercepted.request().postDataJSON());

            variantAdmissions.push(body);
            await intercepted.fulfill({
                json: {
                    id: '88888888-8888-4888-8888-000000000101',
                    name: ROOT_NAME,
                    foodId: ROOT_ID,
                    variant: { id: body.foodVariantId, parts: variantOf(body.foodVariantId).parts },
                    foodResolutionStatus: 'RESOLVED',
                    isUserEntered: false,
                    createdAt: '2026-10-02T09:00:00.000Z',
                },
            });
        });
        await page.route('**/api/v1/recipes**', async (intercepted) => {
            if (intercepted.request().method() !== 'GET') {
                recipeWrites += 1;
            }

            await intercepted.fallback();
        });

        await openNewRecipe(page);
        await page.getByLabel('Title').fill('E2E Chicken Details');
        await page.getByRole('radio', { name: 'Easy' }).click();
        await page.getByRole('combobox', { name: 'Add an ingredient' }).fill('chicken');
        await page.getByRole('group', { name: 'Food catalog' }).getByRole('option', { name: ROOT_NAME }).click();
        await expect(ingredientOpen(page, ROOT_NAME)).toBeVisible();

        const ingredients = page.getByRole('region', { name: 'Ingredients' });
        // Whatever the editor saved on its own before this point (a checkpoint's create, slice 7) is not the pick's doing.
        const writesBeforePick = recipeWrites;

        await ingredients.getByRole('button', { name: `Actions for ${ROOT_NAME}` }).click();
        await page.getByRole('menuitem', { name: 'Add details' }).click();
        const adding = page.getByRole('dialog', { name: /Add details/ });

        await adding.getByRole('option', { name: /^fried, 187 cal/ }).click();

        await expect(adding).toBeHidden();
        await expect(ingredients.getByRole('listitem').first()).toContainText('fried');
        expect(variantAdmissions).toEqual([{ foodVariantId: FRIED }]);
        expect(recipeWrites).toBe(writesBeforePick);
    });
});
