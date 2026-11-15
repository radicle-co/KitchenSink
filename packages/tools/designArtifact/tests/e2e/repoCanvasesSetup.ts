/**
 * @module repoCanvasesSetup — the repo-canvas render's one-time set-up: prove Chromium and the Design canvas runtime
 * are present, and serve the canvases. It needs no build, so it does not wait for the artifacts' cold build.
 *
 * ⛔ It THROWS, with the instruction that fixes it, when a dependency is absent (`docs/CODING_STANDARDS.md` §7.1a).
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright-core';
import type { TestProject } from 'vitest/node';

import { startRepoCanvasServer } from './repoCanvasServer.js';

declare module 'vitest' {
    export interface ProvidedContext {
        /** Where the repo-canvas server listens. */
        repoCanvasOrigin: string;
    }
}

const RUNTIME_HELP = [
    'DESIGN_CANVAS_RUNTIME must name a local copy of the Design canvas runtime (the `support.js` the claude.ai platform',
    'supplies to a canvas; this repository does not vendor it). To get one: read any Design canvas artifact with the',
    "Artifact tool's `read` action and its `path` set to `artifact-type/dc-runtime.js`, then export",
    'DESIGN_CANVAS_RUNTIME=<the saved file>.',
].join(' ');

/**
 * Serves the canvases for the suite.
 *
 * @param project - The vitest project, which hands the server's address to the suites.
 * @returns The teardown that stops the server.
 * @sideEffect Launches Chromium once and opens a port.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
    const runtimeFile = process.env['DESIGN_CANVAS_RUNTIME'];

    if (runtimeFile === undefined || runtimeFile === '') {
        throw new Error(RUNTIME_HELP);
    }

    await readFile(runtimeFile).catch((error: unknown) => {
        throw new Error(`DESIGN_CANVAS_RUNTIME (${runtimeFile}) cannot be read: ${String(error)}. ${RUNTIME_HELP}`, {
            cause: error,
        });
    });
    await chromium
        .launch()
        .then((browser) => browser.close())
        .catch((error: unknown) => {
            throw new Error(
                `Chromium cannot launch (${String(error)}). Install it with \`npx playwright-core install chromium\`.`,
                { cause: error },
            );
        });

    const server = await startRepoCanvasServer({
        canvasesDir: fileURLToPath(new URL('../../../../../docs/design/canvases', import.meta.url)),
        canvasRuntimeFile: runtimeFile,
    });

    project.provide('repoCanvasOrigin', server.origin);

    return () => server.close();
}
