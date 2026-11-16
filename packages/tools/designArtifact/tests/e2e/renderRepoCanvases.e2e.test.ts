/**
 * LOCAL e2e (`docs/CODING_STANDARDS.md` §7.1a): the repo-source canvases, rendered as committed in Chromium in light
 * and dark. No build is involved: each board is the file in `docs/design/canvases/<folder>/project/`, which is what a
 * publish sends.
 *
 * Which canvases: see `selectedRepoCanvases` (`CANVASES=all` is the check before a publish). Their LFS images are
 * fetched by the set-up, and every `<img>` must have loaded.
 *
 * A board's size is the one its `canvas.json` places it at (`boards[file].w` and `.h`). Each board is one `it` per
 * theme, so a failure names the board. Nothing sleeps: the runtime's render (no `<x-import>` left) and
 * `document.fonts.ready` are awaited.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { chromium } from 'playwright-core';
import type { Browser } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { openRecordedPage } from './pageProblems.js';
import { CANVASES_ABS_DIR, selectedRepoCanvases } from './selectedRepoCanvases.js';

const THEMES = ['light', 'dark'] as const;

const canvasJsonSchema = z.object({ boards: z.record(z.string(), z.object({ w: z.number(), h: z.number() })) });

const selected = selectedRepoCanvases(process.env['CANVASES']);

const origin = inject('repoCanvasOrigin');

let browser: Browser;

beforeAll(async () => {
    browser = await chromium.launch();
});

afterAll(async () => {
    await browser.close();
});

describe('repo canvases', () => {
    // With nothing selected the suite would hold no test at all, which reads as a failure of the runner. A skip says
    // so by name. Selection itself is covered by selectCanvases.test.ts.
    if (selected.length === 0) {
        it.skip('selected no canvas: no folder or registry entry changed against origin/main', () => undefined);
    }

    describe.each(selected)('$id', (canvas) => {
        const { boards } = canvasJsonSchema.parse(
            JSON.parse(readFileSync(join(CANVASES_ABS_DIR, canvas.folder, 'project', 'canvas.json'), 'utf8')),
        );

        describe.each(Object.entries(boards))('%s', (file, { w, h }) => {
            it.each(THEMES)('renders in %s', async (theme) => {
                const { page, problems } = await openRecordedPage(browser, theme, w, h);

                try {
                    await page.goto(`${origin}/canvases/${canvas.folder}/${file}?theme=${theme}`);
                    await page
                        .waitForFunction(
                            () =>
                                document.querySelector('x-dc') === null &&
                                document.querySelectorAll('x-import').length === 0 &&
                                document.body.innerText.trim().length > 0,
                            undefined,
                            { timeout: 20_000 },
                        )
                        .catch((error: unknown) => {
                            throw new Error(
                                `the board never finished rendering: ${String(error)}\n${problems.join('\n')}`,
                                {
                                    cause: error,
                                },
                            );
                        });

                    const measured = await page.evaluate(async () => {
                        await document.fonts.ready;

                        return {
                            contentHeight: document.documentElement.scrollHeight,
                            contentWidth: document.documentElement.scrollWidth,
                            theme: document.documentElement.dataset['theme'],
                        };
                    });

                    const brokenImages = await page.evaluate(() =>
                        [...document.images]
                            .filter((img) => !img.complete || img.naturalWidth === 0)
                            .map((img) => img.src),
                    );

                    expect(problems).toEqual([]);
                    expect(brokenImages, 'images that did not load').toEqual([]);
                    expect(measured.theme).toBe(theme);
                    expect(measured.contentWidth, 'content overflows the board sideways').toBeLessThanOrEqual(w);
                    expect(
                        measured.contentHeight,
                        `content is taller than the ${String(h)}px canvas.json places it at`,
                    ).toBeLessThanOrEqual(h);
                } finally {
                    await page.context().close();
                }
            });
        });
    });
});
