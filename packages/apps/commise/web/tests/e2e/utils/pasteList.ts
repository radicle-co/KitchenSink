import { expect } from '@playwright/test';
import type { Locator, Page, Request } from '@playwright/test';

import { editorSection } from './recipeEditor';

/**
 * Paste a list into a new recipe's Ingredients section, as the specs of the matched paste (ADR-0071) all begin. Role and
 * label selectors only.
 *
 * @param page - The page, on a new recipe.
 * @param text - The lines, one per line.
 * @returns The Ingredients section.
 */
export async function pasteList(page: Page, text: string): Promise<Locator> {
    const ingredients = editorSection(page, 'Ingredients');
    const count = text.split('\n').filter((line) => line.trim() !== '').length;

    await ingredients.getByRole('button', { name: 'Paste a list' }).click();
    const sheet = page.getByRole('dialog', { name: 'Paste a list' });

    await sheet.getByRole('textbox', { name: 'Ingredient lines' }).fill(text);
    await sheet.getByRole('button', { name: count === 1 ? 'Add 1 ingredient' : `Add ${count} ingredients` }).click();
    await expect(sheet).toHaveCount(0);

    return ingredients;
}

/** The recipe-service requests a page makes, recorded as they leave the browser. */
export interface RecordedRequests {
    /** `METHOD /path` of every recipe-service request, in order. */
    readonly routes: () => readonly string[];
    /** The JSON bodies sent to a path, in order. */
    readonly bodiesOf: (path: string) => readonly unknown[];
}

/**
 * Record the recipe-service requests a page makes from now on (the `/api/v1/` ones), so a spec can say what was NOT sent:
 * a lookup by name, or a food nobody chose.
 *
 * @param page - The page.
 * @returns What was sent.
 */
export function recordRequests(page: Page): RecordedRequests {
    const sent: Request[] = [];

    page.on('request', (request) => {
        if (new URL(request.url()).pathname.includes('/api/v1/')) {
            sent.push(request);
        }
    });

    return {
        routes: () => sent.map((request) => `${request.method()} ${new URL(request.url()).pathname}`),
        bodiesOf: (path) =>
            sent
                .filter((request) => new URL(request.url()).pathname.endsWith(path) && request.postData() !== null)
                .map((request) => request.postDataJSON() as unknown),
    };
}
