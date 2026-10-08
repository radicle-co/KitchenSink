import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { containerClassOf } from '@commise/ui/container-class';

import { route } from './utils/basePath';
import { mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * `<main>` is the `main` size container, and its content box is the width the spec's container table promises
 * (`docs/design/uiOverhaul/buildSpec.md` §1.2; blueprint slice 1, step 8).
 *
 * ## Why a real engine
 *
 * Content queries `<main>`'s CONTENT box (`@regular/main:`, `@wide/main:`), so the gutters must be padding on `<main>`
 * and must step at the right widths. jsdom computes no layout and runs no Tailwind, so `HomeChrome.test.tsx` can only
 * check the class strings; whether `medium:` really means 600 px and `nav:` 840 px, and whether the sidebar leaves the
 * width the table says, is a question only the real stylesheet in a real engine can answer.
 *
 * ## What each row is
 *
 * The §1.2 capture widths, plus 600 and 767 — the edges of the medium gutter step, which Tailwind's own `md` (768)
 * would have missed. Slice 1 moves no shell: the sidebar still arrives at `lg` (1024), and slice 3 moves it to `nav`
 * (840). Between 840 and 1023 the tab bar therefore shows with 32 px gutters until then, and no row sits in that band.
 * At 1920 `<main>` is 1600 px wide; the 1440 px `page` cap belongs to the content inside it, which no slice-1 surface
 * adopts yet.
 *
 * Mutation lens: revert the gutters to `md:px-6` and the 600 and 767 rows fail; drop `@container/main` and every row's
 * container assertions fail; give the content widths the spec's `content-wide` name and nothing here moves, which is
 * why `tests/__integration__/tailwindTheme.integration.test.ts` owns that one.
 *
 * Selectors are role/label only (repo policy); no `data-testid`, no `waitForTimeout`.
 */

/** Sub-pixel slack for fractional layout; far smaller than the 16 px a wrong gutter would cost. */
const SLACK_PX = 1;

/** One row of the §1.2 table, as this slice's shell lays it out. */
interface Row {
    readonly viewport: number;
    readonly content: number;
    readonly containerClass: 'narrow' | 'regular' | 'wide';
}

const ROWS: readonly Row[] = [
    { viewport: 320, content: 288, containerClass: 'narrow' },
    { viewport: 390, content: 358, containerClass: 'narrow' },
    { viewport: 600, content: 552, containerClass: 'narrow' },
    { viewport: 767, content: 719, containerClass: 'regular' },
    { viewport: 768, content: 720, containerClass: 'regular' },
    { viewport: 1024, content: 704, containerClass: 'regular' },
    { viewport: 1280, content: 960, containerClass: 'wide' },
    { viewport: 1920, content: 1600, containerClass: 'wide' },
];

/** What a real engine says about `<main>`: its container declaration and its content-box width. */
interface MainBox {
    readonly containerType: string;
    readonly containerName: string;
    readonly contentWidth: number;
}

/**
 * Measure `<main>`'s content box.
 *
 * @sideEffect Reads layout from the page.
 */
async function measureMain(page: Page): Promise<MainBox> {
    return page.getByRole('main').evaluate((main) => {
        const style = getComputedStyle(main);

        return {
            containerType: style.containerType,
            containerName: style.containerName,
            contentWidth:
                main.getBoundingClientRect().width -
                Number.parseFloat(style.paddingLeft) -
                Number.parseFloat(style.paddingRight),
        };
    });
}

/** Sign in and land on a Home whose widgets read from an intercepted (empty) recipe API. */
async function landOnHome(page: Page): Promise<void> {
    await signInWithTicket(page);
    const viewerId = await readViewerAppId(page);
    await mockRecipeApi(page, { viewerId, tier: 'free', recipes: [] });
    await page.goto(route('/'));
    await expect(page.getByRole('region', { name: 'Home' })).toBeVisible();
}

for (const row of ROWS) {
    test.describe(`<main> as a container — ${row.viewport} px`, () => {
        test.use({ viewport: { width: row.viewport, height: 900 } });

        test(`gives content ${row.content} px, the ${row.containerClass} class`, async ({ page }) => {
            await landOnHome(page);
            const main = await measureMain(page);

            expect(main.containerType).toBe('inline-size');
            expect(main.containerName).toBe('main');
            expect(Math.abs(main.contentWidth - row.content), `content width ${main.contentWidth}`).toBeLessThanOrEqual(
                SLACK_PX,
            );
            expect(containerClassOf(main.contentWidth)).toBe(row.containerClass);
        });
    });
}
