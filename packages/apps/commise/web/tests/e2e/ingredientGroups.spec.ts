import { expect, test } from '@playwright/test';

import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';
import { mockFoodApi } from './utils/foodApi';
import { chooseRowAction, ingredientOpen, openRecipeEditor } from './utils/recipeEditor';

/**
 * Ingredient groups and row order, end to end (UI overhaul slice 8, build spec §7.5.1 and §7.5.5): a cook names a
 * group, adds to it from its own add field, moves a line into it and back out, reorders inside a group with the `⋯`'s
 * Move up (SC 2.5.7: no drag needed), renames the group and removes it keeping its lines; Save changes writes each
 * line's own group label (the data model is unchanged: a group is its lines' `groupLabel`).
 *
 * What only this tier proves: the groups survive the real editor, router and client hooks into the saved body, in the
 * order the cook arranged. The rules are pinned by `ingredientGroups.test.ts` and `useIngredientsFields.test.ts`.
 * Selectors are role, label and text only. Serial (Clerk-authed).
 */
const RECIPE_ID = 'ec000000-0000-4000-8000-0000000000a1';

const line = (id: string, name: string, groupLabel?: string) => ({
    ingredientId: id,
    foodId: `food_${name.toLowerCase()}`,
    name,
    quantity: { kind: 'exact' as const, value: 1 },
    unit: 'tsp',
    isUserEntered: false,
    resolutionStatus: 'RESOLVED' as const,
    ...(groupLabel === undefined ? {} : { groupLabel }),
});

test.describe('ingredient groups (build spec §7.5.5)', () => {
    test('a cook groups, reorders, renames and ungroups lines, and Save changes writes each line’s group', async ({
        page,
    }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        const store = await mockRecipeApi(page, {
            viewerId,
            tier: 'premium',
            recipes: [
                makeRecipeDetail({
                    id: RECIPE_ID,
                    ownerId: viewerId,
                    title: 'Grouped curry',
                    currentVersion: 1,
                    ingredients: [
                        line('66666666-6666-4666-8666-666666666661', 'Cumin'),
                        line('66666666-6666-4666-8666-666666666662', 'Garlic'),
                        line('66666666-6666-4666-8666-666666666663', 'Ginger'),
                    ],
                }),
            ],
        });
        await mockFoodApi(page);

        await openRecipeEditor(page, RECIPE_ID);
        const ingredients = page.getByRole('region', { name: 'Ingredients' });

        // An ungrouped recipe shows no group chrome.
        await expect(ingredients.getByRole('heading', { level: 3 })).toHaveCount(0);

        // + Add a group: a name, then an empty group holding the add field, which takes focus.
        await ingredients.getByRole('button', { name: 'Add a group' }).click();
        await expect(ingredients.getByRole('textbox', { name: 'Group name' })).toBeFocused();
        await page.keyboard.type('Paste');
        await page.keyboard.press('Enter');
        await expect(ingredients.getByRole('heading', { level: 3, name: 'Paste' })).toBeVisible();
        await expect(ingredients.getByRole('combobox', { name: 'Add to Paste' })).toBeFocused();

        // Move to group…: Garlic, then Ginger, into the new group.
        for (const food of ['Garlic', 'Ginger']) {
            await chooseRowAction(page, food, 'Move to group…');
            await page.getByRole('dialog', { name: 'Move to group' }).getByRole('button', { name: 'Paste' }).click();
        }

        const paste = ingredients.getByRole('list', { name: 'Paste' });

        await expect(paste.getByRole('button', { name: /^Edit / })).toHaveText(['1 tspGarlic', '1 tspGinger']);
        await expect(ingredientOpen(ingredients.getByRole('list', { name: 'Ingredients' }), 'Cumin')).toBeVisible();

        // Move up inside the group; focus stays on the row's ⋯.
        await chooseRowAction(page, 'Ginger', 'Move up');
        await expect(paste.getByRole('button', { name: /^Edit / })).toHaveText(['1 tspGinger', '1 tspGarlic']);
        await expect(page.getByRole('button', { name: 'Actions for Ginger' })).toBeFocused();

        // Rename the group: every line in it follows.
        await chooseRowAction(page, 'Paste', 'Rename group');
        const name = ingredients.getByRole('textbox', { name: 'Group name' });

        await name.fill('Curry paste');
        await ingredients.getByRole('button', { name: 'Save', exact: true }).click();
        await expect(ingredients.getByRole('heading', { level: 3, name: 'Curry paste' })).toBeVisible();

        await page.getByRole('button', { name: 'Save changes' }).click();
        await expect(page.getByRole('heading', { name: 'Grouped curry' })).toBeVisible();

        expect(store.get(RECIPE_ID)?.ingredients.map((saved) => [saved.name, saved.groupLabel ?? null])).toEqual([
            ['Cumin', null],
            ['Ginger', 'Curry paste'],
            ['Garlic', 'Curry paste'],
        ]);
    });

    test('Remove group keeps its ingredients, joined to the ungrouped lines', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            tier: 'premium',
            recipes: [
                makeRecipeDetail({
                    id: RECIPE_ID,
                    ownerId: viewerId,
                    title: 'Grouped curry',
                    currentVersion: 1,
                    ingredients: [
                        line('66666666-6666-4666-8666-666666666661', 'Cumin'),
                        line('66666666-6666-4666-8666-666666666662', 'Garlic', 'Paste'),
                    ],
                }),
            ],
        });
        await mockFoodApi(page);

        await openRecipeEditor(page, RECIPE_ID);
        const ingredients = page.getByRole('region', { name: 'Ingredients' });

        await chooseRowAction(page, 'Paste', 'Remove group (keep its ingredients)');

        await expect(ingredients.getByRole('heading', { level: 3 })).toHaveCount(0);
        await expect(
            ingredients.getByRole('list', { name: 'Ingredients' }).getByRole('button', { name: /^Edit / }),
        ).toHaveText(['1 tspCumin', '1 tspGarlic']);
    });

    // Build spec §7.2 and §7.5.6: from 960 the section rail's foot carries the Ingredients total too, the same line as
    // the section's foot, from the same read.
    test('at 1280 the section rail’s foot shows the running total', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            tier: 'premium',
            recipes: [
                makeRecipeDetail({
                    id: RECIPE_ID,
                    ownerId: viewerId,
                    title: 'Grouped curry',
                    currentVersion: 1,
                    ingredients: [line('66666666-6666-4666-8666-666666666661', 'Cumin')],
                }),
            ],
        });
        await mockFoodApi(page);

        await openRecipeEditor(page, RECIPE_ID);
        const rail = page.getByRole('navigation', { name: 'Recipe sections' }).first();
        const sectionFoot = page.getByRole('region', { name: 'Ingredients' });

        await expect(rail).toBeVisible();
        await expect(rail).toContainText(/Nutrition appears as you match ingredients\.|cal per serving/u);
        const railText = (await rail.textContent()) ?? '';
        const footText = (await sectionFoot.textContent()) ?? '';
        const total = /Nutrition appears as you match ingredients\.|[\d,]+ cal per serving · \d+ of \d+ counted/u.exec(
            railText,
        )?.[0];

        expect(total).toBeDefined();
        expect(footText).toContain(total);
    });
});
