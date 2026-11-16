/**
 * @module localGoogleFonts — answers a page's requests to Google Fonts from the `@expo-google-fonts/*` packages in
 * `node_modules`, so a render test never depends on the network.
 *
 * The canvases `<link>` `https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&…`. The stylesheet is rebuilt
 * from the families and weights in that URL, each `@font-face` pointing at a `fonts.gstatic.com` URL that is answered
 * with the local `.ttf`. A family or weight no installed package holds is answered 404, which the recorded page counts
 * as a problem: the test fails instead of quietly using the network.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import type { BrowserContext, Route } from 'playwright-core';

const require = createRequire(import.meta.url);

const STYLESHEET_HOST = 'fonts.googleapis.com';
const FILE_HOST = 'fonts.gstatic.com';
const FILE_PATH = /^\/local\/([^/]+)\/(\d+)\.ttf$/u;

/** The weight names `@expo-google-fonts` uses in its directory and file names. */
const WEIGHT_NAMES: Readonly<Record<string, string>> = {
    '100': 'Thin',
    '200': 'ExtraLight',
    '300': 'Light',
    '400': 'Regular',
    '500': 'Medium',
    '600': 'SemiBold',
    '700': 'Bold',
    '800': 'ExtraBold',
    '900': 'Black',
};

/** One face a stylesheet asks for. */
export interface FontRequest {
    readonly family: string;
    readonly weight: string;
}

/**
 * The faces a Google Fonts `css2` URL asks for: `family=Inter:wght@400;500&family=Caveat:wght@400` is three faces.
 *
 * @param stylesheetUrl - The `fonts.googleapis.com/css2` URL.
 * @returns Every family and weight, in request order. A family with no `wght` axis asks for 400.
 */
export function requestedFaces(stylesheetUrl: URL): readonly FontRequest[] {
    return stylesheetUrl.searchParams.getAll('family').flatMap((entry) => {
        const [family = '', axes = ''] = entry.split(':');
        const weights = axes.startsWith('wght@') ? axes.slice('wght@'.length).split(';') : ['400'];

        return weights.map((weight) => ({ family, weight }));
    });
}

/**
 * The installed `.ttf` for a face.
 *
 * @param face - The family and weight.
 * @returns The absolute path, or undefined when no installed `@expo-google-fonts` package holds it.
 * @sideEffect Reads the file system to resolve the package.
 */
export function localFontFile({ family, weight }: FontRequest): string | undefined {
    const weightName = WEIGHT_NAMES[weight];

    if (weightName === undefined) {
        return undefined;
    }

    try {
        const root = dirname(require.resolve(`@expo-google-fonts/${family.toLowerCase()}/package.json`));
        const file = join(root, `${weight}${weightName}`, `${family}_${weight}${weightName}.ttf`);

        return existsSync(file) ? file : undefined;
    } catch {
        return undefined;
    }
}

const notServed = (route: Route, what: string): Promise<void> =>
    route.fulfill({ status: 404, contentType: 'text/plain', body: `no local copy of ${what}` });

async function serveStylesheet(route: Route, url: URL): Promise<void> {
    const faces = requestedFaces(url);
    const missing = faces.find((face) => localFontFile(face) === undefined);

    if (faces.length === 0 || missing !== undefined) {
        return notServed(
            route,
            missing === undefined ? 'an empty font request' : `${missing.family} ${missing.weight}`,
        );
    }

    const css = faces
        .map(
            ({ family, weight }) =>
                `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};font-display:swap;` +
                `src:url(https://${FILE_HOST}/local/${encodeURIComponent(family)}/${weight}.ttf) format('truetype');}`,
        )
        .join('\n');

    return route.fulfill({ status: 200, contentType: 'text/css', body: css });
}

async function serveFile(route: Route, url: URL): Promise<void> {
    const match = FILE_PATH.exec(url.pathname);
    const file =
        match?.[1] === undefined || match[2] === undefined
            ? undefined
            : localFontFile({ family: decodeURIComponent(match[1]), weight: match[2] });

    return file === undefined
        ? notServed(route, url.pathname)
        : route.fulfill({ status: 200, contentType: 'font/ttf', body: readFileSync(file) });
}

/**
 * Answers every request to Google Fonts in a context from local files, and every one it cannot with a 404.
 *
 * @param context - The browser context to route.
 * @returns Resolves once the route is registered.
 * @sideEffect Registers a route on the context.
 */
export async function routeGoogleFonts(context: BrowserContext): Promise<void> {
    await context.route(
        (url) => url.hostname === STYLESHEET_HOST || url.hostname === FILE_HOST,
        (route) => {
            const url = new URL(route.request().url());

            return url.hostname === STYLESHEET_HOST ? serveStylesheet(route, url) : serveFile(route, url);
        },
    );
}
