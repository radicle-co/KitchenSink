/**
 * @module pageProblems — opens a page that records everything a user of a canvas would call broken: an uncaught page
 * error, a `console.error`, a failed request, an HTTP status of 400 or more. Google Fonts requests are answered from
 * local files (`localGoogleFonts.ts`), so the page never needs the network and one that cannot be served is a problem.
 */
import type { Browser, Page } from 'playwright-core';

import { routeGoogleFonts } from './localGoogleFonts.js';

/** A page and the problems it has recorded so far (the array grows as the page runs). */
export interface RecordedPage {
    readonly page: Page;
    readonly problems: string[];
}

/**
 * Opens a page in its own context and starts recording.
 *
 * @param browser - The browser to open the context in.
 * @param theme - The colour scheme the page prefers.
 * @param width - Viewport width in CSS px.
 * @param height - Viewport height in CSS px.
 * @returns The page and its live problem list.
 * @sideEffect Opens a browser context and registers page listeners.
 */
export async function openRecordedPage(
    browser: Browser,
    theme: 'light' | 'dark',
    width: number,
    height: number,
): Promise<RecordedPage> {
    const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme });
    await routeGoogleFonts(context);

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
