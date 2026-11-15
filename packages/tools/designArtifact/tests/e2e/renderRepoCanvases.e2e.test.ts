/**
 * LOCAL e2e (`docs/CODING_STANDARDS.md` §7.1a): the repo-source canvases, rendered as committed in Chromium in light
 * and dark. No build is involved: each board is the file in `docs/design/canvases/<folder>/project/`, which is what a
 * publish sends.
 *
 * Which canvases: the folders changed against the merge base with `origin/main` (committed, staged or not).
 * `CANVASES=all` renders every canvas (the check before a publish), and `CANVASES=id,id` the ones named.
 *
 * A board's size is the one its `canvas.json` places it at (`boards[file].w` and `.h`). Each board is one `it` per
 * theme, so a failure names the board. Nothing sleeps: the runtime's render (no `<x-import>` left) and
 * `document.fonts.ready` are awaited.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright-core';
import type { Browser } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { parseRepoCanvases } from '../../src/publish/repoCanvases.js';
import { changedRegistryIds, selectCanvases } from '../../src/publish/selectCanvases.js';

import { openRecordedPage } from './pageProblems.js';

const THEMES = ['light', 'dark'] as const;

const REPO_ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));
const CANVASES_DIR = join(REPO_ROOT, 'docs', 'design', 'canvases');

const canvasJsonSchema = z.object({ boards: z.record(z.string(), z.object({ w: z.number(), h: z.number() })) });

const git = (...args: string[]): string => execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();

const mergeBase = (): string => git('merge-base', 'HEAD', 'origin/main');

const changedPaths = (): readonly string[] =>
    git('diff', '--name-only', mergeBase())
        .split('\n')
        .filter((line) => line !== '');

/** The registry as the merge base had it, or `null` when the merge base has none. */
const registryAtMergeBase = (): string | null => {
    try {
        return git('show', `${mergeBase()}:docs/design/canvases/registry.json`);
    } catch {
        return null;
    }
};

const registryText = readFileSync(join(CANVASES_DIR, 'registry.json'), 'utf8');
const selected = selectCanvases(
    parseRepoCanvases(registryText),
    changedPaths(),
    process.env['CANVASES'],
    new Set(changedRegistryIds(registryAtMergeBase(), registryText)),
);

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
            JSON.parse(readFileSync(join(CANVASES_DIR, canvas.folder, 'project', 'canvas.json'), 'utf8')),
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

                    expect(problems).toEqual([]);
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
