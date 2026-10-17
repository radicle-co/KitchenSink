/**
 * @module artifactServer — a static file server for the built artifacts, on an ephemeral port.
 *
 * It stands in for the claude.ai host, which this tier cannot reach: it serves the Design System payload under
 * `/ds/`, the canvas payload under `/canvas/` (with `support.js` supplied by the Design canvas runtime the platform
 * owns), and the two React builds under `/vendor/`. A page asks for a theme with `?theme=dark`; for the pages the host
 * wraps (a card preview, a board) the server then plays the host's part and sets `data-theme` on `<html>` and, for a
 * card, loads the preload the design-system page does: the tokens CSS, `bundle.css`, React 18 and `bundle.js`.
 *
 * Everything outside the served roots answers 404, and a path that resolves outside a root is refused.
 */
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';

/** What the server serves. */
export interface ArtifactServerConfig {
    /** `designSystem/project`. */
    readonly designSystemDir: string;
    /** `canvas/project`. */
    readonly canvasDir: string;
    /** Absolute path of the Design canvas runtime, served as `/canvas/support.js`. */
    readonly canvasRuntimeFile: string;
    /** The Tokens CSS the host builds from `tokens.json`. */
    readonly tokensCss: string;
    readonly react: string;
    readonly reactDom: string;
}

/** A running server. */
export interface ArtifactServer {
    readonly origin: string;
    close(): Promise<void>;
}

const TYPES: Readonly<Record<string, string>> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.ttf': 'font/ttf',
    '.jpg': 'image/jpeg',
    '.txt': 'text/plain; charset=utf-8',
};

/** The tags a card page needs ahead of its own script, in the order the host loads them. */
export function cardPreload(config: Pick<ArtifactServerConfig, 'tokensCss'>): string {
    return [
        `<style>${config.tokensCss}</style>`,
        '<link rel="stylesheet" href="/ds/components/bundle.css">',
        '<script src="/vendor/react.js"></script>',
        '<script src="/vendor/reactDom.js"></script>',
        '<script src="/ds/components/bundle.js"></script>',
    ].join('');
}

/**
 * Sets the theme on the document's `<html>` tag and, when given, adds markup right after `<head>`.
 *
 * The replacements are functions so `$&` and friends in the markup are inserted as written.
 *
 * @param html - The page text.
 * @param theme - `light` or `dark`.
 * @param preload - Markup to open the head with.
 * @returns The page text.
 * @throws Error when the page has no `<html>` tag, or `preload` is asked for and there is no `<head>`.
 */
export function hostWrap(html: string, theme: string, preload: string | undefined): string {
    const htmlTag = /<html(\s[^>]*)?>/iu;

    if (!htmlTag.test(html)) {
        throw new Error('The page has no <html> tag to carry the theme.');
    }

    const themed = html.replace(htmlTag, (_tag, attributes: string | undefined) => {
        const kept = (attributes ?? '').replace(/\sdata-theme="[^"]*"/iu, '');

        return `<html${kept} data-theme="${theme}">`;
    });

    if (preload === undefined) {
        return themed;
    }

    if (!/<head>/iu.test(themed)) {
        throw new Error('The page has no <head> to preload.');
    }

    return themed.replace(/<head>/iu, () => `<head>${preload}`);
}

async function respond(
    config: ArtifactServerConfig,
    url: URL,
): Promise<{ status: number; type: string; body: Buffer | string }> {
    const notFound = { status: 404, type: TYPES['.txt'] ?? '', body: 'not found' };
    const path = decodeURIComponent(url.pathname);
    const theme = url.searchParams.get('theme') === 'dark' ? 'dark' : 'light';

    if (path === '/vendor/react.js') {
        return { status: 200, type: TYPES['.js'] ?? '', body: config.react };
    }

    if (path === '/vendor/reactDom.js') {
        return { status: 200, type: TYPES['.js'] ?? '', body: config.reactDom };
    }

    if (path === '/canvas/support.js') {
        return { status: 200, type: TYPES['.js'] ?? '', body: await readFile(config.canvasRuntimeFile) };
    }

    const roots: readonly [string, string][] = [
        ['/ds/', config.designSystemDir],
        ['/canvas/', config.canvasDir],
    ];

    for (const [prefix, root] of roots) {
        if (!path.startsWith(prefix)) {
            continue;
        }

        const file = resolve(join(root, path.slice(prefix.length)));

        if (file !== resolve(root) && !file.startsWith(resolve(root) + sep)) {
            return notFound;
        }

        const bytes = await readFile(file).catch(() => undefined);

        if (bytes === undefined) {
            return notFound;
        }

        const type = TYPES[extname(file)] ?? 'application/octet-stream';
        const isCard = prefix === '/ds/' && file.endsWith(`${sep}preview.html`);
        const isBoard = prefix === '/canvas/' && file.endsWith('.dc.html');

        if (isCard || isBoard) {
            return {
                status: 200,
                type,
                body: hostWrap(bytes.toString('utf8'), theme, isCard ? cardPreload(config) : undefined),
            };
        }

        return { status: 200, type, body: bytes };
    }

    return notFound;
}

/**
 * Starts the server on an ephemeral loopback port.
 *
 * @param config - What to serve.
 * @returns The origin and a `close`.
 * @sideEffect Opens a listening socket on 127.0.0.1.
 */
export async function startArtifactServer(config: ArtifactServerConfig): Promise<ArtifactServer> {
    const server: Server = createServer((request, response) => {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1');

        respond(config, url).then(
            ({ status, type, body }) => {
                response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
                response.end(body);
            },
            (error: unknown) => {
                response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
                response.end(String(error));
            },
        );
    });

    await new Promise<void>((done, fail) => {
        server.once('error', fail);
        server.listen(0, '127.0.0.1', done);
    });

    const address = server.address();

    if (address === null || typeof address === 'string') {
        throw new Error('The artifact server did not bind a TCP port.');
    }

    return {
        origin: `http://127.0.0.1:${String(address.port)}`,
        close: () =>
            new Promise<void>((done, fail) => {
                server.close((error) => (error === undefined ? done() : fail(error)));
            }),
    };
}
