import { appendFileSync, mkdirSync } from 'node:fs';
import { relative } from 'node:path';

import { test, type BrowserContext, type Page } from '@playwright/test';

import { BASE_PATH, LOCALE } from './basePath';

/**
 * Records where each spec really goes, so the impacted-test registry (`specScreens.tsv`) can be checked against it.
 *
 * The registry is read from source and cannot see a screen reached by clicking a link. This records the document and
 * React Server Components requests the browser makes, plus main-frame navigations, as one JSON line per navigation in
 * `test-results/routes/lane-<k>.jsonl`. After the run `e2eLanes.ts` hands them to `@kitchensink/e2e-plan`, which fails
 * the run and prints the rows that must grow. A row is never shrunk automatically.
 *
 * It is installed by `signInWithTicket`, which every spec but the sign-in pages calls. There is no shared Playwright
 * fixture in this suite to hang it on.
 *
 * ⚠️ UNPROVEN until the first real run: whether `framenavigated` fires on an App Router client-side navigation. The
 * RSC request is the backstop for exactly that case, which is why both are recorded.
 */

/** The part of a Playwright request the filter reads. */
export interface RecordedRequest {
    readonly url: string;
    readonly resourceType: string;
    readonly headers: Readonly<Record<string, string>>;
}

export interface RecordOptions {
    readonly origin: string;
    /** The basePath and locale every app path starts with, e.g. `/en`. */
    readonly prefix: string;
}

const header = (headers: Readonly<Record<string, string>>, name: string): string | undefined =>
    Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1];

/** The locale-free path of a URL on the app, or undefined when it is not an app page. */
function appPath(url: string, options: RecordOptions): string | undefined {
    const parsed = new URL(url);

    if (parsed.origin !== options.origin) {
        return undefined;
    }

    const { pathname } = parsed;

    if (pathname !== options.prefix && !pathname.startsWith(`${options.prefix}/`)) {
        return undefined;
    }

    const rest = pathname.slice(options.prefix.length).replace(/\/$/u, '');

    return rest === '' ? '/' : rest;
}

/** How a navigation was seen: a document request, a React Server Components request, or a main-frame navigation. */
export type NavigationKind = 'document' | 'rsc' | 'framenavigated';

/**
 * Which requests mean "the spec went to this page".
 *
 * @param request - The request.
 * @param options - The app's origin and path prefix.
 * @returns The locale-free path and the kind of request, or undefined. A prefetch is ignored: it loads a page nobody
 * went to.
 */
export function navigationOf(
    request: RecordedRequest,
    options: RecordOptions,
): { readonly path: string; readonly via: 'document' | 'rsc' } | undefined {
    if (header(request.headers, 'next-router-prefetch') !== undefined) {
        return undefined;
    }

    const via =
        request.resourceType === 'document' ? 'document' : header(request.headers, 'rsc') === '1' ? 'rsc' : undefined;
    const path = via === undefined ? undefined : appPath(request.url, options);

    return via === undefined || path === undefined ? undefined : { path, via };
}

/** One JSON Lines record. `via` tells a reader which of the three signals saw the navigation. */
export const recordLine = (spec: string, path: string, via: NavigationKind): string =>
    `${JSON.stringify({ spec, path, via })}\n`;

const instrumented = new WeakSet<object>();

/**
 * Starts recording the navigations of a page's context for the running spec.
 *
 * @sideEffect Appends to `test-results/routes/lane-<shard>.jsonl` and listens to the context's requests.
 * @param page - The page a spec drives. Once per context.
 */
export function recordRoutes(page: Page): void {
    const context: BrowserContext = page.context();

    if (instrumented.has(context)) {
        return;
    }

    instrumented.add(context);

    const info = test.info();
    const spec = relative(info.project.testDir, info.file);
    const dir = 'test-results/routes';
    const file = `${dir}/lane-${process.env['COMMISE_E2E_SHARD'] ?? '1'}.jsonl`;
    const baseUrl = info.project.use.baseURL;

    if (baseUrl === undefined) {
        return;
    }

    const options: RecordOptions = { origin: new URL(baseUrl).origin, prefix: `${BASE_PATH}/${LOCALE}` };

    const write = (seen: { readonly path: string; readonly via: NavigationKind } | undefined): void => {
        if (seen !== undefined) {
            mkdirSync(dir, { recursive: true });
            appendFileSync(file, recordLine(spec, seen.path, seen.via));
        }
    };

    context.on('request', (request) => {
        write(
            navigationOf(
                { url: request.url(), resourceType: request.resourceType(), headers: request.headers() },
                options,
            ),
        );
    });
    page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame()) {
            const seen = navigationOf({ url: frame.url(), resourceType: 'document', headers: {} }, options);

            write(seen === undefined ? undefined : { path: seen.path, via: 'framenavigated' });
        }
    });
}
