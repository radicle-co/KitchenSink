import { expect, test, type Page } from '@playwright/test';
import type { RecipeDetail } from '@kitchensink/recipe-core';

import { signInWithTicket } from './utils/auth';
import { mockFoodApi } from './utils/foodApi';
import { mockRebind } from './utils/rebindApi';
import { E2E_CATALOG_FOOD, makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { ingredientOpen, ingredientRow, openIngredientEditor, openRecipeEditor } from './utils/recipeEditor';

/**
 * The ingredient row editor's stories on a saved recipe (plan 002 V1 B7), through the real web app with the recipe
 * contract and food's progressive search (ADR-0055 point 9) intercepted:
 *
 * - US7, Change food: the cook reopens a matched line's food and picks another, keeping the amount, unit, preparation
 *   and section. Before B7 the rebind command existed and no editor control called it (plan 002 status, R17/US3).
 * - Row 1's Find a food: a line in the cook's own wording gets a food from its own field.
 * - `docs/design/rowEditorOpenDecisions.md` R7: text a Change food row holds refuses Publish; the refusal lands in that
 *   field, which says why, and choosing "Use … as written" lets the publish go ahead. REWRITTEN for slice 7: Save Draft
 *   is gone (the editor saves at checkpoints), so the refused write is Publish, pressed from the Steps section.
 * - Row 6 (`docs/design/ingredientStatusExplanation.md` SPECIFY.1; `docs/design/rowEditorOpenDecisions.md` S7 list
 *   contract P12): an `UNRESOLVED` line's glyph opens a list searched from the line's own words, as row 7's is. A pick
 *   of a remote food adopts it and rebinds THAT line (ADR-0055 point 10), and None of these returns the line to its
 *   field and writes nothing.
 *
 * What only this tier proves: each pick reaches the wire through the route `docs/design/rowEditorBlueprint.md`
 * decision 7 gives it — ONE rebind command at the line's STORED position for a food pick, the draft for a declaration —
 * and the refusal moves a real browser's focus. The per-state rules are pinned by the component tests
 * (`RecipeIngredientsFields.rowEditor.test.tsx`). Selectors are role, label and text only.
 *
 * REWRITTEN for the UI overhaul's read rows (build spec §7.5.1, §7.5.2): a row's amount, unit and preparation are read
 * in its row editor, focus after a pick lands on the row's open control ("Edit {amount} {food}"), and row 6's panel
 * opens from its attention line ("Choose a match: {food}").
 */
const RECIPE_ID = 'ec000000-0000-4000-8000-000000000027';
const SALT_ID = '99999999-9999-4999-8999-999999999991';
const GARLIC_ID = '99999999-9999-4999-8999-999999999992';
const MIX_ID = '99999999-9999-4999-8999-999999999993';
const KALE_ID = '99999999-9999-4999-8999-999999999994';
/** The one catalog food the doubles find and admit (`utils/foodApi.ts`, `utils/recipeApi.ts`). */
const PEPPER = E2E_CATALOG_FOOD;

const saltLine = {
    ingredientId: SALT_ID,
    foodId: 'food_salt',
    name: 'Salt',
    quantity: { kind: 'exact', value: 1 },
    unit: 'tsp',
    isUserEntered: false,
    resolutionStatus: 'RESOLVED',
} as const;

/** A saved recipe whose SECOND stored line is the one each story works on, so the position is not the default 0. */
const savedRecipe = (viewerId: string, second: RecipeDetail['ingredients'][number]): RecipeDetail =>
    makeRecipeDetail({
        id: RECIPE_ID,
        ownerId: viewerId,
        title: 'Garlic supper',
        status: 'draft',
        currentVersion: 1,
        ingredients: [saltLine, second],
    });

const garlicLine = {
    ingredientId: GARLIC_ID,
    foodId: 'food_garlic',
    name: 'Garlic',
    quantity: { kind: 'exact', value: 2 },
    unit: 'clove',
    preparation: 'minced',
    groupLabel: 'For the sauce',
    isUserEntered: false,
    resolutionStatus: 'RESOLVED',
} as const;

const kaleLine = {
    ingredientId: KALE_ID,
    name: 'Kale',
    quantity: { kind: 'exact', value: 1 },
    unit: 'bunch',
    isUserEntered: false,
    resolutionStatus: 'UNRESOLVED',
} as const;
/** Kale as USDA streams it: no catalog food matches the line, so the list's only food is this remote one. */
const KALE_RAW = { name: 'Kale, raw', reference: 'sealed.kale.raw', rootId: 'food_kale' } as const;

async function openIngredientsSection(page: Page): Promise<void> {
    await openRecipeEditor(page, RECIPE_ID);
}

test.describe('the ingredient row editor on a saved recipe (plan 002 V1 B7)', () => {
    test('US7 Change food: one rebind at the stored position, and the amount, unit, preparation and section stay', async ({
        page,
    }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        const store = await mockRecipeApi(page, { viewerId, recipes: [savedRecipe(viewerId, garlicLine)] });
        await mockFoodApi(page);
        const rebinds = await mockRebind(page, store, { foodNames: { [PEPPER.foodId]: PEPPER.name } });

        await openIngredientsSection(page);
        const ingredients = page.getByRole('region', { name: 'Ingredients' });

        await ingredients.getByRole('button', { name: 'Actions for Garlic' }).click();
        await page.getByRole('menuitem', { name: 'Change food' }).click();
        const field = ingredients.getByRole('combobox', { name: 'Ingredient 2 name' });

        // §2d: Change food puts the cook in the field, on the food's current name.
        await expect(field).toBeFocused();
        await field.fill('pepper');
        await page.getByRole('option', { name: PEPPER.name }).click();

        // §2d: a committed pick hands focus to the row's open control, and says so politely.
        await expect(ingredientOpen(ingredients, PEPPER.name)).toBeFocused();
        await expect(page.getByText(`${PEPPER.name} is matched. Its nutrition now counts.`)).toBeVisible();
        // The pick moved the binding, not the cook's words: the row stays in its group, and its editor holds them.
        await expect(ingredientRow(page.getByRole('list', { name: 'For the sauce' }), PEPPER.name)).toBeVisible();
        const fields = await openIngredientEditor(page, PEPPER.name);

        await expect(fields.getByLabel('Amount', { exact: true })).toHaveValue('2');
        await expect(fields.getByRole('combobox', { name: 'Unit' })).toHaveValue('clove');
        await expect(fields.getByLabel('Preparation')).toHaveValue('minced');
        expect(rebinds.map((each) => [each.path, each.body])).toEqual([
            [
                `/api/v1/recipes/${RECIPE_ID}/ingredients/1/rebind`,
                { expectedVersion: 1, target: { kind: 'catalogFood', foodId: PEPPER.foodId } },
            ],
        ]);
        expect(store.get(RECIPE_ID)?.ingredients[1]).toMatchObject({
            foodId: PEPPER.foodId,
            preparation: 'minced',
            groupLabel: 'For the sauce',
        });
        expect(store.get(RECIPE_ID)?.ingredients[0]?.ingredientId).toBe(SALT_ID);
    });

    test('row 1 Find a food: a line in the cook’s own wording gets a food from its own field', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        const mixLine = {
            ingredientId: MIX_ID,
            name: 'my spice mix',
            quantity: { kind: 'exact', value: 1 },
            unit: 'tbsp',
            isUserEntered: true,
        } as const;
        const store = await mockRecipeApi(page, { viewerId, recipes: [savedRecipe(viewerId, mixLine)] });
        await mockFoodApi(page);
        const rebinds = await mockRebind(page, store, { foodNames: { [PEPPER.foodId]: PEPPER.name } });

        await openIngredientsSection(page);
        const ingredients = page.getByRole('region', { name: 'Ingredients' });

        await ingredients.getByRole('button', { name: 'Actions for my spice mix' }).click();
        await page.getByRole('menuitem', { name: 'Find a food for this' }).click();
        const field = ingredients.getByRole('combobox', { name: 'Ingredient 2 name' });

        await expect(field).toBeFocused();
        await field.fill('pepper');
        await page.getByRole('option', { name: PEPPER.name }).click();

        await expect(ingredientOpen(ingredients, PEPPER.name)).toBeVisible();
        expect(rebinds.map((each) => each.body)).toEqual([
            { expectedVersion: 1, target: { kind: 'catalogFood', foodId: PEPPER.foodId } },
        ]);
    });

    test('R7: text a Change food row holds refuses Publish from the Steps section, lands in that field, and “as written” lets it publish', async ({
        page,
    }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        const store = await mockRecipeApi(page, { viewerId, recipes: [savedRecipe(viewerId, garlicLine)] });
        await mockFoodApi(page);
        const rebinds = await mockRebind(page, store, {});

        await openIngredientsSection(page);
        const ingredients = page.getByRole('region', { name: 'Ingredients' });

        await ingredients.getByRole('button', { name: 'Actions for Garlic' }).click();
        await page.getByRole('menuitem', { name: 'Change food' }).click();
        await ingredients.getByRole('combobox', { name: 'Ingredient 2 name' }).fill('smoked garlic');
        // The cook can be in another section when the publish is refused.
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.getByRole('navigation', { name: 'Recipe sections' }).getByRole('link', { name: 'Steps' }).click();
        await page.getByRole('button', { name: 'Publish' }).click();

        // The refusal lands in the field, which says why; nothing was written.
        const field = page
            .getByRole('region', { name: 'Ingredients' })
            .getByRole('combobox', { name: 'Ingredient 2 name' });

        await expect(field).toBeFocused();
        await expect(field).toHaveAccessibleDescription(
            /“smoked garlic” isn’t in the recipe yet\. Choose a food for it, or press Cancel to keep Garlic\./,
        );
        await expect(
            page.getByText(
                'An ingredient you typed isn’t in the recipe yet. Choose a food for it, or delete what you typed.',
            ),
        ).toBeVisible();
        expect(store.get(RECIPE_ID)?.currentVersion).toBe(1);

        // The list opened with the focus (R7 item 3), so the cook keeps the words without editing them.
        await expect(field).toHaveAttribute('aria-expanded', 'true');
        await page.getByRole('option', { name: 'Use “smoked garlic” as written, without nutrition' }).click();
        await page.getByRole('button', { name: 'Publish' }).click();

        await expect(page.getByRole('heading', { name: 'Garlic supper' })).toBeVisible();
        expect(store.get(RECIPE_ID)?.ingredients[1]).toMatchObject({
            name: 'smoked garlic',
            isUserEntered: true,
            preparation: 'minced',
        });
        expect(store.get(RECIPE_ID)?.status).toBe('published');
        // A declaration has no food to rebind to, so it went through the draft, not the command (decision 7).
        expect(rebinds).toEqual([]);
    });

    test('a rebind to the food the line already uses writes nothing, and the next one still names version 1 (ADR-0045)', async ({
        page,
    }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        const pepperLine = {
            ingredientId: GARLIC_ID,
            foodId: PEPPER.foodId,
            name: PEPPER.name,
            quantity: { kind: 'exact', value: 1 },
            unit: 'tsp',
            isUserEntered: false,
            resolutionStatus: 'RESOLVED',
        } as const;
        const store = await mockRecipeApi(page, { viewerId, recipes: [savedRecipe(viewerId, pepperLine)] });
        await mockFoodApi(page);
        const rebinds = await mockRebind(page, store, { foodNames: { [PEPPER.foodId]: PEPPER.name } });

        await openIngredientsSection(page);
        const ingredients = page.getByRole('region', { name: 'Ingredients' });

        await ingredients.getByRole('button', { name: `Actions for ${PEPPER.name}` }).click();
        await page.getByRole('menuitem', { name: 'Change food' }).click();
        await ingredients.getByRole('combobox', { name: 'Ingredient 2 name' }).fill('pepper');
        await page.getByRole('option', { name: PEPPER.name }).click();

        await expect.poll(() => rebinds.length).toBe(1);
        expect(rebinds[0]?.body).toEqual({
            expectedVersion: 1,
            target: { kind: 'catalogFood', foodId: PEPPER.foodId },
        });
        expect(store.get(RECIPE_ID)?.currentVersion).toBe(1);

        // A real change on the other line: the editor adopted the unchanged version, so it still sends 1.
        await ingredients.getByRole('button', { name: 'Actions for Salt' }).click();
        await page.getByRole('menuitem', { name: 'Change food' }).click();
        await ingredients.getByRole('combobox', { name: 'Ingredient 1 name' }).fill('pepper');
        await page.getByRole('option', { name: PEPPER.name }).click();

        await expect.poll(() => rebinds.length).toBe(2);
        expect(rebinds[1]?.body.expectedVersion).toBe(1);
        expect(store.get(RECIPE_ID)?.currentVersion).toBe(2);
    });

    test('a rebind against a version another writer moved on opens the conflict view and writes nothing', async ({
        page,
    }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        const store = await mockRecipeApi(page, { viewerId, recipes: [savedRecipe(viewerId, garlicLine)] });
        await mockFoodApi(page);
        const rebinds = await mockRebind(page, store, { foodNames: { [PEPPER.foodId]: PEPPER.name } });

        await openIngredientsSection(page);
        const ingredients = page.getByRole('region', { name: 'Ingredients' });
        const loaded = store.get(RECIPE_ID);

        if (loaded === undefined) {
            throw new Error('the seeded recipe is not in the store');
        }

        // Another writer saved version 2 while the cook had the editor open.
        store.set(RECIPE_ID, { ...loaded, currentVersion: 2, title: 'Garlic supper, theirs' });
        await ingredients.getByRole('button', { name: 'Actions for Garlic' }).click();
        await page.getByRole('menuitem', { name: 'Change food' }).click();
        await ingredients.getByRole('combobox', { name: 'Ingredient 2 name' }).fill('pepper');
        await page.getByRole('option', { name: PEPPER.name }).click();

        // The seed is a never-published draft, so the conflict speaks of a draft saved elsewhere, with no versions
        // (ADR-0058; slice 7's draft conflict copy).
        await expect(page.getByRole('heading', { name: 'This draft changed somewhere else' })).toBeVisible();
        expect(rebinds.map((each) => each.body.expectedVersion)).toEqual([1]);
        expect(store.get(RECIPE_ID)?.ingredients[1]?.foodId).toBe('food_garlic');
    });

    test('row 6: the attention line opens a list searched from the line’s own words, and a remote pick rebinds the line', async ({
        page,
    }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        const store = await mockRecipeApi(page, { viewerId, recipes: [savedRecipe(viewerId, kaleLine)] });
        const searches = await mockFoodApi(page, {
            catalog: () => [],
            sources: () => [{ source: 'usda', outcome: 'answered', foods: [KALE_RAW] }],
        });
        const rebinds = await mockRebind(page, store, { foodNames: { [KALE_RAW.rootId]: KALE_RAW.name } });

        await openIngredientsSection(page);
        const ingredients = page.getByRole('region', { name: 'Ingredients' });

        // The panel never opens by itself, and nothing is searched until the cook asks.
        await expect(ingredients.getByRole('button', { name: 'Choose a match: Kale' })).toBeVisible();
        expect(searches).toEqual([]);

        await ingredients.getByRole('button', { name: 'Choose a match: Kale' }).click();
        const fromUsda = page.getByRole('list', { name: 'From USDA' });

        await fromUsda.getByRole('button', { name: `${KALE_RAW.name}, from USDA` }).click();

        await expect(fromUsda).toBeHidden();
        await expect(ingredientOpen(ingredients, KALE_RAW.name)).toBeFocused();
        await expect(page.getByText(`${KALE_RAW.name} is matched. Its nutrition now counts.`)).toBeVisible();
        await expect(ingredients.getByText('Choose a match')).toHaveCount(0);
        // One pick: the line's own words searched (sent as food's canonical term), the remote food adopted, then ONE
        // rebind of THAT line to its root.
        expect(searches).toEqual([
            { route: 'progressive', query: 'kale' },
            { route: 'adopt', reference: KALE_RAW.reference },
        ]);
        expect(rebinds.map((each) => [each.path, each.body])).toEqual([
            [
                `/api/v1/recipes/${RECIPE_ID}/ingredients/1/rebind`,
                { expectedVersion: 1, target: { kind: 'catalogFood', foodId: KALE_RAW.rootId } },
            ],
        ]);
    });

    test('row 6: None of these returns the line to its field with its amount kept, and writes nothing', async ({
        page,
    }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        const store = await mockRecipeApi(page, { viewerId, recipes: [savedRecipe(viewerId, kaleLine)] });
        const searches = await mockFoodApi(page, {
            catalog: () => [],
            sources: () => [{ source: 'usda', outcome: 'answered', foods: [KALE_RAW] }],
        });
        const rebinds = await mockRebind(page, store, {});

        await openIngredientsSection(page);
        const ingredients = page.getByRole('region', { name: 'Ingredients' });

        await ingredients.getByRole('button', { name: 'Choose a match: Kale' }).click();
        await page.getByRole('button', { name: 'None of these — search for a different food' }).click();

        await expect(ingredients.getByRole('combobox', { name: 'Ingredient 2 name' })).toBeFocused();
        // Leaving the search reads the row again, its amount and unit kept.
        await page.keyboard.press('Escape');
        await expect(ingredients.getByRole('button', { name: 'Edit 1 bunch Kale' })).toBeFocused();
        // Declining every food is not a binding: no adopt, no rebind, no new version.
        expect(searches.filter((each) => each.route === 'adopt')).toEqual([]);
        expect(rebinds).toEqual([]);
        expect(store.get(RECIPE_ID)?.currentVersion).toBe(1);
    });
});
