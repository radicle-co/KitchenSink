import { expect, test, type Request } from '@playwright/test';
import { FoodResolutionStatus, ingredientSchema } from '@kitchensink/recipe-core';

import { signInWithTicket } from './utils/auth';
import { mockFoodApi } from './utils/foodApi';
import { E2E_SALT_FOOD, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { openNewRecipe } from './utils/recipeEditor';

/**
 * "Find nutrition for “…”" on a row of the create form (`docs/design/rowEditorOpenDecisions.md` item 1; the `name` pick
 * of `FR/hooks/lineCommit.ts`), through the real web app with the recipe contract and food's progressive search
 * intercepted. The web twin of the Maestro flow `recipes/ingredientCandidates.yaml` up to its `Not resolved` wait: the
 * cook changes a line's food to words no catalog food matches and asks food to find them by name.
 *
 * The design it holds the app to: the option is the first of `Not listed?`; the pick is ONE `by-name` admission of the
 * cook's words; a line that lands `UNRESOLVED` is committed as it is, and the candidates panel does not open by itself;
 * from a row in entry mode focus goes to that row's glyph, and the status line names the glyph to choose with. The line
 * is the same line, so its amount and unit stay, and the draft saves it with the binding food made.
 *
 * REWRITTEN for slice 7: Save Draft is gone. The editor saves at checkpoints through the outbox, so the save here is the
 * exit's checkpoint (× Close editor), and the stored recipe is polled until that write lands.
 *
 * What only this tier proves: the pick reaches the wire as the cook's words, and a real browser moves focus. The
 * per-state rules are the component tests' (`RecipeIngredientsFields.rowEditor.test.tsx`). Selectors are role, label
 * and text only.
 */
const TITLE = 'E2E Find Nutrition';
const WORDS = 'halloumi';

test.describe('Find nutrition on a row of the create form (rowEditorOpenDecisions item 1)', () => {
    test('Find nutrition for “…” puts the line on by the cook’s words: one by-name admission, it waits for a choice, and the draft saves it', async ({
        page,
    }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        const store = await mockRecipeApi(page, { viewerId, byNameStatus: FoodResolutionStatus.UNRESOLVED });
        // The catalog has Salt, and nothing for the cook's words, as the Maestro flow's stage has nothing for them.
        await mockFoodApi(page, {
            catalog: (query) =>
                query.startsWith('sal') ? [{ id: E2E_SALT_FOOD.foodId, name: E2E_SALT_FOOD.name, score: 0.95 }] : [],
        });
        // Registered after the double, so it sees each admission first and then hands it on.
        const byName: Request[] = [];
        await page.route('**/api/v1/ingredients/by-name', async (intercepted) => {
            byName.push(intercepted.request());
            await intercepted.fallback();
        });

        await openNewRecipe(page);
        await page.getByLabel('Title').fill(TITLE);
        const ingredients = page.getByRole('region', { name: 'Ingredients' });

        // A line to work on, with an amount of its own, typed in front of the food (build spec §7.5.3).
        await page.getByRole('combobox', { name: 'Add an ingredient' }).fill('200 g sal');
        await page
            .getByRole('group', { name: 'Food catalog' })
            .getByRole('option', { name: E2E_SALT_FOOD.name, exact: true })
            .click();
        await expect(ingredients.getByRole('button', { name: `Edit 200 g ${E2E_SALT_FOOD.name}` })).toBeVisible();

        await ingredients.getByRole('button', { name: `Actions for ${E2E_SALT_FOOD.name}` }).click();
        await page.getByRole('menuitem', { name: 'Change food' }).click();
        const field = ingredients.getByRole('combobox', { name: 'Ingredient 1 name' });

        await expect(field).toBeFocused();
        await field.fill(WORDS);
        // Item 1: finding the nutrition by name is the first way on that `Not listed?` offers.
        const findByName = page.getByRole('group', { name: 'Not listed?' }).getByRole('option').first();

        await expect(findByName).toHaveAccessibleName(`Find nutrition for “${WORDS}”`);
        await findByName.click();

        // The line now carries the cook's words, and keeps its amount (the same line); its attention line says it is
        // waiting for a choice. Focus is on the row's open control, and the status line names the way on.
        const row = ingredients.getByRole('button', { name: `Edit 200 g ${WORDS}` });

        await expect(row).toBeFocused();
        await expect(ingredients.getByRole('button', { name: `Choose a match: ${WORDS}` })).toBeVisible();
        await expect(
            page.getByText(
                `Added ${WORDS}. It could be more than one food. Use its “Choose a match” line to choose one.`,
            ),
        ).toBeVisible();
        // The candidates panel never opens by itself: the cook opens it from the attention line.
        await expect(
            page.getByText('We found more than one food this could be, and we need you to say which.'),
        ).toHaveCount(0);
        // ONE admission, of the words as typed.
        expect(byName.map((request) => request.postDataJSON())).toEqual([{ name: WORDS }]);
        const admitted = ingredientSchema.parse(await (await byName[0]?.response())?.json());

        // Leaving is a checkpoint (A3): the draft's write goes out through the outbox, without asking.
        await page.getByRole('button', { name: 'Close editor' }).click();
        await expect(page.getByRole('alertdialog')).toHaveCount(0);

        // The saved line names the binding food made for the words, not Salt's, and keeps its amount.
        await expect
            .poll(() => [...store.values()].find((recipe) => recipe.title === TITLE)?.ingredients)
            .toEqual([
                expect.objectContaining({
                    ingredientId: admitted.id,
                    name: WORDS,
                    foodId: admitted.foodId,
                    quantity: { kind: 'exact', value: 200 },
                    unit: 'g',
                    isUserEntered: false,
                }),
            ]);
    });
});
