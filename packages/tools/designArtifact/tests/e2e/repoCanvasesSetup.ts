/**
 * @module repoCanvasesSetup — the repo-canvas render's one-time set-up: prove Chromium and the Design canvas runtime
 * are present, and serve the canvases. It needs no build, so it does not wait for the artifacts' cold build.
 *
 * ⛔ It THROWS, with the instruction that fixes it, when a dependency is absent (`docs/CODING_STANDARDS.md` §7.1a).
 */
import { fileURLToPath } from 'node:url';

import type { TestProject } from 'vitest/node';

import { assertCanvasRuntimePrerequisites } from './canvasRuntimePrerequisites.js';
import { startRepoCanvasServer } from './repoCanvasServer.js';

declare module 'vitest' {
    export interface ProvidedContext {
        /** Where the repo-canvas server listens. */
        repoCanvasOrigin: string;
    }
}

/**
 * Serves the canvases for the suite.
 *
 * @param project - The vitest project, which hands the server's address to the suites.
 * @returns The teardown that stops the server.
 * @sideEffect Launches Chromium once and opens a port.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
    const runtimeFile = await assertCanvasRuntimePrerequisites(process.env);
    const server = await startRepoCanvasServer({
        canvasesDir: fileURLToPath(new URL('../../../../../docs/design/canvases', import.meta.url)),
        canvasRuntimeFile: runtimeFile,
    });

    project.provide('repoCanvasOrigin', server.origin);

    return () => server.close();
}
