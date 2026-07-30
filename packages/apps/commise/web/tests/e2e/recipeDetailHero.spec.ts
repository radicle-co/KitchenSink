import { expect, test } from '@playwright/test';

import { route } from './utils/basePath';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * Recipe-detail HERO cover (mockup `screen-recipe-detail`), driven through the real web UI with the
 * recipe/identity HTTP contract intercepted (`utils/recipeApi`). The mockup opens the screen with the cover
 * photo before any type; the web detail used to start at the gradient title band.
 *
 * Two things only the real browser can settle, and both are asserted as INTENT rather than as "something is
 * on screen":
 *
 *  1. **With a cover** — the hero is an `img` accessibly named by the recipe title, it actually DECODED (a
 *     non-zero `naturalWidth`, so a wrong/never-fetched `src` cannot pass), and it is laid out ABOVE the `h1`
 *     (its box ends before the heading's begins). Ordering is a layout fact, not a DOM-order fact: a
 *     `flex-col-reverse`/`order-*` regression would keep the DOM order and still put the cover under the
 *     title, and only a geometric assertion catches that.
 *  2. **Without a cover** — the deliberate labelled fallback is visible, the `h1` still renders, and there is
 *     NO `<img>` element anywhere in the detail article. That last one is the actual design rule: an `<img>`
 *     with an empty/undefined `src` paints the browser's broken-image glyph, so the no-cover state renders a
 *     labelled `role="img"` surface instead of an image. Asserting merely "the placeholder is visible" would
 *     pass even if a broken `<img>` were sitting right next to it.
 *
 * Selectors are role/label only (repo policy); no `data-testid`, no `waitForTimeout`.
 */

/** A real 1x1 PNG as a `data:` URI — the cover must genuinely decode, and nothing may hit the network. */
const COVER_DATA_URI =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

/** The localized copy the no-cover fallback carries — the SAME dictionary string the card placeholder uses. */
const NO_PHOTO_LABEL = 'No photo yet';

test.describe('recipe-detail hero cover', () => {
    test('a recipe WITH a cover leads with the cover image, above the title', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            tier: 'premium',
            recipes: [
                makeRecipeDetail({
                    id: 'rec_hero',
                    ownerId: viewerId,
                    title: 'Blistered Shishito Peppers',
                    coverPhotoUrl: COVER_DATA_URI,
                }),
            ],
        });

        await page.goto(route('/recipes/rec_hero'));

        const heading = page.getByRole('heading', { level: 1, name: 'Blistered Shishito Peppers' });
        await expect(heading).toBeVisible();

        // The hero is a real image named by the recipe (its alt text), not a decorative div.
        const cover = page.getByRole('img', { name: 'Blistered Shishito Peppers' });
        await expect(cover).toBeVisible();

        // …and it DECODED. `naturalWidth` is 0 for an image that failed to load, so this rejects a hero
        // wired to the wrong field (or to nothing) even though the element and its alt text would exist.
        await expect
            .poll(() => cover.evaluate((element) => (element instanceof HTMLImageElement ? element.naturalWidth : 0)))
            .toBeGreaterThan(0);

        // Layout order: the cover's box ends at or before the title's begins — the cover LEADS the screen.
        const coverBox = await cover.boundingBox();
        const headingBox = await heading.boundingBox();
        expect(coverBox).not.toBeNull();
        expect(headingBox).not.toBeNull();
        expect((coverBox?.y ?? 0) + (coverBox?.height ?? 0)).toBeLessThanOrEqual(headingBox?.y ?? 0);

        // A recipe WITH a cover must never also show the no-cover fallback.
        await expect(page.getByRole('img', { name: NO_PHOTO_LABEL })).toHaveCount(0);
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
