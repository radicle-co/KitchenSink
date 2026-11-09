import { expect, test, type Page } from '@playwright/test';
import type { RecipeIngredientView } from '@kitchensink/recipe-core';

import { signInWithTicket } from './utils/auth';
import { route } from './utils/basePath';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';

/**
 * Owner ruling R1 (`docs/design/uiRefreshWorkshop5/ownerFeedback.md`) and the phone gutter, on the real recipe page:
 * plan `docs/plans/2026-11-08-pinnedIngredientsBar.md`. Below a 720 px body, once the ingredients card has scrolled
 * away, ONE button pins under the top chrome; it opens the list over the content, with the servings stepper first.
 * From 720 the sticky column does that job and the bar never renders.
 *
 * Every measurement is taken in a real browser, because jsdom lays nothing out.
 */

const RECIPE_ID = 'ec000000-0000-4000-8000-0000000000b1';
const GUTTER = 16;

const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
);
const PHOTO_ORIGIN = 'https://photos.pinned.e2e.example';

const INGREDIENTS: readonly RecipeIngredientView[] = Array.from({ length: 13 }, (_, index) => ({
    ingredientId: `ec000000-0000-4000-8000-0000000001${String(index).padStart(2, '0')}`,
    name:
        index === 4
            ? 'extraordinarilylongingredientnamewithnobreakatallanywherehere'
            : `ingredient number ${String(index + 1)}`,
    ...(index < 5 ? { groupLabel: 'For the sauce' } : { groupLabel: 'To finish' }),
    foodId: `food_pinned_${String(index)}`,
    quantity: { kind: 'exact', value: index + 1 } as const,
    unit: 'g',
    isUserEntered: false,
}));

const STEPS = Array.from({ length: 14 }, (_, index) => ({
    stepNumber: index + 1,
    instruction:
        index === 2
            ? 'Step 3: aVeryLongUnbrokenInstructionTokenThatNeverBreaksAnywhereAtAllForRealThisTime'
            : `Step ${String(index + 1)}: keep stirring the pot gently until the sauce has thickened and shines.`,
}));

const BAR_GUTTER = 12;

/** Every pinned-bar button's gap to each window edge, and whether the page runs sideways. */
async function barGutters(page: Page): Promise<{
    sideways: boolean;
    bars: { label: string | null; left: number; right: number }[];
}> {
    return page.evaluate(() => {
        const client = document.documentElement.clientWidth;

        return {
            sideways: document.documentElement.scrollWidth !== client,
            bars: Array.from(document.querySelectorAll('button[aria-label$="list."]'))
                .filter((node) => node.getBoundingClientRect().width > 0)
                .map((node) => {
                    const box = node.getBoundingClientRect();

                    return { label: node.getAttribute('aria-label'), left: box.left, right: client - box.right };
                }),
        };
    });
}

function expectBarInGutters(gutters: Awaited<ReturnType<typeof barGutters>>): void {
    expect(gutters.sideways).toBe(false);
    expect(gutters.bars.length).toBeGreaterThan(0);
    expect(
        gutters.bars.filter((bar) => Math.abs(bar.left - BAR_GUTTER) > 0.5 || Math.abs(bar.right - BAR_GUTTER) > 0.5),
    ).toEqual([]);
}

async function openRecipe(page: Page): Promise<void> {
    await page.route(`${PHOTO_ORIGIN}/**`, (photo) => photo.fulfill({ contentType: 'image/png', body: PNG }));
    await signInWithTicket(page);
    const viewerId = await readViewerAppId(page);

    await mockRecipeApi(page, {
        viewerId,
        recipes: [
            makeRecipeDetail({
                id: RECIPE_ID,
                ownerId: viewerId,
                title: 'Slow Braised Short Ribs With Red Wine, Shallots And Thyme',
                sourceAttribution: 'https://example.com/aVeryLongUnbrokenAttributionTokenThatNeverBreaksAnywhereAtAll',
                servings: 4,
                description:
                    'A long description that runs over several lines so the page has real text to wrap, and a long unbroken token https://example.com/a/very/long/path/that/never/breaks/anywhere/at/all/for/real',
                tags: ['dinner', 'winter', 'make ahead', 'anUnbrokenTagThatIsMuchLongerThanAnyPhoneScreenCouldHold'],
                sourceUrl:
                    'https://example.com/recipes/a/very/long/path/that/never/breaks/anywhere/at/all/for/real/short-ribs',
                coverPhotoUrl: `${PHOTO_ORIGIN}/p0.png`,
                photos: [0, 1, 2].map((index) => ({
                    id: `pho_pinned_${String(index)}`,
                    recipeId: RECIPE_ID,
                    key: `recipes/${RECIPE_ID}/p${String(index)}.png`,
                    url: `${PHOTO_ORIGIN}/p${String(index)}.png`,
                    contentType: 'image/png',
                    order: index + 1,
                    createdAt: '2026-05-02T09:00:00.000Z',
                })),
                ingredients: [...INGREDIENTS],
                steps: STEPS,
            }),
        ],
    });
    await page.goto(route(`/recipes/${RECIPE_ID}`));
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

/** Scroll the Steps heading to the top of the page, so the ingredients card above it is wholly under the chrome. */
async function scrollIntoSteps(page: Page): Promise<void> {
    await page.getByRole('heading', { name: 'Steps' }).evaluate((heading) => {
        heading.scrollIntoView({ block: 'start' });
    });
}

for (const width of [430, 375]) {
    test.describe(`recipe page at ${String(width)} px`, () => {
        test.use({ viewport: { width, height: 800 } });

        test('the page does not overflow sideways, and every card keeps the same gap on both sides', async ({
            page,
        }) => {
            await openRecipe(page);

            const gaps = await page.evaluate(() => {
                const client = document.documentElement.clientWidth;

                // A box inside a clipping ancestor (the photo carousel's strip) is meant to run past the edge.
                const clipped = (node: Element): boolean => {
                    for (let up = node.parentElement; up !== null && up.tagName !== 'ARTICLE'; up = up.parentElement) {
                        if (getComputedStyle(up).overflowX !== 'visible') {
                            return true;
                        }
                    }

                    return false;
                };

                return Array.from(document.querySelectorAll('article *'))
                    .filter((node) => node.getBoundingClientRect().width > 2 && !clipped(node))
                    .map((node) => ({
                        name: `${node.tagName.toLowerCase()} ${node.className.toString().slice(0, 50)} ${node.textContent.slice(0, 20)}`,
                        right: client - node.getBoundingClientRect().right,
                    }));
            });

            expect(gaps.filter((gap) => gap.right < GUTTER - 0.5)).toEqual([]);

            // Every block the article is made of sits at the page gutter on BOTH sides (16 px below 600).
            const blocks = await page.evaluate(() => {
                const client = document.documentElement.clientWidth;

                return Array.from(document.querySelectorAll('article > *'))
                    .filter((node) => node.getBoundingClientRect().width > 2)
                    .map((node) => {
                        const box = node.getBoundingClientRect();

                        return { name: node.tagName.toLowerCase(), left: box.left, right: client - box.right };
                    });
            });

            expect(blocks.length).toBeGreaterThan(2);
            expect(
                blocks.filter((block) => Math.abs(block.left - GUTTER) > 0.5 || Math.abs(block.right - GUTTER) > 0.5),
            ).toEqual([]);

            const widths = await page.evaluate(() => ({
                scroll: document.documentElement.scrollWidth,
                client: document.documentElement.clientWidth,
            }));

            expect(widths.scroll).toBe(widths.client);
        });

        test('the pinned ingredients bar appears in the steps as one button, and the list opens and closes', async ({
            page,
        }) => {
            await openRecipe(page);
            const bar = page.getByRole('button', { name: /^Ingredients for 4, 13 items\. Show list\.$/u });

            await expect(bar).toBeHidden();
            await scrollIntoSteps(page);
            await expect(bar).toBeVisible();
            // The bar sits 12 px from both window edges, and the page does not run sideways.
            expectBarInGutters(await barGutters(page));
            await expect(bar).toHaveAttribute('aria-expanded', 'false');
            await expect(bar).toHaveAttribute('aria-haspopup', 'dialog');

            await bar.click();

            const panel = page.getByRole('dialog', { name: 'Ingredients for 4' });

            await expect(panel).toBeVisible();
            // Open: the trigger under the scrim and the close bar over it both keep the 12 px gutters.
            expectBarInGutters(await barGutters(page));
            // Inside the dialog the bar face is a plain close button: no expanded state, no popup claim.
            const hideBar = page.getByRole('button', { name: /Hide list\.$/u });

            await expect(hideBar).not.toHaveAttribute('aria-expanded');
            await expect(hideBar).not.toHaveAttribute('aria-haspopup');
            // The servings stepper is the first control in the panel, never in the bar.
            await expect(panel.getByRole('group', { name: 'Servings' })).toBeVisible();

            // The list is on TOP: what the window draws at the panel's centre is inside the panel, and what it draws at the
            // scrim's edge is the scrim, not the page (a stacking-context bug once left the steps painting over it).
            const hits = await page.evaluate(() => {
                const dialog = document.querySelector('[role="dialog"]');
                const hide = dialog?.querySelector('button');
                const box = dialog?.getBoundingClientRect();
                const hideBox = hide?.getBoundingClientRect();
                const centre =
                    box === undefined
                        ? null
                        : document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
                const barHit =
                    hideBox === undefined
                        ? null
                        : document.elementFromPoint(hideBox.left + hideBox.width / 2, hideBox.top + hideBox.height / 2);
                const edge = document.elementFromPoint(5, 400);

                return {
                    centreInPanel: centre !== null && dialog?.contains(centre) === true,
                    // The bar stays pressable ABOVE the scrim: what the window draws at its centre is the Hide button.
                    barIsHideButton: barHit !== null && hide?.contains(barHit) === true,
                    edgeIsScrim: edge?.classList.contains('bg-scrim') === true,
                };
            });

            expect(hits).toEqual({ centreInPanel: true, barIsHideButton: true, edgeIsScrim: true });

            // The page behind the open list does not scroll under a wheel.
            const openY = await page.evaluate(() => window.scrollY);

            await page.mouse.move(5, 400);
            await page.mouse.wheel(0, -200);
            await page.evaluate(
                () => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
            );
            expect(await page.evaluate(() => window.scrollY)).toBe(openY);

            // A tick in the panel is the card's tick.
            await panel.getByRole('checkbox', { name: /ingredient number 3/u }).check();
            await page.getByRole('button', { name: /Hide list\.$/u }).click();
            await expect(panel).toBeHidden();
            await expect(page.getByRole('button', { name: /1 ticked\. Show list\.$/u })).toBeVisible();

            // The scrim closes it: pressed in the 12 px beside the panel, clear of the bar and the tab bar.
            await page.getByRole('button', { name: /Show list\.$/u }).click();
            await expect(panel).toBeVisible();
            // Radix arms its outside-press listener a tick after the content mounts, and a scripted click can beat it on a
            // cold page: press again until the list closes, rather than assume the listener is ready.
            await expect(async () => {
                await page.mouse.click(5, 400);
                await expect(panel).toBeHidden({ timeout: 1000 });
            }).toPass({ timeout: 8000 });

            // Escape closes it, and focus goes back to the bar.
            await page.getByRole('button', { name: /Show list\.$/u }).click();
            await expect(panel).toBeVisible();
            await page.keyboard.press('Escape');
            await expect(panel).toBeHidden();
            await expect(page.getByRole('button', { name: /Show list\.$/u })).toBeFocused();
        });

        for (const scheme of ['light', 'dark'] as const) {
            test(`the open list paints on top of the scrim and the page, ${scheme}`, async ({ page }) => {
                await page.emulateMedia({ colorScheme: scheme });
                await openRecipe(page);
                await scrollIntoSteps(page);
                await page.getByRole('button', { name: /Show list\.$/u }).click();

                const panel = page.getByRole('dialog', { name: 'Ingredients for 4' });

                await expect(panel).toBeVisible();
                // Past the enter animation: the panel is drawn at full opacity before anything is measured.
                await panel.evaluate((node) =>
                    Promise.all(node.getAnimations({ subtree: true }).map((a) => a.finished)),
                );

                const seen = await page.evaluate(() => {
                    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
                    const list = dialog.lastElementChild as HTMLElement;
                    const box = list.getBoundingClientRect();
                    const at = (x: number, y: number): Element | null => document.elementFromPoint(x, y);
                    const probe = document.createElement('div');

                    probe.className = 'bg-paper';
                    document.body.append(probe);
                    const paper = getComputedStyle(probe).backgroundColor;

                    probe.remove();

                    return {
                        opacity: getComputedStyle(list).opacity,
                        centreInPanel: list.contains(at(box.left + box.width / 2, box.top + 40)),
                        stripIsScrim: at(5, 400)?.classList.contains('bg-scrim') === true,
                        rightStripIsScrim: at(window.innerWidth - 5, 300)?.classList.contains('bg-scrim') === true,
                        paper,
                        patch: { x: box.left + 30, y: box.top + 3 },
                    };
                });

                expect(seen).toMatchObject({
                    opacity: '1',
                    centreInPanel: true,
                    stripIsScrim: true,
                    rightStripIsScrim: true,
                });

                // The pixels say it too: a patch of blank panel is the paper surface, not the scrim over the page.
                const shot = await page.screenshot({ clip: { x: seen.patch.x, y: seen.patch.y, width: 4, height: 4 } });
                const pixel = await page.evaluate(async (base64) => {
                    const image = new Image();

                    image.src = `data:image/png;base64,${base64}`;
                    await image.decode();
                    const canvas = document.createElement('canvas');

                    canvas.width = 1;
                    canvas.height = 1;
                    const context = canvas.getContext('2d');

                    context?.drawImage(image, 0, 0, 1, 1, 0, 0, 1, 1);
                    const [red, green, blue] = context?.getImageData(0, 0, 1, 1).data ?? [];

                    return `rgb(${String(red)}, ${String(green)}, ${String(blue)})`;
                }, shot.toString('base64'));

                expect(pixel).toBe(seen.paper.replace(/^rgba?\((\d+), (\d+), (\d+).*$/u, 'rgb($1, $2, $3)'));
            });
        }

        test('a list left open is closed when the window grows to a 720 px body, and the page scrolls again', async ({
            page,
        }) => {
            await openRecipe(page);
            // The foot of the page: wide, the sticky card has run out of column and ends up above the window too.
            await page.evaluate(() => {
                window.scrollTo(0, document.documentElement.scrollHeight);
            });
            await page.getByRole('button', { name: /Show list\.$/u }).click();
            await expect(page.getByRole('dialog', { name: 'Ingredients for 4' })).toBeVisible();

            await page.setViewportSize({ width: 1280, height: 800 });

            // The observer reports the hidden marker one frame later, and the list closes then: poll, do not read once.
            await expect(page.getByRole('dialog', { name: 'Ingredients for 4' })).toBeHidden();

            // The page scrolls again: a wheel up from the foot moves the window (a scripted scrollBy would move it even under the lock).
            const before = await page.evaluate(() => window.scrollY);

            await page.mouse.move(200, 400);
            await page.mouse.wheel(0, -200);
            await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(before);
        });

        test('the bar is gone when the ingredients card is back in view', async ({ page }) => {
            await openRecipe(page);
            await scrollIntoSteps(page);
            await expect(page.getByRole('button', { name: /Show list\.$/u })).toBeVisible();

            await page.getByRole('heading', { name: 'Ingredients', level: 2 }).scrollIntoViewIfNeeded();
            await expect(page.getByRole('button', { name: /Show list\.$/u })).toBeHidden();
        });
    });
}

test.describe('recipe page at 1280 px', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('the bar never renders: the sticky column does its job', async ({ page }) => {
        await openRecipe(page);
        await scrollIntoSteps(page);

        await expect(page.getByRole('button', { name: /Show list\.$/u })).toHaveCount(0);
    });
});
