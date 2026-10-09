import { expect, test, type Locator, type Page } from '@playwright/test';
import type { CatalogSearchResultView } from '@kitchensink/food-service-client';
import type { RecipeDetail } from '@kitchensink/recipe-core';

import { signInWithTicket } from './utils/auth';
import { mockFoodApi, ownFoodLedger } from './utils/foodApi';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { editorTopChrome, openRecipeEditor } from './utils/recipeEditor';

/**
 * The food list and the row's name, measured where V3 measured them (`docs/design/v3Evaluation.md`, cases A to F;
 * `docs/design/rowEditorOpenDecisions.md` V3-1 to V3-4; `docs/design/ingredientStatusExplanation.md`, V3 amendment).
 *
 * jsdom has no layout, so every rule here is a geometry fact only a browser can show: the list against the editor's
 * header band and action bar, the side it opens on, its width at 320 px, its floor at 200% text, the keyboard
 * highlight's ring, and the name's line. Each case places the field where the rule decides something, then reads the
 * boxes. Locators are role and label only; the popup and the bar are reached from a located element inside
 * `evaluate`, because neither has a role of its own.
 *
 * REWRITTEN for slice 7: the wizard's header toolbar and its `Next` are gone. The band is now the one-page editor's
 * sticky header (`banner`), and the bar is the action bar around `Save changes` (the probe recipe is published). That
 * bar is `sticky` rather than `fixed`, so it counts as pinned while its foot is at the viewport's foot.
 */

/** A rectangle as `getBoundingClientRect` reports it. */
interface Box {
    readonly top: number;
    readonly bottom: number;
    readonly left: number;
    readonly right: number;
    readonly width: number;
    readonly height: number;
}

/** The boxes one measurement reads. */
interface Frame {
    readonly field: Box;
    readonly popup: Box;
    readonly band: Box;
    /**
     * The action bar while it is pinned to the viewport's foot; `undefined` once it sits at the end of the content
     * instead (`compactHeightLayout.md` A1).
     */
    readonly bar: Box | undefined;
    readonly viewportHeight: number;
}

/** Eight catalog foods for any text: a list taller than the 20rem the popup may take. */
const CATALOG = (): readonly CatalogSearchResultView[] =>
    Array.from({ length: 8 }, (_unused, index) => ({
        id: `food_geometry_${String(index)}`,
        name: `Pepper, variety ${String(index + 1)}`,
        score: 0.9 - index / 100,
    }));

/** A long catalog name, whose distinguishing words are at its end (`ingredientStatusExplanation.md` §3a). */
const LONG_NAME = 'Milk, reduced fat, fluid, 2% milkfat, with added vitamin A and vitamin D';

/**
 * Twelve resolved lines. The measured field is a middle row's in Change food, so the rows below it give the page room to
 * scroll that field to any height in the viewport (the trailing row is the document's last control, and cannot rise).
 */
const lines = (): RecipeDetail['ingredients'] =>
    Array.from({ length: 12 }, (_unused, index) => ({
        ingredientId: `6e000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        name: index === 0 ? LONG_NAME : `Pantry food ${String(index + 1)}`,
        foodId: `food_pantry_${String(index)}`,
        quantity: { kind: 'exact' as const, value: 1 },
        unit: 'cup',
        isUserEntered: false,
        resolutionStatus: 'RESOLVED' as const,
    }));

/** Open a saved recipe's editor, returning its Ingredients section, with the food double answering `options`. */
async function openIngredients(
    page: Page,
    options: Parameters<typeof mockFoodApi>[1] = { catalog: CATALOG },
): Promise<Locator> {
    await signInWithTicket(page);
    const viewerId = await readViewerAppId(page);
    const recipe = makeRecipeDetail({
        id: 'rec_geometry',
        ownerId: viewerId,
        title: 'Geometry probe',
        currentVersion: 1,
        ingredients: lines(),
    });

    await mockRecipeApi(page, { viewerId, tier: 'premium', recipes: [recipe] });
    await mockFoodApi(page, options);
    await openRecipeEditor(page, recipe.id);

    return page.getByRole('region', { name: 'Ingredients' });
}

/** The middle row, whose Change food field each placement case measures. */
const MIDDLE = 6;

/** Put the middle row in Change food and return its entry field. */
async function middleField(page: Page, ingredients: Locator): Promise<Locator> {
    await ingredients.getByRole('button', { name: `Actions for Pantry food ${String(MIDDLE)}` }).click();
    await page.getByRole('menuitem', { name: 'Change food' }).click();

    return ingredients.getByRole('combobox', { name: `Ingredient ${String(MIDDLE)} name` });
}

/** Scroll the page so the field's top edge sits at `top` CSS px from the viewport's top. */
async function placeFieldAt(field: Locator, top: number): Promise<void> {
    await field.evaluate((element, target) => {
        window.scrollBy(0, element.getBoundingClientRect().top - target);
    }, top);
    await expect.poll(async () => Math.round((await field.boundingBox())?.y ?? Number.NaN)).toBe(Math.round(top));
}

/** Read the field, its popup, the header band and the action bar, as the browser lays them out now. */
async function measure(page: Page, field: Locator): Promise<Frame> {
    const band = await editorTopChrome(page);
    const primary = page.getByRole('button', { name: 'Save changes' });
    const frame = await field.evaluate((element) => {
        const boxOf = (node: Element): Box => {
            const { top, bottom, left, right, width, height } = node.getBoundingClientRect();

            return { top, bottom, left, right, width, height };
        };

        // The popup is the fixed box floating-ui places, a child of the combobox's own root.
        const root = element.parentElement?.parentElement;
        const popup = Array.from(root?.children ?? []).find((child) => getComputedStyle(child).position === 'fixed');

        return {
            field: boxOf(element),
            popup: popup === undefined ? undefined : boxOf(popup),
            viewportHeight: document.documentElement.clientHeight,
        };
    });
    const bar = await primary.evaluate((element) => {
        let node: Element | null = element;

        while (node !== null && !['fixed', 'sticky'].includes(getComputedStyle(node).position)) {
            node = node.parentElement;
        }

        if (node === null) {
            return undefined;
        }

        const { top, bottom, left, right, width, height } = node.getBoundingClientRect();

        // Sticky, the bar is pinned only while held at the viewport's foot; anywhere else it sits after the content.
        return Math.abs(bottom - document.documentElement.clientHeight) <= 1
            ? { top, bottom, left, right, width, height }
            : undefined;
    });

    if (frame.popup === undefined) {
        throw new Error('The popup is not on the page.');
    }

    return {
        field: frame.field,
        popup: frame.popup,
        band: {
            top: band.y,
            bottom: band.y + band.height,
            left: band.x,
            right: band.x + band.width,
            width: band.width,
            height: band.height,
        },
        bar,
        viewportHeight: frame.viewportHeight,
    };
}

/** The page's own chrome is never under the popup (V3-1): it starts below the band and ends above the bar. */
function expectClearOfChrome(frame: Frame): void {
    expect(frame.popup.top, 'the popup covers the header band').toBeGreaterThanOrEqual(frame.band.bottom - 0.5);

    if (frame.bar !== undefined) {
        expect(frame.popup.bottom, 'the popup covers the action bar').toBeLessThanOrEqual(frame.bar.top + 0.5);
    }
}

/** Whether nothing is painted over the control's centre: `elementFromPoint` lands on it. */
async function isReachable(control: Locator): Promise<boolean> {
    return control.evaluate((element) => {
        const { left, top, width, height } = element.getBoundingClientRect();
        const hit = document.elementFromPoint(left + width / 2, top + height / 2);

        return hit !== null && (hit === element || element.contains(hit));
    });
}

/** Hold every answer to `url` until `release` is called; the route registered before this one then answers. */
async function hold(page: Page, url: string): Promise<{ readonly release: () => void }> {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });

    await page.route(url, async (intercepted) => {
        await gate;
        await intercepted.fallback();
    });

    return { release: () => release() };
}

const PROGRESSIVE = '**/api/v1/foods/search/progressive?**';

test.describe('the food list keeps clear of the editor’s chrome (V3-1, case B and C)', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('390 px: where the list would reach the action bar below, it opens above, and Save changes stays reachable', async ({
        page,
    }) => {
        const field = await middleField(page, await openIngredients(page));
        // Room below for the list's full 20rem if the bar is left out, and not with it: case B.
        await placeFieldAt(field, 844 - 320 - 12 - 44 - 10);

        await field.fill('pepper');
        await expect(page.getByRole('option', { name: 'Pepper, variety 8' })).toBeAttached();
        const frame = await measure(page, field);

        expectClearOfChrome(frame);
        expect(frame.popup.bottom, 'the popup covers its own field').toBeLessThanOrEqual(frame.field.top);
        expect(await isReachable(page.getByRole('button', { name: 'Save changes' }))).toBe(true);
    });

    test('390 px: the side is chosen at the list’s full height, so a list that grows never reaches the bar', async ({
        page,
    }) => {
        const field = await middleField(page, await openIngredients(page));
        const answer = await hold(page, PROGRESSIVE);
        // Room below for the loader alone, and not for the list: case C.
        await placeFieldAt(field, 844 - 62 - 200);

        await field.fill('pepper');
        // Only the loader shows while the answer is held.
        await expect(page.getByRole('listbox')).toHaveCount(0);
        const held = await measure(page, field);

        expect(held.popup.bottom, 'the loader opened below, on its own height').toBeLessThanOrEqual(held.field.top);

        answer.release();
        await expect(page.getByRole('option', { name: 'Pepper, variety 8' })).toBeAttached();
        const landed = await measure(page, field);

        expectClearOfChrome(landed);
        expect(landed.popup.bottom).toBeLessThanOrEqual(landed.field.top);
        // Above its field the popup took its full height at once, so arriving options never moved its top edge (P2).
        expect(landed.popup.top).toBeCloseTo(held.popup.top, 0);
    });
});

test.describe('the food list keeps clear of the header band at desktop width (V3-1)', () => {
    test.use({ viewport: { width: 1280, height: 640 } });

    test('1280 px: where above would reach into the band, the list opens on the side with more room', async ({
        page,
    }) => {
        const field = await middleField(page, await openIngredients(page));
        const band = await editorTopChrome(page);
        // Stuck to the top once the page scrolls, the band covers its own height. 20rem fits above only if the band is
        // left out: 320 + 12 <= top < 332 + band. REWRITTEN for slice 7: the band was the wizard's 116 px header and
        // rail; the editor's is its header alone at this width (the index is a sidebar), so the window is derived
        // from the band as measured, and so is the side with more room (the field is 44 px tall).
        const top = 332 + band.height / 2;
        const roomAbove = top - (band.y + band.height);
        const roomBelow = 640 - 44 - top;

        expect(band.height, 'the band leaves this case no window').toBeGreaterThan(0);
        await placeFieldAt(field, top);

        await field.fill('pepper');
        await expect(page.getByRole('option', { name: 'Pepper, variety 8' })).toBeAttached();
        const frame = await measure(page, field);

        expectClearOfChrome(frame);
        expect(frame.popup.top >= frame.field.bottom, 'the popup opened below, where there is more room').toBe(
            roomBelow > roomAbove,
        );
        expect(frame.popup.bottom <= frame.field.top + 0.5, 'the popup opened above, where there is more room').toBe(
            roomBelow <= roomAbove,
        );
        expect(frame.popup.bottom).toBeLessThanOrEqual(frame.viewportHeight - 8 + 0.5);
    });

    test('1280 px: the keyboard’s active option has a linen (surfaceMuted) fill and a seafoam ring (V3-4, case F)', async ({
        page,
    }) => {
        const field = await middleField(page, await openIngredients(page));

        await field.fill('pepper');
        await expect(page.getByRole('option', { name: 'Pepper, variety 8' })).toBeAttached();
        await field.press('ArrowDown');
        await field.press('ArrowDown');
        const active = page.getByRole('option', { name: 'Pepper, variety 2' });

        await expect(active).toHaveAttribute('aria-selected', 'true');
        const paint = await active.evaluate((element) => {
            const style = getComputedStyle(element);

            return { background: style.backgroundColor, ring: style.boxShadow };
        });

        // The `surfaceMuted` role: pearl became linen (#F3EEE6) in the owner's D11 warm greys.
        expect(paint.background).toBe('rgb(243, 238, 230)');
        expect(paint.ring).toContain('rgb(49, 128, 122)');
        expect(paint.ring).toContain('inset');
    });
});

test.describe('the food list at 320 px (V3-2, case E)', () => {
    test.use({ viewport: { width: 320, height: 640 } });

    test('320 px: the list takes 20rem less the margins, slides in from the right edge, and nothing scrolls sideways', async ({
        page,
    }) => {
        const field = await middleField(page, await openIngredients(page));

        await placeFieldAt(field, 120);
        await field.fill('pepper');
        await expect(page.getByRole('option', { name: 'Pepper, variety 8' })).toBeAttached();
        const frame = await measure(page, field);

        expect(frame.popup.left).toBeCloseTo(8, 0);
        expect(frame.popup.right).toBeCloseTo(320 - 8, 0);
        expect(
            await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
        ).toBeLessThanOrEqual(0);
    });

    test('320 px: a range and its unit share one line under the name, and nothing scrolls sideways', async ({
        page,
    }) => {
        const ingredients = await openIngredients(page);
        const low = await ingredients.getByLabel('Ingredient 1 quantity', { exact: true }).boundingBox();
        const high = await ingredients.getByLabel('Ingredient 1 maximum quantity').boundingBox();
        const unit = await ingredients.getByLabel('Ingredient 1 unit').boundingBox();

        expect(high?.y).toBeCloseTo(low?.y ?? Number.NaN, 0);
        expect(unit?.y).toBeCloseTo(low?.y ?? Number.NaN, 0);
        expect(
            await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
        ).toBeLessThanOrEqual(0);
    });
});

/**
 * Case D also needs the editor's action bar out of the way: the band and the bar together take more than half of 360,
 * so the bar unpins to the end of the content (`docs/design/compactHeightLayout.md` A1, §4) and the list gets the room.
 */
test.describe('the food list at 640 × 360 with 200% text (V3-3, case D; compactHeightLayout.md A1)', () => {
    test.use({ viewport: { width: 640, height: 360 } });

    /** The catalog's sentence (`ingredientCatalogUnavailable`). */
    const CATALOG_DOWN = 'The food catalog is unavailable right now, so only your foods were searched.';

    /**
     * Case D's list, open on `pepper` with the field just under the header band: the cook's two foods, the catalog
     * unavailable, and the cook's lookup limit.
     */
    async function openCaseD(page: Page): Promise<{ readonly field: Locator; readonly listbox: Locator }> {
        const ingredients = await openIngredients(page, {
            unavailable: ['catalog'],
            authored: ownFoodLedger([
                { id: 'food_own_1', name: 'pepper paste', score: 1 },
                { id: 'food_own_2', name: 'pepper jam', score: 1 },
            ]),
            sources: () => [{ source: 'usda', outcome: 'limited', retryAfterSeconds: 600 }],
        });
        await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
        const field = await middleField(page, ingredients);
        const band = await editorTopChrome(page);

        await placeFieldAt(field, band.y + band.height + 1);
        await field.fill('pepper');
        const listbox = page.getByRole('listbox');

        await expect(listbox.getByRole('option', { name: 'pepper jam' })).toBeAttached();

        return { field, listbox };
    }

    test('640 × 360 at 200%: the bar unpins, the foods lead the card, the card can bring a whole option row into view, the listbox keeps its floor, no line spills from the card, and the chrome stays clear', async ({
        page,
    }, testInfo) => {
        const { field, listbox } = await openCaseD(page);
        const frame = await measure(page, field);
        const floor = await listbox.evaluate((element) => ({
            height: element.getBoundingClientRect().height,
            // Up to three option rows, `min-h-11` each, in the page's own rem (V3-3).
            rows:
                Math.min(3, element.querySelectorAll('[role="option"]').length) *
                2.75 *
                Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
            cardScrolls: getComputedStyle(element.parentElement ?? element).overflowY,
        }));
        // At rest the card shows what leads the list first. Then the card scrolls to its first option, which must fit
        // whole: a 16 px card could never hold an 88 px row, wherever it scrolled.
        const rows = await listbox.evaluate((element) => {
            const card = element.parentElement ?? element;
            const first = element.querySelector('[role="option"]');
            const atRest = card.getBoundingClientRect();
            const options = Array.from(element.querySelectorAll('[role="option"]'), (option) =>
                option.getBoundingClientRect(),
            );
            const firstAtRest = first?.getBoundingClientRect();

            card.scrollTop += (firstAtRest?.top ?? 0) - atRest.top;
            const scrolled = first?.getBoundingClientRect();

            return {
                wholeAtRest: options.filter(
                    ({ top, bottom }) => top >= atRest.top - 0.5 && bottom <= atRest.bottom + 0.5,
                ).length,
                firstOffset: (firstAtRest?.top ?? Number.NaN) - atRest.top,
                firstHeight: firstAtRest?.height ?? Number.NaN,
                firstFits:
                    scrolled !== undefined &&
                    scrolled.top >= atRest.top - 0.5 &&
                    scrolled.bottom <= atRest.bottom + 0.5,
            };
        });

        testInfo.annotations.push({
            type: 'measured',
            description: `popup ${String(Math.round(frame.popup.height))} px tall; listbox ${String(Math.round(floor.height))} px; first option ${String(Math.round(rows.firstHeight))} px tall, ${String(Math.round(rows.firstOffset))} px down the card at rest; ${String(rows.wholeAtRest)} whole option rows at rest`,
        });
        expect(frame.bar, 'the action bar is still pinned to the foot').toBeUndefined();
        // V3-M2a: with the cook's foods to show, no line leads them. The first option starts inside the card at rest,
        // and the catalog's sentence is the first line after the listbox, before the limit's note.
        expect(rows.firstOffset, 'the first option starts above the card').toBeGreaterThanOrEqual(-0.5);
        expect(rows.firstOffset, 'the first option starts below the card').toBeLessThan(frame.popup.height);
        expect(await linesAroundListbox(listbox)).toEqual([
            { text: CATALOG_DOWN, afterListbox: true },
            { text: expect.stringMatching(/^You’ve reached your limit for food lookups/u), afterListbox: true },
        ]);
        expect(rows.firstFits, 'the card cannot bring a whole option row into view').toBe(true);
        expect(floor.height).toBeGreaterThanOrEqual(floor.rows - 0.5);
        expect(floor.cardScrolls).toBe('auto');
        expectClearOfChrome(frame);

        // Unpinned, the bar sits after the content, inside the page's padding: it still fits across, and Save changes
        // still takes a press.
        await field.press('Escape');
        await expect(listbox).toHaveCount(0);
        const publish = page.getByRole('button', { name: 'Save changes' });

        await publish.scrollIntoViewIfNeeded();
        const publishBox = await publish.boundingBox();

        expect(
            await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
            'the page scrolls sideways',
        ).toBeLessThanOrEqual(0);
        expect(
            (publishBox?.x ?? Number.NaN) + (publishBox?.width ?? Number.NaN),
            'Save changes hangs off the right edge',
        ).toBeLessThanOrEqual(640);
        expect(await isReachable(publish), 'something covers Save changes').toBe(true);
    });

    // V3-M2a's residual: the listbox (its floor) is taller than the card, so ArrowDown must scroll the card as well.
    test('640 × 360 at 200%: ArrowDown to the third option scrolls it whole into the card’s visible rect', async ({
        page,
    }) => {
        const { field, listbox } = await openCaseD(page);
        const options = listbox.getByRole('option');
        const third = options.nth(2);

        // The controls: the first option is already in view at rest, and the third is not, so the check below can fail.
        expect((await shownInCard(options.first())).topInside, 'the first option is out of view at rest').toBe(true);
        expect((await shownInCard(third)).whole, 'the third option is already whole in view at rest').toBe(false);

        await field.press('ArrowDown');
        await field.press('ArrowDown');
        await field.press('ArrowDown');

        await expect(third).toHaveAttribute('aria-selected', 'true');
        await expect
            .poll(async () => (await shownInCard(third)).whole, 'the active option is not whole in view')
            .toBe(true);
    });
});

/** The popup card's lines other than the listbox, in DOM order, and whether each follows the listbox (1.3.2). */
async function linesAroundListbox(
    listbox: Locator,
): Promise<readonly { readonly text: string; readonly afterListbox: boolean }[]> {
    return listbox.evaluate((element) =>
        Array.from(element.parentElement?.children ?? [])
            .filter((child) => child !== element)
            .map((child) => ({
                text: child.textContent ?? '',
                afterListbox: (element.compareDocumentPosition(child) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
            })),
    );
}

/**
 * Where an option sits in what the cook can see of the list: inside the listbox's box AND the card's, both scrollers.
 * `topInside`: its top edge shows; `whole`: its whole box shows.
 */
async function shownInCard(option: Locator): Promise<{ readonly topInside: boolean; readonly whole: boolean }> {
    return option.evaluate((element) => {
        const listbox = element.closest('[role="listbox"]');
        const card = listbox?.parentElement;

        if (listbox === null || card === null || card === undefined) {
            throw new Error('The option is not in a listbox inside the popup card.');
        }

        const list = listbox.getBoundingClientRect();
        const shown = card.getBoundingClientRect();
        const top = Math.max(list.top, shown.top);
        const bottom = Math.min(list.bottom, shown.bottom);
        const box = element.getBoundingClientRect();

        return {
            topInside: box.top >= top - 0.5 && box.top < bottom,
            whole: box.top >= top - 0.5 && box.bottom <= bottom + 0.5,
        };
    });
}

test.describe('the food name takes the row’s first full line (V3 amendment, case A)', () => {
    for (const viewport of [
        { width: 1280, height: 800 },
        { width: 390, height: 844 },
    ]) {
        test(`${String(viewport.width)} px: a record name fills its row’s width and wraps; Change food keeps that line`, async ({
            page,
        }) => {
            await page.setViewportSize(viewport);
            const ingredients = await openIngredients(page);
            const name = ingredients.getByRole('group', { name: 'Ingredient 1 name' });

            await expect(name).toHaveText(LONG_NAME);
            const record = await name.evaluate((element) => {
                const row = element.parentElement?.getBoundingClientRect();
                const own = element.getBoundingClientRect();
                const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight);

                return { width: own.width, rowWidth: row?.width ?? Number.NaN, height: own.height, lineHeight };
            });

            expect(record.width).toBeCloseTo(record.rowWidth, 0);

            if (viewport.width < 640) {
                // The 72-character name needs more than one line at a phone's width: it wraps rather than clips.
                expect(record.height).toBeGreaterThan(record.lineHeight * 1.5);
            }

            await ingredients.getByRole('button', { name: `Actions for ${LONG_NAME}` }).click();
            await page.getByRole('menuitem', { name: 'Change food' }).click();
            const entry = ingredients.getByRole('combobox', { name: 'Ingredient 1 name' });
            const cancel = ingredients.getByRole('button', { name: `Cancel, keep ${LONG_NAME}` });
            const entryBox = await entry.boundingBox();
            const cancelBox = await cancel.boundingBox();

            expect((entryBox?.width ?? 0) + (cancelBox?.width ?? 0) + 16).toBeGreaterThanOrEqual(record.rowWidth - 1);
        });
    }
});
