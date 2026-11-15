/**
 * @module repoCanvasServer — a static file server for the repo-source canvases, on an ephemeral port.
 *
 * It stands in for the claude.ai host: `/canvases/<folder>/<file>` is `docs/design/canvases/<folder>/project/<file>`,
 * `support.js` is the Design canvas runtime the platform owns, and for a board `?theme=dark` sets `data-theme` on
 * `<html>` the way the host does. Everything else answers 404, and a path that resolves outside a canvas's `project/`
 * is refused.
 */
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';

import { hostWrap } from './artifactServer.js';

/** What the server serves. */
export interface RepoCanvasServerConfig {
    /** `docs/design/canvases`. */
    readonly canvasesDir: string;
    /** Absolute path of the Design canvas runtime, served as `support.js`. */
    readonly canvasRuntimeFile: string;
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

const CANVAS_PATH = /^\/canvases\/([A-Za-z0-9]+)\/(.+)$/u;

async function respond(
    config: RepoCanvasServerConfig,
    url: URL,
): Promise<{ status: number; type: string; body: Buffer | string }> {
    const notFound = { status: 404, type: TYPES['.txt'] ?? '', body: 'not found' };
    const match = CANVAS_PATH.exec(decodeURIComponent(url.pathname));

    if (match?.[1] === undefined || match[2] === undefined) {
        return notFound;
    }

    if (match[2] === 'support.js') {
        return { status: 200, type: TYPES['.js'] ?? '', body: await readFile(config.canvasRuntimeFile) };
    }

    const root = resolve(join(config.canvasesDir, match[1], 'project'));
    const file = resolve(join(root, match[2]));
    const bytes = file.startsWith(root + sep) ? await readFile(file).catch(() => undefined) : undefined;

    if (bytes === undefined) {
        return notFound;
    }

    const type = TYPES[extname(file)] ?? 'application/octet-stream';

    return {
        status: 200,
        type,
        body: file.endsWith('.dc.html')
            ? hostWrap(bytes.toString('utf8'), url.searchParams.get('theme') === 'dark' ? 'dark' : 'light', undefined)
            : bytes,
    };
}

/**
 * Starts the server on an ephemeral loopback port.
 *
 * @param config - What to serve.
 * @returns The origin and a `close`.
 * @sideEffect Opens a listening socket on 127.0.0.1.
 */
export async function startRepoCanvasServer(
    config: RepoCanvasServerConfig,
): Promise<{ readonly origin: string; close(): Promise<void> }> {
    const server: Server = createServer((request, response) => {
        respond(config, new URL(request.url ?? '/', 'http://127.0.0.1')).then(
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
        throw new Error('The canvas server did not bind a TCP port.');
    }

    return {
        origin: `http://127.0.0.1:${String(address.port)}`,
        close: () =>
            new Promise<void>((done, fail) => {
                server.close((error) => (error === undefined ? done() : fail(error)));
            }),
    };
}
