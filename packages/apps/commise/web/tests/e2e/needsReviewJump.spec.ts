import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

import { route } from './utils/basePath';
import { signInWithTicket } from './utils/auth';
import { INLINE_EDITOR_VIEWPORT, ingredientOpen } from './utils/recipeEditor';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';

/**
 * The "Needs review" jump, through the real web app with the recipe-service contract intercepted: on the owner's recipe
 * detail a doubtful line carries a "Needs review: {food}" link to the editor, which opens with THAT line's row editor
 * already open (a bottom sheet in a phone-width container, inline from 600), headed by the Needs review badge, the
 * cook's own words ("You wrote") and "Counted as". Cancel restores the fields as they were at open; Done keeps edits.
 * A viewer who does not own the recipe sees the plain badge and no link.
 *
 * What only this tier proves: the link's address survives a real navigation, the editor resolves it against the
 * server read's own line keys, and the frame the row editor opens in is the right one at each width. The per-state rules
 * are pinned by the component tests (`RecipeEditorSurface.rowEditor.test.tsx`, `cookRows.test.tsx`). Selectors are
 * role, label and text only.
 */
const RECIPE_ID = 'ec000000-0000-4000-8000-000000000a01';
const SOMEONE_ELSES_ID = 'ec000000-0000-4000-8000-000000000a02';
const VERSION = 3;
const SOURCE_LINE = '2 tsp smoked paprika, or to taste';
const FIRST_SOURCE_LINE = '1 tsp fine salt';

/**
 * Line 0: healthy, so a surface that ignored the address and opened the FIRST row would show this line's text. Its food
 * differs from the doubted line's for the same reason.
 */
const healthyLine = {
    ingredientId: '77777777-7777-4777-8777-777777777770',
    name: 'salt',
    quantity: { kind: 'exact', value: 1 },
    unit: 'tsp',
    isUserEntered: false,
    sourceLine: FIRST_SOURCE_LINE,
} as const;

/** Line 1 (the SECOND line): the one the gate doubted. Its address is `#ingredients/{VERSION}.1`. */
const doubtedLine = {
    ingredientId: '77777777-7777-4777-8777-777777777771',
    name: 'paprika',
    quantity: { kind: 'exact', value: 2 },
    unit: 'tsp',
    isUserEntered: false,
    resolutionStatus: 'NEEDS_REVIEW',
    sourceLine: SOURCE_LINE,
} as const;
const DOUBTED_POSITION = 1;

/** A recipe line as the mock serves it. */
type Ingredient = typeof healthyLine | typeof doubtedLine | typeof longestDoubtedLine;

/**
 * The doubted line with the longest content its editor can hold: a range (two Amount fields), a note and a preparation,
 * and a long "You wrote" line. It is the editor at its tallest, for the edge of the inline rule.
 */
const longestDoubtedLine = {
    ...doubtedLine,
    quantity: { kind: 'range', low: 2, high: 3 },
    note: 'the smoked kind, not the sweet, from the new jar that was opened last week',
    preparation: 'toasted in a dry pan until fragrant, then ground fine',
    sourceLine:
        '2 to 3 tsp smoked paprika (the Spanish kind, pimentón de la Vera, not the sweet one), toasted in a dry pan until fragrant and then ground fine, or to taste, plus more for the top',
} as const;
const LINK_NAME = 'Needs review: paprika';

/** The recipe the owner opens: a healthy line, then the doubted one. */
const ownerRecipe = (viewerId: string, ingredients: readonly Ingredient[]) =>
    makeRecipeDetail({
        id: RECIPE_ID,
        ownerId: viewerId,
        title: 'Jump Probe',
        currentVersion: VERSION,
        ingredients: [...ingredients],
    });

/** Where the row editor opens at each width: the sheet on a phone, inline in the row from 600 in a window tall enough. */
const FRAMES = [
    { name: 'phone (sheet)', viewport: { width: 390, height: 844 }, dialogs: 1 },
    { name: 'desktop (inline)', viewport: INLINE_EDITOR_VIEWPORT, dialogs: 0 },
] as const;

/**
 * The open row editor, in the frame the width calls for. ⛔ Not "whichever exists": a surface that opened the wrong frame
 * must fail here, so the sheet is `dialog` (exactly one at a phone width, none inline) and the inline panel lives in the
 * Ingredients section.
 */
async function openEditor(page: Page, dialogs: 0 | 1): Promise<Locator> {
    await expect(page.getByLabel('Amount', { exact: true })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(dialogs);

    return dialogs === 1 ? page.getByRole('dialog') : page.getByRole('region', { name: 'Ingredients' });
}

/** Sign in, mock the API with the owner's two-line recipe, and open its detail. */
async function openDetail(page: Page, ingredients: readonly Ingredient[] = [healthyLine, doubtedLine]): Promise<void> {
    await signInWithTicket(page);
    const viewerId = await readViewerAppId(page);
    await mockRecipeApi(page, { viewerId, recipes: [ownerRecipe(viewerId, ingredients)] });
    await page.goto(route(`/recipes/${RECIPE_ID}`));
    await expect(page.getByRole('heading', { name: 'Jump Probe' })).toBeVisible();
}

/** The notice that heads a doubted line's editor: its heading, why, and the cook's own words. */
const reviewNotice = (editor: Locator): Locator => editor.getByRole('group', { name: 'Needs review', exact: true });

for (const frame of FRAMES) {
    test.describe(`the Needs review jump — ${frame.name}`, () => {
        test.use({ viewport: frame.viewport });

        test('the link opens the addressed line’s editor; Cancel restores it and Done keeps edits', async ({
            page,
        }) => {
            await openDetail(page);

            // The address is the SECOND line's version and position, read at the version the detail was served at.
            const link = page.getByRole('link', { name: LINK_NAME });
            await expect(link).toHaveAttribute(
                'href',
                new RegExp(`/recipes/${RECIPE_ID}/edit#ingredients/${VERSION}\\.${DOUBTED_POSITION}$`, 'u'),
            );
            await link.click();

            await expect(page).toHaveURL(new RegExp(`/recipes/${RECIPE_ID}/edit`, 'u'));
            let editor = await openEditor(page, frame.dialogs);
            const notice = reviewNotice(editor);
            await expect(notice).toBeVisible();
            await expect(notice).toContainText('You wrote');
            // The second line's words, and not the first row's: a surface that ignored the address would show salt's.
            await expect(notice).toContainText(SOURCE_LINE);
            await expect(editor).not.toContainText(FIRST_SOURCE_LINE);
            await expect(editor.getByLabel('Amount', { exact: true })).toHaveValue('2');
            await expect(editor).toContainText('Counted as');
            await expect(editor.getByRole('button', { name: 'Change', exact: true })).toBeVisible();

            // Cancel puts the fields back as they were at open.
            await editor.getByLabel('Amount', { exact: true }).fill('5');
            await expect(editor.getByLabel('Amount', { exact: true })).toHaveValue('5');
            await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
            await expect(page.getByLabel('Amount', { exact: true })).toHaveCount(0);
            await expect(ingredientOpen(page, 'paprika')).toHaveAccessibleName(/^Edit 2 tsp paprika/u);

            await ingredientOpen(page, 'paprika').click();
            editor = await openEditor(page, frame.dialogs);
            await expect(editor.getByLabel('Amount', { exact: true })).toHaveValue('2');

            // Done keeps them.
            await editor.getByLabel('Amount', { exact: true }).fill('7');
            await editor.getByRole('button', { name: 'Done', exact: true }).click();
            await expect(page.getByLabel('Amount', { exact: true })).toHaveCount(0);
            await expect(ingredientOpen(page, 'paprika')).toHaveAccessibleName(/^Edit 7 tsp paprika/u);

            await ingredientOpen(page, 'paprika').click();
            editor = await openEditor(page, frame.dialogs);
            await expect(editor.getByLabel('Amount', { exact: true })).toHaveValue('7');
        });
    });
}

/**
 * Browser Back from an open row editor must never lose what the cook typed (UI Designer, #196): the page may close, but
 * the edit survives as the device draft (ADR-0057) and is there when the cook opens the editor again.
 */
test.describe('browser Back from the open row editor', () => {
    test.use({ viewport: INLINE_EDITOR_VIEWPORT });

    test('keeps the typed amount for the next visit to the editor', async ({ page }) => {
        await openDetail(page);
        await page.getByRole('link', { name: LINK_NAME }).click();
        const editor = await openEditor(page, 0);
        await editor.getByLabel('Amount', { exact: true }).fill('9');
        await expect(editor.getByLabel('Amount', { exact: true })).toHaveValue('9');

        await page.goBack();
        await expect(page.getByRole('heading', { name: 'Jump Probe' })).toBeVisible();

        // A fresh load of the editor, not Forward: the browser's page cache could hand back the old page with its memory,
        // which would prove nothing about the draft.
        await page.goto(route(`/recipes/${RECIPE_ID}/edit`));
        await expect(page.getByRole('heading', { level: 1, name: 'Edit recipe' })).toBeVisible();
        await expect(ingredientOpen(page, 'paprika')).toHaveAccessibleName(/^Edit 9 tsp paprika/u);
    });
});

test.describe('the Needs review badge for a viewer who does not own the recipe', () => {
    test('shows the plain badge and no link to the editor', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            recipes: [
                makeRecipeDetail({
                    id: SOMEONE_ELSES_ID,
                    ownerId: 'usr_someone_else',
                    title: 'Someone Else’s Jump Probe',
                    visibility: 'public',
                    ingredients: [doubtedLine],
                }),
            ],
        });

        await page.goto(route(`/recipes/${SOMEONE_ELSES_ID}`));
        await expect(page.getByRole('heading', { name: 'Someone Else’s Jump Probe' })).toBeVisible();
        // The positive control beside the negative: the badge is there, the link is not.
        await expect(page.getByRole('main')).toContainText('Needs review');
        await expect(page.getByRole('link', { name: /^Needs review/u })).toHaveCount(0);
    });
});

test.describe('the Needs review control as one accessible element', () => {
    test.use({ viewport: { width: 1280, height: 900 } });

    test('the pill and its chevron are one link with one full name and one focus stop', async ({ page }) => {
        await openDetail(page);
        const link = page.getByRole('link', { name: LINK_NAME });

        await expect(link).toHaveCount(1);
        await expect(link).toHaveAccessibleName(LINK_NAME);
        // Nothing inside it is a second stop or a second named element: the chevron is decorative.
        expect(await link.evaluate((el) => el.querySelectorAll('a, button, [tabindex], [role="img"]').length)).toBe(0);

        // One Tab onto it, the next leaves it.
        await link.focus();
        await page.keyboard.press('Shift+Tab');
        await page.keyboard.press('Tab');
        await expect(link).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(link).not.toBeFocused();
        expect(await link.evaluate((el) => el.contains(document.activeElement))).toBe(false);
    });
});

test.describe('an address that no longer names a line', () => {
    test.use({ viewport: { width: 1280, height: 900 } });

    test('the editor says it could not find the ingredient and the hash falls back to the section', async ({
        page,
    }) => {
        await openDetail(page);

        // A position the recipe does not hold (the line was removed), and a version that moved on, in turn.
        for (const stale of [`${VERSION}.9`, `${VERSION - 1}.${DOUBTED_POSITION}`]) {
            // A navigation that changes only the hash is not a new page load, and the jump runs once on mount: leave first.
            await page.goto('about:blank');
            await page.goto(route(`/recipes/${RECIPE_ID}/edit#ingredients/${stale}`));
            await expect(page.getByRole('heading', { level: 1, name: 'Edit recipe' })).toBeVisible();

            // The notice is a polite status region (the page holds several), found by its role and its words.
            await expect(
                page.getByRole('status').filter({ hasText: 'We couldn’t find that ingredient.' }),
            ).toBeVisible();
            await expect(page.getByLabel('Amount', { exact: true })).toHaveCount(0);
            await expect(page).toHaveURL(/#ingredients$/u);
        }
    });
});

/** The two controls the row editor owes the cook after a jump. */
const EDITOR_ACTIONS = ['Done', 'Cancel'] as const;

/** One animation frame, then another: what a scroll in flight has moved by in between is read from the page itself. */
const afterTwoFrames = (page: Page): Promise<void> =>
    page.evaluate(
        () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    );

/**
 * What is wrong with where Done and Cancel are, right now: empty when each is drawn inside the viewport, below the sticky
 * header and above the bottom action bar, and the page has stopped scrolling. The sticky header is a plain <header> (no
 * banner role inside <main>): it is reached through its Close control.
 */
async function reachViolations(
    page: Page,
    editor: Locator,
    viewport: { readonly width: number; readonly height: number } | null,
): Promise<string[]> {
    const before = await page.evaluate(() => window.scrollY);
    await afterTwoFrames(page);
    const after = await page.evaluate(() => window.scrollY);
    const headerBottom = await page
        .getByRole('button', { name: 'Close editor' })
        .evaluate((el) => el.closest('header')?.getBoundingClientRect().bottom ?? Number.NaN);
    const bar = await page.getByRole('group', { name: 'Recipe actions' }).boundingBox();

    if (viewport === null || bar === null || Number.isNaN(headerBottom)) {
        return ['the viewport, the action bar or the header is not there'];
    }

    const found: string[] = before === after ? [] : ['the page is still scrolling'];

    for (const name of EDITOR_ACTIONS) {
        const box = await editor.getByRole('button', { name, exact: true }).boundingBox();

        if (box === null) {
            found.push(`${name} is not drawn`);
            continue;
        }

        if (box.y < headerBottom) {
            found.push(`${name} is under the header`);
        }

        if (box.y + box.height > bar.y) {
            found.push(`${name} is under the action bar`);
        }

        if (box.y + box.height > viewport.height || box.x < 0 || box.x + box.width > viewport.width) {
            found.push(`${name} is outside the viewport`);
        }
    }

    return found;
}

/**
 * What is wrong with where the reason sits, right now: empty when the whole notice is drawn below the sticky header and
 * above the bottom action bar. `toBeInViewport` alone passes on a sliver, so it cannot say the cook can read the reason.
 */
async function noticeViolations(page: Page, notice: Locator): Promise<string[]> {
    const headerBottom = await page
        .getByRole('button', { name: 'Close editor' })
        .evaluate((el) => el.closest('header')?.getBoundingClientRect().bottom ?? Number.NaN);
    const bar = await page.getByRole('group', { name: 'Recipe actions' }).boundingBox();
    const box = await notice.boundingBox();

    if (box === null || bar === null || Number.isNaN(headerBottom)) {
        return ['the notice, the action bar or the header is not there'];
    }

    const found: string[] = [];

    if (box.y < headerBottom) {
        found.push('the notice is under the header');
    }

    if (box.y + box.height > bar.y) {
        found.push('the notice is under the action bar');
    }

    return found;
}

/**
 * A cook's larger text, in force from the first paint as a browser text-size setting is. An init script runs before
 * <html> exists, and hydration rewrites its attributes, so the size is applied as soon as <html> appears and again
 * whenever a style attribute changes, with `important` over any stylesheet.
 */
async function applyTextScale(page: Page, scale: number): Promise<void> {
    await page.addInitScript((factor) => {
        const apply = (): void => {
            document.documentElement?.style.setProperty('font-size', `${String(factor * 100)}%`, 'important');
        };

        apply();
        new MutationObserver(apply).observe(document, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['style'],
        });
    }, scale);
}

/** The text size is really in force before anything is measured: a case that ran at 100% proved nothing. */
async function expectRootFontSize(page: Page, scale: number): Promise<void> {
    await expect
        .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).fontSize))
        .toBe(`${String(16 * scale)}px`);
}

/**
 * After the jump the row editor's Done and Cancel must be reachable: fully inside the viewport, below the sticky header
 * and above the bottom action bar. This is the scroll contract the editor owes an arrival at a line when the editor is
 * INLINE, which it is only while the window has room for it (`inlineEditorFit.ts`): the row's top under the header, or,
 * when the row and its editor do not fit, Done and Cancel above the bar.
 */
for (const width of [1280, 1024, 768]) {
    test.describe(`after the jump at ${width} px, text at 100%`, () => {
        test.use({ viewport: { width, height: 800 } });

        test('Done and Cancel sit between the sticky header and the bottom action bar', async ({ page }) => {
            await applyTextScale(page, 1);
            await openDetail(page);
            await page.getByRole('link', { name: LINK_NAME }).click();
            const editor = await openEditor(page, 0);
            const viewport = page.viewportSize();

            expect(viewport).not.toBeNull();
            await expectRootFontSize(page, 1);

            // The jump's scroll is smooth and still moving when the page first settles, so the boxes are read until they
            // agree with the contract and have stopped moving, never once at the first moment they exist.
            await expect
                .poll(async () => reachViolations(page, editor, viewport), {
                    message: 'Done and Cancel are reachable once the jump has settled',
                })
                .toEqual([]);
        });
    });
}

/**
 * At 200% text the inline editor does not fit between the header and the action bar, so a link opens the SAME editor as
 * the sheet, whose Done and Cancel are pinned: the reason ("Needs review") shows at its top, and Done and Cancel stay in
 * view while a field has focus. Closing it by Done returns focus to the edited row's open control.
 */
for (const [width, pinned] of [
    [1280, true],
    [1024, true],
    // Here the footer is `unpinned`: at this text size the title row and the actions take more than half of the sheet,
    // and the sheet's own rule (`isFooterUnpinned`, owner ruling "unpin past a limit") lets the actions scroll with the
    // content. The exit (the title row's Close) stays pinned, and Done and Cancel are reached by scrolling the sheet.
    [768, false],
] as const) {
    test.describe(`the jump at ${width} px, text at 200%`, () => {
        // 800 px is 25 rem at 200% text: far under the inline threshold, so the sheet is meant.
        test.use({ viewport: { width, height: 800 } });

        test(`opens as the sheet, with the reason on top and Done and Cancel ${pinned ? 'in view' : 'a scroll away'} while Amount has focus`, async ({
            page,
        }) => {
            await applyTextScale(page, 2);
            await openDetail(page);
            await page.getByRole('link', { name: LINK_NAME }).click();
            const sheet = await openEditor(page, 1);

            await expectRootFontSize(page, 2);

            const notice = reviewNotice(sheet);
            const amount = sheet.getByLabel('Amount', { exact: true });
            const done = sheet.getByRole('button', { name: 'Done', exact: true });
            const cancel = sheet.getByRole('button', { name: 'Cancel', exact: true });

            await expect(notice).toBeVisible();
            await expect(notice).toBeInViewport();
            await amount.focus();
            await expect(amount).toBeFocused();

            if (pinned) {
                await expect(done).toBeInViewport();
                await expect(cancel).toBeInViewport();
            } else {
                await done.scrollIntoViewIfNeeded();
                await expect(done).toBeInViewport();
                await expect(cancel).toBeInViewport();
            }
        });

        test('Done returns focus to the edited row’s open control', async ({ page }) => {
            await applyTextScale(page, 2);
            await openDetail(page);
            await page.getByRole('link', { name: LINK_NAME }).click();
            const sheet = await openEditor(page, 1);

            await sheet.getByRole('button', { name: 'Done', exact: true }).click();

            await expect(page.getByRole('dialog')).toHaveCount(0);
            await expect(page.getByRole('button', { name: /^Edit .*paprika/u })).toBeFocused();
        });
    });
}

test.describe('the jump on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('Done returns focus to the edited row’s open control', async ({ page }) => {
        await openDetail(page);
        await page.getByRole('link', { name: LINK_NAME }).click();
        const sheet = await openEditor(page, 1);

        await sheet.getByRole('button', { name: 'Done', exact: true }).click();

        await expect(page.getByRole('dialog')).toHaveCount(0);
        await expect(page.getByRole('button', { name: /^Edit .*paprika/u })).toBeFocused();
    });
});

/**
 * The jump flow raises no console error, warning or page error of its own. Dev builds show a "N issues" badge for these, and
 * a hydration mismatch or a key warning from the editor would be one. Known third-party notices are named, not skipped by
 * type.
 */
const KNOWN_NOTICES: readonly RegExp[] = [
    /Clerk has been loaded with development keys/u,
    /was detected as the Largest Contentful Paint/u,
    // The browser's own line for a failed fetch names no URL: the failed responses below are judged by URL instead.
    /^Failed to load resource/u,
];

/**
 * Requests this suite's API mock does not answer, so the dev server answers 404: the connectivity probe and the food
 * sources list, which the page asks for whatever it opens. They are the environment's, not the jump's.
 */
const UNMOCKED_REQUESTS: readonly RegExp[] = [/\/en\/health$/u, /\/api\/v1\/foods\/sources$/u];

for (const frame of FRAMES) {
    test.describe(`the jump flow logs no errors — ${frame.name}`, () => {
        test.use({ viewport: frame.viewport });

        test('from the recipe page to Cancel', async ({ page }) => {
            const logged: string[] = [];

            page.on('console', (message) => {
                if (
                    ['error', 'warning'].includes(message.type()) &&
                    !KNOWN_NOTICES.some((known) => known.test(message.text()))
                ) {
                    logged.push(`${message.type()}: ${message.text()}`);
                }
            });
            page.on('pageerror', (error) => logged.push(`pageerror: ${error.message}`));
            page.on('response', (response) => {
                if (response.status() >= 400 && !UNMOCKED_REQUESTS.some((known) => known.test(response.url()))) {
                    logged.push(`${String(response.status())} ${response.url()}`);
                }
            });

            await openDetail(page);
            // Only the flow under test is judged: whatever the pages before it logged is not this feature's.
            logged.length = 0;
            await page.getByRole('link', { name: LINK_NAME }).click();
            const editor = await openEditor(page, frame.dialogs);
            await editor.getByRole('button', { name: 'Cancel', exact: true }).click();

            expect(logged).toEqual([]);
        });
    });
}

/**
 * The edges of the inline rule (`inlineEditorFit.ts`), with the editor at its tallest: the window must be 43 rem high AND
 * the editor's container 43 rem wide. At both limits the editor is inline, with its reason ("Needs review") fully between
 * the sticky header and the action bar and Done and Cancel in view. One rem under either limit it is the sheet.
 */
// Mirror INLINE_EDITOR_MIN_VIEWPORT_REM and INLINE_EDITOR_MIN_CONTAINER_REM in @commise/features-recipes
// `form/inlineEditorFit.ts`, which no package export exposes. Change both together: if they drift, an edge case fails.
const INLINE_THRESHOLD_REM = 43;
const INLINE_CONTAINER_REM = 43;
// With the sidebar showing (a window from 840 px), the window is 20 rem wider than the editor's container: measured
// 2026-11-14 at 100% and 200% text (a 1008 px window held a 43 rem container, and a 2016 px window at 200% text did too).
const SIDEBAR_AND_GUTTERS_REM = 20;

/**
 * The strict reading: the reason fully between the header and the bar, and Done and Cancel in view.
 *
 * @param page - The page, on the open inline editor.
 * @param editor - The inline editor's region.
 */
async function expectInlineReach(page: Page, editor: Locator): Promise<void> {
    const viewport = page.viewportSize();

    expect(viewport).not.toBeNull();
    // The range's second bound is drawn: the editor holds the content this case is about.
    await expect(editor.getByLabel(/^Amount/u)).toHaveCount(2);
    await expect
        .poll(async () => reachViolations(page, editor, viewport), { message: 'Done and Cancel are reachable' })
        .toEqual([]);
    expect(await noticeViolations(page, reviewNotice(editor))).toEqual([]);
}

for (const textScale of [1, 2]) {
    const text = `text at ${textScale * 100}%`;
    const px = (rem: number): number => rem * 16 * textScale;
    const window = (heightRem: number, containerRem: number): { width: number; height: number } => ({
        width: px(containerRem + SIDEBAR_AND_GUTTERS_REM),
        height: px(heightRem),
    });
    const edges = [
        {
            name: 'inline at 43 rem high and 43 rem wide',
            viewport: window(INLINE_THRESHOLD_REM, INLINE_CONTAINER_REM),
            inline: true,
        },
        {
            name: 'sheet at 42 rem high and 43 rem wide',
            viewport: window(INLINE_THRESHOLD_REM - 1, INLINE_CONTAINER_REM),
            inline: false,
        },
        {
            name: 'sheet at 43 rem high and 42 rem wide',
            viewport: window(INLINE_THRESHOLD_REM, INLINE_CONTAINER_REM - 1),
            inline: false,
        },
    ] as const;

    for (const edge of edges) {
        test.describe(`the jump, ${edge.name}, ${text}`, () => {
            test.use({ viewport: edge.viewport });

            test(
                edge.inline ? 'opens inline with the longest content' : 'opens as the sheet, with the reason on top',
                async ({ page }) => {
                    await applyTextScale(page, textScale);
                    await openDetail(page, [healthyLine, longestDoubtedLine]);
                    await page.getByRole('link', { name: LINK_NAME }).click();
                    const editor = await openEditor(page, edge.inline ? 0 : 1);

                    await expectRootFontSize(page, textScale);
                    await expect(reviewNotice(editor)).toBeVisible();

                    if (edge.inline) {
                        await expectInlineReach(page, editor);
                    } else {
                        await expect(reviewNotice(editor)).toBeInViewport({ ratio: 1 });
                    }
                },
            );
        });
    }
}
