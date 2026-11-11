import { expect, test, type Page, type Request } from '@playwright/test';

import { signInWithTicket } from './utils/auth';
import { mockFoodApi } from './utils/foodApi';
import { mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { chooseCuisine, editorSection, openNewRecipe } from './utils/recipeEditor';

const LINK = 'https://www.allrecipes.com/recipe/1/soup/';

/** What a write to the recipes API carried: its method, its path and its JSON body, if it had one. */
interface RecipeWrite {
    readonly method: string;
    readonly path: string;
    readonly body: Record<string, unknown> | null;
}

/** Record every write to the recipes API the page makes, so the spec can read what the editor sent. */
function recordRecipeWrites(page: Page): RecipeWrite[] {
    const writes: RecipeWrite[] = [];

    page.on('request', (request: Request) => {
        const { pathname } = new URL(request.url());

        if (request.method() !== 'GET' && pathname.includes('/api/v1/recipes')) {
            const body: unknown = request.postDataJSON();

            writes.push({
                method: request.method(),
                path: pathname,
                body: typeof body === 'object' && body !== null ? Object.fromEntries(Object.entries(body)) : null,
            });
        }
    });

    return writes;
}

/**
 * A web link pasted with the steps becomes the recipe's Source (ADR-0089): the link line is not a step, the Source row
 * shows the site, Public becomes unavailable with its reason, and the recipe is published private with its source. The
 * recipe-service HTTP contract is intercepted (`utils/recipeApi`, which persists `statement` as the service does); the real
 * service's own create and PATCH are covered by its integration and e2e suites. Selectors are role/label only. Serial
 * (Clerk-authed).
 */
test.describe('a pasted web link sets the recipe’s Source (ADR-0089)', () => {
    test('paste steps with a link → Source shown, Public unavailable → publish → a private recipe with its source', async ({
        page,
    }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, paidFeatures: 'granted' });
        await mockFoodApi(page);
        const writes = recordRecipeWrites(page);

        await openNewRecipe(page);
        await page.getByLabel('Title').fill('E2E Soup from the web');
        await chooseCuisine(page);
        await page.getByRole('combobox', { name: 'Add an ingredient' }).fill('salt');
        await page
            .getByRole('group', { name: 'Food catalog' })
            .getByRole('option', { name: 'Salt', exact: true })
            .click();

        // Paste steps with a link line under them.
        await page.getByRole('button', { name: 'Paste steps' }).click();
        await page.getByRole('textbox', { name: 'Steps', exact: true }).fill(`Simmer the stock.\n${LINK}`);
        // The link is not a step: the count leaves it out.
        await page.getByRole('button', { name: 'Add 1 step' }).click();

        // The Source is filled, says which site, and the recipe can only be private.
        const photosAndPublish = editorSection(page, 'Photos & publish');

        await expect(photosAndPublish.getByRole('textbox', { name: 'Source' })).toHaveValue(LINK);
        await expect(photosAndPublish.getByText('Copied from a public web page · allrecipes.com')).toBeVisible();
        await expect(photosAndPublish.getByRole('radio', { name: /^Public/u })).toHaveAttribute(
            'aria-disabled',
            'true',
        );
        await expect(
            photosAndPublish.getByText(/copied from a web page, and its author owns the writing/u),
        ).toBeVisible();
        await expect(photosAndPublish.getByRole('radio', { name: /^Private/u })).toBeChecked();
        await expect(page.getByRole('textbox', { name: /^Step 1$/u })).toHaveValue('Simmer the stock.');
        await expect(page.getByRole('textbox', { name: /^Step 2$/u })).toHaveCount(0);

        await page.getByRole('button', { name: 'Publish', exact: true }).click();

        // The recipe was published, with the source on the detail page and never as a public recipe.
        await expect(page.getByRole('heading', { name: 'E2E Soup from the web' })).toBeVisible();
        await expect(page.getByText('Recipe published.')).toBeVisible();
        await expect(page.getByRole('link', { name: 'www.allrecipes.com' })).toHaveAttribute('href', LINK);

        const withStatement = writes.filter((write) => write.body?.['statement'] !== undefined);

        expect(withStatement.length).toBeGreaterThan(0);

        for (const write of withStatement) {
            expect(write.body?.['statement']).toEqual({ kind: 'public_web', citation: LINK });
            // The server refuses a public web copy: the editor never sends Public with a statement.
            expect(write.body?.['visibility']).not.toBe('public');
        }

        // The recipe ended Private: a draft saved before the link was pasted may have been created Public, and the Publish
        // moves it to Private first (the visibility write comes BEFORE the first publish).
        expect(writes.some((write) => write.body?.['status'] === 'published')).toBe(true);
        expect(writes.some((write) => write.body?.['visibility'] === 'private')).toBe(true);
    });
});
