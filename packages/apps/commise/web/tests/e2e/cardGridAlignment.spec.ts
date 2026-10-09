import { expect, test, type Locator } from '@playwright/test';

import { route } from './utils/basePath';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * The recipe card's layout contract on My recipes (`docs/design/uiOverhaul/buildSpec.md` §4.1, slice 4 in §13):
 *
 *  - in the grid view, each card is a subgrid, so the rows line up across a grid row: every card's title starts at
 *    the same height, and so does every card's footer, however long a neighbour's title or tags run;
 *  - no card's cover is blank: each draws a photo or its monogram;
 *  - at 390 × 844 the list view shows the first card fully on the first screen.
 *
 * Driven through the real web UI with the recipe-service contract intercepted. Selectors are role/label only.
 */
const seed = (viewerId: string) => [
    makeRecipeDetail({ id: 'rec_a', ownerId: viewerId, title: 'Soup', tags: [] }),
    makeRecipeDetail({
        id: 'rec_b',
        ownerId: viewerId,
        title: 'Slow-Roasted Lamb Shoulder with Preserved Lemon, Chickpeas and a Long Title That Wraps',
        cuisine: 'Moroccan',
        tags: ['gluten-free', 'slow-cooked', 'braise', 'winter'],
    }),
    makeRecipeDetail({ id: 'rec_c', ownerId: viewerId, title: 'Pasta', cuisine: 'Italian', tags: ['quick'] }),
];

/** The top of a card's element, rounded to the pixel. */
async function topOf(locator: Locator): Promise<number> {
    const box = await locator.boundingBox();

    expect(box, 'the element is laid out').not.toBeNull();

    return Math.round(box?.y ?? 0);
}

/** The card surface (`paper`) per scheme: white in light, `roleDark.paper` (#1E1B18) in dark (owner ruling D15). */
const PAPER = { light: 'rgb(255, 255, 255)', dark: 'rgb(30, 27, 24)' } as const;

for (const colorScheme of ['light', 'dark'] as const) {
    test.describe(`recipe cards — grid alignment and covers (${colorScheme})`, () => {
        test.use({ colorScheme });

        test('aligns the rows of the grid cards across one grid row, and never draws a blank cover', async ({
            page,
        }) => {
            await page.setViewportSize({ width: 1280, height: 900 });
            await signInWithTicket(page);
            const viewerId = await readViewerAppId(page);
            await mockRecipeApi(page, { viewerId, tier: 'premium', recipes: seed(viewerId) });
            await page.goto(route('/recipes'));
            const cards = page.getByRole('article');
            await expect(cards).toHaveCount(3);

            // The cook's choice, kept in a cookie so the next server render draws it first: list, then back to grid.
            const view = page.getByRole('radiogroup', { name: 'View' });
            await view.getByRole('radio', { name: 'List view' }).click();
            await expect(cards.first()).toHaveAttribute('data-card-variant', 'row');
            await view.getByRole('radio', { name: 'Grid view' }).click();
            expect((await page.context().cookies()).find((cookie) => cookie.name === 'recipes.viewMode')?.value).toBe(
                'grid',
            );

            for (const card of await cards.all()) {
                await expect(card).toHaveAttribute('data-card-variant', 'grid');
            }

            const titleTops = await Promise.all((await cards.all()).map((card) => topOf(card.getByRole('heading'))));
            const footerTops = await Promise.all(
                (await cards.all()).map((card) => topOf(card.getByText(/^(?:v\d+ · )?(?:Created|Edited) /))),
            );

            expect(new Set(titleTops).size, `title tops ${titleTops.join(', ')}`).toBe(1);
            // Every colour is a role, so the card re-themes with the browser's scheme.
            await expect(cards.first()).toHaveCSS('background-color', PAPER[colorScheme]);
            expect(new Set(footerTops).size, `footer tops ${footerTops.join(', ')}`).toBe(1);

            // A cover is a photo or a monogram, never an empty box: each card's first row has visible content.
            for (const card of await cards.all()) {
                const coverText = await card.evaluate(
                    (element) => element.firstElementChild?.textContent?.trim() ?? '',
                );
                const hasPhoto = await card.evaluate(
                    (element) => element.firstElementChild?.querySelector('img') !== null,
                );

                expect(hasPhoto || coverText.length > 0).toBe(true);
            }

            expect(await page.evaluate(() => document.documentElement.scrollWidth === window.innerWidth)).toBe(true);
        });

        test('shows the first card fully on the first screen of a 390 × 844 phone, in the list view', async ({
            page,
        }) => {
            await page.setViewportSize({ width: 390, height: 844 });
            await signInWithTicket(page);
            const viewerId = await readViewerAppId(page);
            await mockRecipeApi(page, { viewerId, tier: 'premium', recipes: seed(viewerId) });

            await page.goto(route('/recipes'));
            const first = page.getByRole('article').first();
            await expect(first).toHaveAttribute('data-card-variant', 'row');

            const box = await first.boundingBox();

            expect(box).not.toBeNull();
            expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(844);
            expect(await page.evaluate(() => document.documentElement.scrollWidth === window.innerWidth)).toBe(true);
        });
    });
}
