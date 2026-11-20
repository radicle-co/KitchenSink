/**
 * LOCAL e2e: a recorded page never reaches Google Fonts. The canvases `<link>` `fonts.googleapis.com`; the render
 * test must not depend on that network, so those requests are answered from the font packages in `node_modules`, and a
 * request nothing local can answer is a PAGE PROBLEM rather than a silent trip to the network.
 *
 * Both cases run in real Chromium against a page that links the stylesheet the way a canvas does. The page itself is
 * served by a route on a made-up origin, so nothing but the font requests is under test.
 */
import type { Browser } from 'playwright-core';
import { chromium } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { openRecordedPage } from './pageProblems.js';

const PAGE_URL = 'http://fonts-routing.test/';
const STYLESHEET = 'https://fonts.googleapis.com/css2';

const pageLinking = (query: string, stylesheet = STYLESHEET): string =>
    `<!doctype html><link rel="stylesheet" href="${stylesheet}?${query}"><body>text</body>`;

let browser: Browser;

beforeAll(async () => {
    browser = await chromium.launch();
});

afterAll(async () => {
    await browser.close();
});

async function open(query: string, stylesheet?: string) {
    const recorded = await openRecordedPage(browser, 'light', 400, 300);

    await recorded.page
        .context()
        .route(PAGE_URL, (route) =>
            route.fulfill({ status: 200, contentType: 'text/html', body: pageLinking(query, stylesheet) }),
        );
    await recorded.page.goto(PAGE_URL);

    return recorded;
}

describe('Google Fonts in a recorded page', () => {
    it('serves every family and weight the canvases request from local files, with no problem', async () => {
        const { page, problems } = await open(
            'family=Inter:wght@400;500;600&family=Manrope:wght@600&family=Caveat:wght@400&display=swap',
        );

        try {
            const loaded = await page.evaluate(async () => {
                await document.fonts.load('600 16px Manrope');
                await document.fonts.load('400 16px Caveat');
                await document.fonts.load('500 16px Inter');

                return ['600 16px Manrope', '400 16px Caveat', '500 16px Inter'].map((font) =>
                    document.fonts.check(font),
                );
            });

            expect(problems).toEqual([]);
            expect(loaded).toEqual([true, true, true]);
        } finally {
            await page.context().close();
        }
    });

    it('counts a family nothing local can serve as a page problem, not a trip to the network', async () => {
        const { page, problems } = await open('family=Roboto:wght@400&display=swap');

        try {
            expect(problems.join('\n')).toContain('fonts.googleapis.com');
        } finally {
            await page.context().close();
        }
    });

    it('counts an axis it does not understand as a page problem, never as Regular 400', async () => {
        const { page, problems } = await open('family=Inter:ital,wght@1,700&display=swap');

        try {
            expect(problems.join('\n')).toContain('fonts.googleapis.com');
        } finally {
            await page.context().close();
        }
    });

    it('counts a stylesheet path other than css2 as a page problem', async () => {
        const { page, problems } = await open('family=Inter:wght@400', 'https://fonts.googleapis.com/css');

        try {
            expect(problems.join('\n')).toContain('fonts.googleapis.com');
        } finally {
            await page.context().close();
        }
    });
});
