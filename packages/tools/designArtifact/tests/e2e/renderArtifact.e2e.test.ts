/**
 * LOCAL e2e (`docs/CODING_STANDARDS.md` §7.1a): every component card and every canvas board, built by the real
 * pipeline, rendered in Chromium in light and dark.
 *
 * What a green run proves that the integration tier cannot: the bundle runs against React 18 in a real browser, the
 * card and board markup finds the namespace it names, nothing throws or logs an error, the fonts load, and the height
 * each card declares (and each board's registry height) still holds the content. A declared height that has gone stale
 * fails here, by name.
 *
 * Each card and board is one `it` per theme, so a failure names the artifact. There is no sleep: the page's own
 * readiness flag (`data-card-ready`), the canvas runtime's render (no `<x-import>` left) and `document.fonts.ready`
 * are awaited.
 *
 * Every card is also held to one general rule: no in-flow child sticks out of its parent sideways unless the parent
 * clips on purpose. That is how a long label that cannot truncate (it widens its card past the width the card sets and
 * pushes a control out) fails here, by card name, whichever component it is in.
 *
 * Heights are measured at a 960 px wide window for cards and at the board's own width for boards, with the window as
 * tall as the declared height: the document is then taller than the window exactly when the content does not fit.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { chromium } from 'playwright-core';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { CARDS_DIR } from '../../src/buildArtifact.js';
import { BOARDS, BOARD_WIDTH } from '../../src/canvas/boards.js';
import { loadCardSpec } from '../../src/cards/loadCardSpec.js';

const THEMES = ['light', 'dark'] as const;
type Theme = (typeof THEMES)[number];

const origin = inject('artifactOrigin');

let browser: Browser;

beforeAll(async () => {
    browser = await chromium.launch();
});

afterAll(async () => {
    await browser.close();
});

/** Opens a page in its own context that records everything a user of the artifact would call broken. */
async function openPage(
    theme: Theme,
    width: number,
    height: number,
): Promise<{ readonly page: Page; readonly problems: string[] }> {
    const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme });
    const page = await context.newPage();
    const problems: string[] = [];

    page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
        if (message.type() === 'error') {
            problems.push(`console.error: ${message.text()}`);
        }
    });
    page.on('requestfailed', (request) => problems.push(`request failed: ${request.url()}`));
    page.on('response', (response) => {
        if (response.status() >= 400) {
            problems.push(`HTTP ${String(response.status())}: ${response.url()}`);
        }
    });

    return { page, problems };
}

/** The declared height in a card's marker line. */
function declaredHeight(html: string): number {
    const match = /<!-- @dsCard group="[^"]*" height=(\d+) -->/u.exec(html);

    if (match?.[1] === undefined) {
        throw new Error('The card page has no @dsCard marker with a height.');
    }

    return Number(match[1]);
}

/** Waits for a condition on the page, and on a timeout reports what the page logged instead of a bare timeout. */
async function waitReady(page: Page, problems: readonly string[], what: string, ready: () => boolean): Promise<void> {
    await page.waitForFunction(ready, undefined, { timeout: 20_000 }).catch((error: unknown) => {
        throw new Error(`${what}: ${String(error)}\n${problems.join('\n')}`, { cause: error });
    });
}

/**
 * The boxes in a card column with an in-flow child that sticks out of them sideways with nothing clipping it: that is
 * content spilled out (a long label that cannot shrink, a child that widened its parent past the width the card sets,
 * a control pushed out of its row). It is measured from the boxes the browser drew, not from `scrollWidth`, which also
 * counts what cannot be seen: an invisible measuring twin, or a spinner's rotated corner mid-turn.
 *
 * - A box that clips (`overflow-x` other than visible) may hold wider content: it is how a long label is cut.
 * - An inline box has no box to stick out of, so it is not measured.
 * - A child that is invisible, out of flow (absolute or fixed) or takes no box is not content in the flow.
 * - Animations are cancelled first, so the answer does not depend on the moment it was asked.
 */
async function sidewaysSpills(page: Page): Promise<string[]> {
    return page.evaluate(() => {
        for (const animation of document.getAnimations()) {
            animation.cancel();
        }

        // The first classes only: a utility-class list can run to hundreds of characters.
        const describe = (element: Element): string =>
            `<${element.tagName.toLowerCase()} class="${(element.getAttribute('class') ?? '').slice(0, 48)}">`;

        return ['w', 'n'].flatMap((id) => {
            const column = document.getElementById(id);

            if (column === null) {
                return [];
            }

            return [column, ...Array.from(column.getElementsByTagName('*'))].flatMap((element) => {
                // An inline box draws no box of its own (`clientWidth` 0): its children flow in the box around it.
                if (getComputedStyle(element).overflowX !== 'visible' || element.clientWidth === 0) {
                    return [];
                }

                const box = element.getBoundingClientRect();
                const right = box.left + element.clientLeft + element.clientWidth;

                return Array.from(element.children).flatMap((child) => {
                    const style = getComputedStyle(child);
                    const drawn = child.getBoundingClientRect();
                    const inFlow =
                        style.visibility === 'visible' &&
                        style.display !== 'none' &&
                        style.position !== 'absolute' &&
                        style.position !== 'fixed' &&
                        drawn.width > 0;
                    const spill = drawn.right - right;

                    return inFlow && spill > 1
                        ? [
                              `${element === column ? `column #${id}` : describe(element)} in #${id}: ${describe(child)} ends ${spill.toFixed(1)}px past its right edge`,
                          ]
                        : [];
                });
            });
        });
    });
}

const CARD_NAMES = readdirSync(CARDS_DIR).sort();

describe('component cards', () => {
    it('are discovered from the card sources', () => {
        expect(CARD_NAMES.length).toBeGreaterThan(0);
    });

    describe.each(CARD_NAMES)('%s', (name) => {
        it.each(THEMES)('renders in %s', async (theme) => {
            const url = `${origin}/ds/components/${name}/preview.html?theme=${theme}`;
            const height = declaredHeight(await (await fetch(url)).text());
            const spec = await loadCardSpec(join(CARDS_DIR, name, `${name}.card.tsx`));
            const scrolls = spec.staging?.scrollsDocument === true;
            const { page, problems } = await openPage(theme, 960, height);

            try {
                await page.goto(url);
                await waitReady(
                    page,
                    problems,
                    'the card never became ready',
                    () => document.documentElement.dataset['cardReady'] === 'true',
                );

                const measured = await page.evaluate(async () => {
                    await document.fonts.ready;
                    await document.fonts.load('16px Inter');

                    const columns = ['w', 'n'].flatMap((id) => {
                        const element = document.getElementById(id);

                        return element === null ? [] : [{ id, shown: element.getElementsByTagName('*').length }];
                    });
                    // An overlay portals to <body> (a native Modal) or into a staged frame; both count as shown.
                    const portaled = Array.from(document.body.children).filter(
                        (child) => !child.classList.contains('pair') && child.tagName !== 'SCRIPT',
                    );
                    const staged =
                        Array.from(document.querySelectorAll('.frame')).reduce(
                            (count, frame) => count + frame.getElementsByTagName('*').length,
                            0,
                        ) + portaled.length;

                    return {
                        contentHeight: document.documentElement.scrollHeight,
                        columns,
                        staged,
                        interCheck: document.fonts.check('16px Inter'),
                        interLoaded: Array.from(document.fonts).some(
                            (face) => face.family.replace(/["']/gu, '') === 'Inter' && face.status === 'loaded',
                        ),
                        theme: document.documentElement.dataset['theme'],
                    };
                });

                expect(problems).toEqual([]);
                expect(measured.theme).toBe(theme);
                expect(measured.columns.length).toBeGreaterThan(0);

                for (const column of measured.columns) {
                    expect(column.shown + measured.staged, `column #${column.id} rendered nothing`).toBeGreaterThan(0);
                }

                expect(measured.interCheck).toBe(true);
                expect(measured.interLoaded, 'no Inter face was loaded').toBe(true);
                expect(await sidewaysSpills(page), 'content spills out of its box sideways').toEqual([]);

                if (scrolls) {
                    expect(measured.contentHeight, 'a scrolling card must be taller than its height').toBeGreaterThan(
                        height,
                    );
                    await waitReady(page, problems, 'the card never scrolled', () => window.scrollY > 0);
                } else {
                    expect(
                        measured.contentHeight,
                        `content is taller than the declared ${String(height)}px`,
                    ).toBeLessThanOrEqual(height);
                }
            } finally {
                await page.context().close();
            }
        });
    });
});

describe('canvas boards', () => {
    describe.each(BOARDS)('$file', (board) => {
        it.each(THEMES)('renders in %s', async (theme) => {
            const width = BOARD_WIDTH[board.platform];
            const { page, problems } = await openPage(theme, width, board.height);

            try {
                await page.goto(`${origin}/canvas/${board.file}?theme=${theme}`);
                // The canvas runtime replaces the board's <x-dc> with the rendered screen, every <x-import> resolved.
                await waitReady(
                    page,
                    problems,
                    'the board never finished rendering',
                    () =>
                        document.querySelector('x-dc') === null &&
                        document.querySelectorAll('x-import').length === 0 &&
                        document.body.innerText.trim().length > 0,
                );

                const measured = await page.evaluate(async () => {
                    await document.fonts.ready;
                    await document.fonts.load('16px Inter');

                    return {
                        // The window is as tall as the declared height and a board's shell fills it
                        // (`min-height: 100vh`), so the document is taller than the window exactly when the content
                        // no longer fits.
                        contentHeight: document.documentElement.scrollHeight,
                        contentWidth: document.documentElement.scrollWidth,
                        interCheck: document.fonts.check('16px Inter'),
                        interLoaded: Array.from(document.fonts).some(
                            (face) => face.family.replace(/["']/gu, '') === 'Inter' && face.status === 'loaded',
                        ),
                        theme: document.documentElement.dataset['theme'],
                    };
                });

                expect(problems).toEqual([]);
                expect(measured.theme).toBe(theme);
                expect(measured.interCheck).toBe(true);
                expect(measured.interLoaded, 'no Inter face was loaded').toBe(true);
                expect(measured.contentWidth, 'content overflows the board sideways').toBeLessThanOrEqual(width);
                expect(
                    measured.contentHeight,
                    `content is taller than the registry's ${String(board.height)}px`,
                ).toBeLessThanOrEqual(board.height);
            } finally {
                await page.context().close();
            }
        });
    });
});
