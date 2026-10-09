import { expect, test, type Page } from '@playwright/test';

import { route } from './utils/basePath';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * Recipe-detail HERO (mockup `screenRecipeDetail`), driven through the real web UI with the recipe/identity HTTP
 * contract intercepted (`utils/recipeApi`). The mockup opens the screen with the recipe's photos before any type.
 *
 * The hero IS the photo carousel (F2, `docs/design/uiOverhaul/evaluateRecipeAndWizard.md`). It used to paint the cover
 * as its own image, and a second carousel lower down painted it again as slide 1. Asserted as INTENT, in a real
 * browser:
 *
 *  1. **With photos** — slide 1 is the cover, accessibly named, it actually DECODED (a non-zero `naturalWidth`, so a
 *     wrong or never-fetched `src` cannot pass), it is laid out ABOVE the `h1`, and the cover's `src` appears exactly
 *     ONCE in the article. The box is the spec's hero box (`specRecipeAndWizard.md` S2.1): at most 40% of the window
 *     tall on a phone held sideways, and at most 480 px from `md` up.
 *  2. **Without a photo** — the deliberate labelled fallback is visible, the `h1` still renders, and there is NO
 *     `<img>` element anywhere in the detail article (an `<img>` with no `src` paints a broken-image glyph).
 *
 * Selectors are role/label only (repo policy); no `data-testid`, no `waitForTimeout`.
 */

/** A real 1x1 PNG — every photo must genuinely decode, and nothing may hit the network. */
const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
);

/** Where the fixture's photos are served from; `page.route` answers every one with {@link PNG}. */
const PHOTO_ORIGIN = 'https://photos.hero.e2e.example';

/** The localized copy the no-cover fallback carries — the SAME dictionary string the card placeholder uses. */
const NO_PHOTO_LABEL = 'No photo yet';

const TITLE = 'Blistered Shishito Peppers';

/** Seed a recipe with three photos (the first is the cover) plus the card's thumbnail of it, and open its detail. */
async function openRecipeWithPhotos(page: Page): Promise<void> {
    await page.route(`${PHOTO_ORIGIN}/**`, (photo) => photo.fulfill({ contentType: 'image/png', body: PNG }));
    await signInWithTicket(page);
    const viewerId = await readViewerAppId(page);
    await mockRecipeApi(page, {
        viewerId,
        tier: 'premium',
        recipes: [
            makeRecipeDetail({
                id: 'rec_hero',
                ownerId: viewerId,
                title: TITLE,
                coverPhotoUrl: `${PHOTO_ORIGIN}/p0.thumb.png`,
                photos: [0, 1, 2].map((index) => ({
                    id: `pho_hero_${String(index)}`,
                    recipeId: 'rec_hero',
                    key: `recipes/rec_hero/p${String(index)}.png`,
                    url: `${PHOTO_ORIGIN}/p${String(index)}.png`,
                    contentType: 'image/png',
                    order: index + 1,
                    createdAt: '2026-05-02T09:00:00.000Z',
                })),
            }),
        ],
    });

    await page.goto(route('/recipes/rec_hero'));
}

test.describe('recipe-detail hero', () => {
    test('a recipe WITH photos leads with them, above the title on a phone, and shows the cover once', async ({
        page,
    }) => {
        // Below a 960 px body the hero leads the page; from 960 it sits beside the title (the next test).
        await page.setViewportSize({ width: 390, height: 844 });
        await openRecipeWithPhotos(page);

        const heading = page.getByRole('heading', { level: 1, name: TITLE });
        await expect(heading).toBeVisible();

        const cover = page.getByRole('img', { name: `${TITLE} photo 1` });
        await expect(cover).toBeVisible();
        await expect(cover).toHaveAttribute('src', `${PHOTO_ORIGIN}/p0.png`);
        await expect
            .poll(() => cover.evaluate((element) => (element instanceof HTMLImageElement ? element.naturalWidth : 0)))
            .toBeGreaterThan(0);

        const coverBox = await cover.boundingBox();
        const headingBox = await heading.boundingBox();
        expect(coverBox).not.toBeNull();
        expect(headingBox).not.toBeNull();
        expect((coverBox?.y ?? 0) + (coverBox?.height ?? 0)).toBeLessThanOrEqual(headingBox?.y ?? 0);

        const article = page.getByRole('article', { name: TITLE });
        const coverSources = await article.evaluate(
            (element, src) => [...element.querySelectorAll('img')].filter((img) => img.src === src).length,
            `${PHOTO_ORIGIN}/p0.png`,
        );
        expect(coverSources).toBe(1);
        await expect(page.getByRole('region', { name: 'Recipe photos' })).toHaveCount(1);
        await expect(page.getByRole('img', { name: NO_PHOTO_LABEL })).toHaveCount(0);
    });

    test('from a 960 px body the hero sits at the END beside the title block, not above it (§6.1)', async ({
        page,
    }) => {
        await page.setViewportSize({ width: 1920, height: 1080 });
        await openRecipeWithPhotos(page);

        const coverBox = await page.getByRole('img', { name: `${TITLE} photo 1` }).boundingBox();
        const headingBox = await page.getByRole('heading', { level: 1, name: TITLE }).boundingBox();

        expect(coverBox).not.toBeNull();
        expect(headingBox).not.toBeNull();
        // Beside: the cover starts to the right of where the title ends, and overlaps it vertically.
        expect(coverBox?.x ?? 0).toBeGreaterThanOrEqual((headingBox?.x ?? 0) + (headingBox?.width ?? 0));
        expect(coverBox?.y ?? 0).toBeLessThan((headingBox?.y ?? 0) + (headingBox?.height ?? 0));
    });

    test('the hero is at most 40% of the window tall on a phone held sideways', async ({ page }) => {
        await page.setViewportSize({ width: 844, height: 390 });
        await openRecipeWithPhotos(page);

        const box = await page.getByRole('img', { name: `${TITLE} photo 1` }).boundingBox();
        expect(box?.height ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(390 * 0.4 + 1);
    });

    test('the hero is at most 480 px tall on a wide screen', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 900 });
        await openRecipeWithPhotos(page);

        const box = await page.getByRole('img', { name: `${TITLE} photo 1` }).boundingBox();
        expect(box?.height ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(481);
    });

    test('a recipe WITHOUT a cover shows the labelled fallback and renders no <img> at all', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        // `makeRecipeDetail` leaves `coverPhotoUrl` absent and `photos` empty — the state a draft, an import,
        // or a quick capture is in, which is why the fallback is a DESIGNED state and not an error path.
        await mockRecipeApi(page, {
            viewerId,
            tier: 'premium',
            recipes: [makeRecipeDetail({ id: 'rec_bare', ownerId: viewerId, title: 'Weeknight Dal' })],
        });

        await page.goto(route('/recipes/rec_bare'));

        // The title still renders (the hero box keeps its full height, so nothing is truncated or jumped).
        await expect(page.getByRole('heading', { level: 1, name: 'Weeknight Dal' })).toBeVisible();

        // The fallback is a single perceivable, LABELLED thing — announced once, not a silent grey rectangle.
        const fallback = page.getByRole('img', { name: NO_PHOTO_LABEL });
        await expect(fallback).toBeVisible();
        const fallbackBox = await fallback.boundingBox();
        expect(fallbackBox?.height ?? 0).toBeGreaterThan(0);

        // The DESIGN RULE, asserted as such: the fallback renders NO `<img>` element, because an empty `src`
        // paints a broken-image glyph. Scoped to the detail article, and read off the DOM rather than through
        // a role selector — `role="img"` divs and real `<img>` elements are the same role, and the whole
        // point here is which ELEMENT was used.
        const imageElementCount = await page
            .getByRole('article', { name: 'Weeknight Dal' })
            .evaluate((element) => element.querySelectorAll('img').length);
        expect(imageElementCount).toBe(0);
    });
});
