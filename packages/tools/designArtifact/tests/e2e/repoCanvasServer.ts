/**
 * @module repoCanvasServer — a static file server for the repo-source canvases, on an ephemeral port.
 *
 * It stands in for the claude.ai host: `/canvases/<folder>/<file>` is `docs/design/canvases/<folder>/project/<file>`,
 * `support.js` is the Design canvas runtime the platform owns, and for a board `?theme=dark` sets `data-theme` on
 * `<html>` the way the host does. Everything else answers 404, and a path that resolves outside a canvas's `project/`
 * is refused.
 */
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';

import { CANVAS_ASSETS_DIR, isLfsPointer, lfsPullCommand } from '../../src/publish/gitCanvasHistory.js';
import { hostWrap } from './artifactServer.js';
import { TYPES, startStaticServer } from './staticServer.js';
import type { StaticResponse, StaticServer } from './staticServer.js';

/** What the server serves. */
export interface RepoCanvasServerConfig {
    /** `docs/design/canvases`. */
    readonly canvasesDir: string;
    /** Absolute path of the Design canvas runtime, served as `support.js`. */
    readonly canvasRuntimeFile: string;
}

const CANVAS_PATH = /^\/canvases\/([A-Za-z0-9]+)\/(.+)$/u;

async function respond(config: RepoCanvasServerConfig, url: URL): Promise<StaticResponse> {
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

    if (match[2].startsWith(`${CANVAS_ASSETS_DIR}/`) && isLfsPointer(bytes)) {
        return {
            status: 500,
            type: TYPES['.txt'] ?? '',
            body: `${match[2]} is an LFS pointer. Run: ${lfsPullCommand(match[1])}`,
        };
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
export async function startRepoCanvasServer(config: RepoCanvasServerConfig): Promise<StaticServer> {
    return startStaticServer((url) => respond(config, url));
}
