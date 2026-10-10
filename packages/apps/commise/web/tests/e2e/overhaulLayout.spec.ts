import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

import { role, roleDark } from '@commise/ui/colors';

import { BASE_PATH, route } from './utils/basePath';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * Layout geometry of the UI overhaul's screens, measured in a real browser at every capture width and in both themes
 * (`docs/design/uiOverhaul/evaluateFinal.md`). Each case reads boxes and line counts off the page, so it fails on the
 * defects the owner named — a control wrapping where it must not, content overflowing the page, a misaligned edge — which
 * role and name assertions cannot see.
 */

const WIDTHS = [320, 390, 768, 1024, 1440, 1920] as const;
const THEMES = [
    ['light', role],
    ['dark', roleDark],
] as const;

/** A phone height for each width; desktop widths get a desktop height. */
const heightOf = (width: number): number => (width < 600 ? 568 : width < 1024 ? 1024 : 900);

/**
 * How many lines the element's text occupies: the distinct line boxes of its text nodes. A one-line control answers 1.
 *
 * @param locator - The element.
 * @returns The line count.
 */
async function textLines(locator: Locator): Promise<number> {
    return locator.evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const tops = new Set<number>();

        for (const rect of Array.from(range.getClientRects())) {
            if (rect.width > 0 && rect.height > 0) {
                tops.add(Math.round(rect.top + rect.height / 2));
            }
        }

        // Rects on one line differ by sub-pixels between inline boxes; merge centres within 4 px.
        const sorted = [...tops].sort((a, b) => a - b);

        return sorted.filter((top, index) => index === 0 || top - (sorted[index - 1] ?? top) > 4).length;
    });
}

/** Whether the page scrolls sideways (SC 1.4.10). */
async function pageOverflowX(page: Page): Promise<number> {
    return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/** `#RRGGBB` → the `rgb(r, g, b)` spelling a computed style uses. */
function rgb(hex: string): string {
    const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));

    return `rgb(${r}, ${g}, ${b})`;
}

/** A computed style property of an element. */
const computed = (locator: Locator, property: 'backgroundColor' | 'color'): Promise<string> =>
    locator.evaluate((element, name) => getComputedStyle(element)[name], property);

/** A real 1x1 PNG, so a cover decodes and nothing reaches the network. */
const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
);
const PHOTO_ORIGIN = 'https://photos.layout.e2e.example';

/** Seed public recipes by other cooks, each with a cover photo and an author handle. */
async function seedCommunity(page: Page): Promise<void> {
    await page.route(`${PHOTO_ORIGIN}/**`, (photo) => photo.fulfill({ contentType: 'image/png', body: PNG }));
    await signInWithTicket(page);
    const viewerId = await readViewerAppId(page);
    const other = (id: string, title: string, handle: string): ReturnType<typeof makeRecipeDetail> =>
        makeRecipeDetail({
            id,
            ownerId: `usr_${handle}`,
            authorHandle: handle,
            title,
            visibility: 'public',
            status: 'published',
            coverPhotoUrl: `${PHOTO_ORIGIN}/${id}.png`,
            photos: [
                {
                    id: `pho_${id}`,
                    recipeId: id,
                    key: `recipes/${id}/p0.png`,
                    url: `${PHOTO_ORIGIN}/${id}.png`,
                    contentType: 'image/png',
                    order: 1,
                    createdAt: '2026-05-02T09:00:00.000Z',
                },
            ],
        });
    await mockRecipeApi(page, {
        viewerId,
        tier: 'premium',
        recipes: [
            other('ec000000-0000-4000-8000-0000000000b1', 'Seafood Paella', 'braise'),
            other('ec000000-0000-4000-8000-0000000000b2', 'Crispy Duck Legs', 'clara'),
            other('ec000000-0000-4000-8000-0000000000b3', 'Fruit Salad', 'mezze'),
            other('ec000000-0000-4000-8000-0000000000b5', 'Shakshuka', 'mezze'),
            other('ec000000-0000-4000-8000-0000000000b6', 'Wild Mushroom Risotto with Parmesan Crisps', 'clara'),
            other('ec000000-0000-4000-8000-0000000000b7', 'Ramen', 'braise'),
            // The two card shapes that collapsed to a 6 px strip in a rail (F6, the audit's fixture): a PRO recipe
            // with no photo, and one with a version past v1, tags and a difficulty but no author handle.
            makeRecipeDetail({
                id: 'ec000000-0000-4000-8000-0000000000b4',
                ownerId: viewerId,
                title: 'Lemon Tart',
                visibility: 'private',
                status: 'published',
                usesPremiumCapability: true,
                cuisine: 'French',
                photos: [],
            }),
            makeRecipeDetail({
                id: 'ec000000-0000-4000-8000-0000000000b8',
                ownerId: 'usr_braise',
                title: 'Braised Short Ribs',
                visibility: 'public',
                status: 'published',
                currentVersion: 12,
                difficulty: 'medium',
                cuisine: 'Korean',
                tags: ['slow-cooked', 'sunday lunch', 'make ahead'],
                photos: [],
            }),
        ],
    });
}

const LAMB_ID = 'ec000000-0000-4000-8000-0000000000c1';
const LAMB_TITLE = 'Slow-Roasted Lamb Shoulder with Preserved Lemon, Chickpeas and Herbs';

/** Seed one recipe the viewer owns, with every time, a difficulty, two ingredient groups and no photo. */
async function seedLamb(page: Page): Promise<void> {
    await signInWithTicket(page);
    const viewerId = await readViewerAppId(page);
    const line = (ingredientId: string, name: string, groupLabel: string) => ({
        ingredientId,
        name,
        foodId: `food_${name}`,
        quantity: { kind: 'exact' as const, value: 1 },
        unit: 'tbsp',
        isUserEntered: false,
        groupLabel,
    });
    await mockRecipeApi(page, {
        viewerId,
        tier: 'premium',
        recipes: [
            makeRecipeDetail({
                id: LAMB_ID,
                ownerId: viewerId,
                title: LAMB_TITLE,
                prepTimeMinutes: 30,
                cookTimeMinutes: 300,
                totalTimeMinutes: 330,
                difficulty: 'medium',
                photos: [],
                ingredients: [
                    line('11111111-1111-4111-8111-111111111111', 'salt', 'For the lamb'),
                    line('22222222-2222-4222-8222-222222222222', 'pepper', 'For the chickpeas'),
                ],
            }),
        ],
    });
}

/** Seed the viewer's library with a few recipes, so Home and My recipes have cards. */
async function seedLibrary(page: Page): Promise<void> {
    await signInWithTicket(page);
    const viewerId = await readViewerAppId(page);
    await mockRecipeApi(page, {
        viewerId,
        tier: 'premium',
        recipes: [
            makeRecipeDetail({
                id: 'ec000000-0000-4000-8000-0000000000a1',
                ownerId: viewerId,
                title: 'Weeknight Pasta',
            }),
            makeRecipeDetail({
                id: 'ec000000-0000-4000-8000-0000000000a2',
                ownerId: viewerId,
                title: 'Slow-Roasted Lamb Shoulder with Preserved Lemon, Chickpeas and Herbs',
            }),
            makeRecipeDetail({ id: 'ec000000-0000-4000-8000-0000000000a3', ownerId: viewerId, title: 'Garden Salad' }),
        ],
    });
}

for (const [scheme, colors] of THEMES) {
    test.describe(`overhaul layout, ${scheme}`, () => {
        test.use({ colorScheme: scheme });

        for (const width of WIDTHS) {
            test.describe(`at ${width} px`, () => {
                test.use({ viewport: { width, height: heightOf(width) } });

                // F1, F2, F16, F21 — Home leads with the recent recipes, groups the placeholders under one heading on
                // readable level-1 cards, lays the week out as seven columns, and starts at the content column.
                test('Home: recipes first, then the readable Coming soon group, no sideways scroll', async ({
                    page,
                }) => {
                    await seedLibrary(page);
                    await page.goto(route('/'));

                    const recent = page.getByRole('heading', { level: 2, name: 'Recent recipes' });
                    const comingSoon = page.getByRole('region', { name: 'Coming soon' });
                    await expect(recent).toBeVisible();
                    await expect(comingSoon.getByRole('heading', { level: 2, name: 'Coming soon' })).toBeAttached();

                    const recentBox = await recent.boundingBox();
                    const comingSoonBox = await comingSoon.boundingBox();
                    expect(recentBox?.y ?? 0).toBeLessThan(comingSoonBox?.y ?? 0);

                    // The placeholder card is `paper`, its title `ink`: the dark theme read 1.1:1 on light glass.
                    const nutrition = comingSoon.getByRole('region', { name: 'Today’s nutrition' });
                    await expect(nutrition).toBeAttached();
                    expect(await computed(nutrition, 'backgroundColor')).toBe(rgb(colors.paper));
                    expect(await computed(nutrition.getByRole('heading'), 'color')).toBe(rgb(colors.ink));

                    // Seven tiles in one row, inside the card.
                    const week = comingSoon.getByRole('region', { name: 'This week’s meals' });
                    const tiles = week.getByRole('listitem');
                    await expect(tiles).toHaveCount(7);
                    const weekBox = await week.boundingBox();
                    const first = await tiles.first().boundingBox();
                    const last = await tiles.last().boundingBox();
                    expect(first?.y).toBe(last?.y);
                    expect((last?.x ?? 0) + (last?.width ?? 0)).toBeLessThanOrEqual(
                        (weekBox?.x ?? 0) + (weekBox?.width ?? 0),
                    );
                    expect(first?.width ?? 0).toBeGreaterThanOrEqual(32);

                    // F21 — the greeting starts at the same edge as the content, at every width.
                    const greeting = page.getByRole('heading', { level: 1 });
                    expect(Math.round((await greeting.boundingBox())?.x ?? -1)).toBe(Math.round(recentBox?.x ?? -2));

                    expect(await pageOverflowX(page)).toBeLessThanOrEqual(0);
                });

                // F6 — a rail card on web shows its 4:3 cover and its "@handle" line, as Android does.
                test('Discover: each rail card shows its whole cover and its author line', async ({ page }) => {
                    await seedCommunity(page);
                    await page.goto(route('/discover'));

                    for (const [title, handle] of [
                        ['Seafood Paella', '@braise'],
                        ['Lemon Tart', undefined],
                        ['Braised Short Ribs', undefined],
                    ] as const) {
                        const card = page.getByRole('article', { name: title }).first();
                        await expect(card).toBeVisible();
                        // The cover is decorative (`aria-hidden`, the title names the card), so it has no role to find it
                        // by; its box — the size container `RecipeCover` draws — is MEASURED inside the card instead.
                        const box = await card.evaluate((article) => {
                            const cover = Array.from(article.querySelectorAll('div')).find(
                                (node) => getComputedStyle(node).containerType === 'size',
                            );
                            const rect = cover?.getBoundingClientRect();

                            return rect === undefined ? null : { width: rect.width, height: rect.height };
                        });
                        const cardBox = await card.boundingBox();

                        // The cover spans the card and keeps its 4:3 ratio, within rounding.
                        expect(box?.width ?? 0, title).toBeGreaterThan((cardBox?.width ?? 0) - 4);
                        expect(Math.abs((box?.height ?? 0) - ((box?.width ?? 0) * 3) / 4), title).toBeLessThanOrEqual(
                            2,
                        );

                        if (handle !== undefined) {
                            await expect(card.getByText(handle)).toBeVisible();
                        }
                    }

                    expect(await pageOverflowX(page)).toBeLessThanOrEqual(0);
                });

                // F7, F8, F9, F10, F14, F15 — the recipe page.
                test('Recipe page: title face, stat strip on one line per value, groups, band, bar, gutter', async ({
                    page,
                }) => {
                    await seedLamb(page);
                    await page.goto(route(`/recipes/${LAMB_ID}`));

                    const title = page.getByRole('heading', { level: 1, name: LAMB_TITLE });
                    await expect(title).toBeVisible();
                    expect(await title.evaluate((node) => getComputedStyle(node).fontFamily)).toMatch(/Playfair/u);

                    // F7: each stat value on one line ("5 h 30 min", "Medium" whole).
                    for (const value of ['5 h 30 min', '30 min', '5 h', 'Medium']) {
                        const cell = page.getByText(value, { exact: true }).first();
                        await expect(cell).toBeVisible();
                        expect(await textLines(cell), value).toBe(1);
                        expect(
                            await cell.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
                            `${value} is not cut`,
                        ).toBe(true);
                    }

                    // F9: the group overlines.
                    await expect(page.getByRole('heading', { level: 3, name: 'For the lamb' })).toBeVisible();

                    // F15: below 600 the page gutter is 16 px, the same as a top-level screen.
                    if (width < 600) {
                        expect(Math.round((await title.boundingBox())?.x ?? 0)).toBe(16);
                    }

                    // F14: below a 720 px body the section bar's links never sit under its toggle.
                    const sections = page.getByRole('navigation', { name: 'Recipe sections' });

                    if (await sections.isVisible()) {
                        const nutrition = sections.getByRole('link', { name: 'Nutrition' });
                        await nutrition.focus();
                        const link = await nutrition.boundingBox();
                        const nav = await sections.boundingBox();
                        expect((link?.x ?? 0) + (link?.width ?? 0)).toBeLessThanOrEqual(
                            (nav?.x ?? 0) + (nav?.width ?? 0) + 1,
                        );
                        expect(link?.width ?? 0).toBeGreaterThanOrEqual(24);
                    }

                    expect(await pageOverflowX(page)).toBeLessThanOrEqual(0);
                });

                // F11 — a short sheet on a phone is as tall as its content, with a full-width primary.
                test('New collection sheet: content height below sm, a full-width primary below 840', async ({
                    page,
                }) => {
                    await seedLibrary(page);
                    await page.goto(route('/collections'));

                    await page
                        .getByRole('button', { name: 'New collection' })
                        .filter({ visible: true })
                        .first()
                        .click();
                    const dialog = page.getByRole('dialog', { name: 'New collection' });
                    await expect(dialog).toBeVisible();
                    const sheet = await dialog.boundingBox();
                    const create = await dialog.getByRole('button', { name: 'Create collection' }).boundingBox();

                    if (width < 640) {
                        expect(sheet?.height ?? 0).toBeLessThan(heightOf(width) - 32);
                        expect(Math.round((sheet?.y ?? 0) + (sheet?.height ?? 0))).toBe(heightOf(width));
                    }

                    if (width < 840) {
                        expect(create?.width ?? 0).toBeGreaterThan((sheet?.width ?? 0) - 64);
                        await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeHidden();
                    } else {
                        await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeVisible();
                    }
                });

                // F15 — the editor's frame runs edge to edge: its header is a bar at the top edge, not an inset card.
                test('Editor: the header bar meets the top edge and the side of the content box', async ({ page }) => {
                    await seedLamb(page);
                    await page.goto(route(`/recipes/${LAMB_ID}/edit`));

                    const heading = page.getByRole('heading', { level: 1, name: 'Edit recipe' });
                    await expect(heading).toBeVisible();
                    const bar = await heading.evaluate((node) => {
                        const header = node.closest('header') ?? node.parentElement;
                        const rect = header?.getBoundingClientRect();

                        return rect === undefined ? null : { top: rect.top, left: rect.left };
                    });
                    const main = await page.getByRole('main').boundingBox();

                    expect(Math.round(bar?.top ?? -1)).toBe(0);
                    expect(Math.round(bar?.left ?? -1)).toBe(Math.round(main?.x ?? -2));
                });

                // The editor's frame owns the page gutter (`<main>` gives a focused task none): 16 below 600, 24 from 600,
                // 32 from 840 (`buildSpec.md` §1.2).
                test('Editor: the content column keeps the page gutter for this width', async ({ page }) => {
                    await seedLamb(page);
                    await page.goto(route(`/recipes/${LAMB_ID}/edit`));

                    const heading = page.getByRole('heading', { level: 2, name: 'Details' });
                    await expect(heading).toBeVisible();
                    const gutters = await heading.evaluate((node) => {
                        const column = node.closest('section')?.parentElement;
                        const style = column === null || column === undefined ? null : getComputedStyle(column);

                        return style === null
                            ? null
                            : {
                                  left: Number.parseFloat(style.paddingLeft),
                                  right: Number.parseFloat(style.paddingRight),
                              };
                    });
                    const expected = width < 600 ? 16 : width < 840 ? 24 : 32;

                    expect(gutters).toEqual({ left: expected, right: expected });
                });

                // F18 — the 404 is the branded page: the large title and a primary Back to Home.
                test('404: the large title and the primary Back to Home', async ({ page }) => {
                    await signInWithTicket(page);
                    await page.goto(route('/no-such-page-here'));

                    const heading = page.getByRole('heading', { level: 1, name: 'We couldn’t find that page.' });
                    await expect(heading).toBeVisible();
                    expect(await heading.evaluate((node) => getComputedStyle(node).fontFamily)).toMatch(/Playfair/u);
                    const back = page.getByRole('link', { name: 'Back to Home' });

                    // The Button's 44 px floor; a fine pointer at `md` and up takes the desktop density by design.
                    if (width < 768) {
                        expect((await back.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
                    }

                    expect(await computed(back, 'backgroundColor')).toBe(rgb(colors.action));
                });

                // F5 — the result bar's Sort control stays on one line at every width, and at 320 × 568 a whole card
                // still shows on the first screen.
                test('My recipes: the sort control is one line and the first card shows whole', async ({ page }) => {
                    await seedLibrary(page);
                    await page.goto(route('/recipes'));

                    const sort = page.getByRole('button', { name: /^Sort: / });
                    await expect(sort).toBeVisible();
                    expect(await textLines(sort)).toBe(1);

                    const view = page.getByRole('radiogroup', { name: 'View' });
                    expect((await view.boundingBox())?.width ?? 0).toBeLessThan(160);

                    const firstCard = page
                        .getByRole('link', { name: /Weeknight Pasta|Slow-Roasted|Garden Salad/u })
                        .first();
                    await expect(firstCard).toBeVisible();
                    const card = await firstCard.boundingBox();
                    const tabBar = page.getByRole('navigation', { name: 'Main' }).filter({ visible: true });
                    const barTop = width < 840 ? ((await tabBar.boundingBox())?.y ?? heightOf(width)) : heightOf(width);
                    expect((card?.y ?? 0) + (card?.height ?? 0)).toBeLessThanOrEqual(barTop);

                    expect(await pageOverflowX(page)).toBeLessThanOrEqual(0);
                });
            });
        }
    });
}

// F3 — a static file under `public/` is served at the root, never locale-redirected.
test('serves the sign-in photo from public/ without a locale redirect', async ({ page }) => {
    // Not `route()`: that adds the locale, and a static file has none.
    const response = await page.request.get(`${BASE_PATH}/images/auth/authFood.jpg`, { maxRedirects: 0 });

    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toMatch(/^image\//u);
});
