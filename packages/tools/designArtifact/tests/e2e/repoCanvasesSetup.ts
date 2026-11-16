/**
 * @module repoCanvasesSetup — the repo-canvas render's one-time set-up: fetch the images of the canvases it will
 * render, prove Chromium and the Design canvas runtime are present, and serve the canvases. It needs no build, so it
 * does not wait for the artifacts' cold build.
 *
 * ⛔ It THROWS, with the instruction that fixes it, when a dependency is absent (`docs/CODING_STANDARDS.md` §7.1a).
 */
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import type { TestProject } from 'vitest/node';

import { CANVAS_ASSETS_DIR, isLfsPointer, lfsPullArgs, lfsPullCommand } from '../../src/publish/gitCanvasHistory.js';

import { assertCanvasRuntimePrerequisites } from './canvasRuntimePrerequisites.js';
import { startRepoCanvasServer } from './repoCanvasServer.js';
import { CANVASES_ABS_DIR, REPO_ROOT, selectedRepoCanvases } from './selectedRepoCanvases.js';

declare module 'vitest' {
    export interface ProvidedContext {
        /** Where the repo-canvas server listens. */
        repoCanvasOrigin: string;
    }
}

/**
 * Fetches the LFS images of the selected canvases (`.lfsconfig` keeps them out of an ordinary fetch), then proves none
 * is still a pointer.
 *
 * @sideEffect Spawns `git lfs pull` and reads the canvases' asset files.
 * @throws Error naming the pull command when an image is still a pointer.
 */
async function ensureImages(folders: readonly string[]): Promise<void> {
    if (folders.length === 0) {
        return;
    }

    execFileSync('git', lfsPullArgs(folders), { cwd: REPO_ROOT, stdio: 'inherit' });

    for (const folder of folders) {
        const dir = join(CANVASES_ABS_DIR, folder, 'project', CANVAS_ASSETS_DIR);
        const names = await readdir(dir).catch((error: unknown) => {
            if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
                return [];
            }

            throw error;
        });

        for (const name of names) {
            if (isLfsPointer(await readFile(join(dir, name)))) {
                throw new Error(`${join(dir, name)} is still an LFS pointer. Run: ${lfsPullCommand(folder)}`);
            }
        }
    }
}

/**
 * Serves the canvases for the suite.
 *
 * @param project - The vitest project, which hands the server's address to the suites.
 * @returns The teardown that stops the server.
 * @sideEffect Fetches images, launches Chromium once and opens a port.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
    const runtimeFile = await assertCanvasRuntimePrerequisites(process.env);
    await ensureImages(selectedRepoCanvases(process.env['CANVASES']).map((canvas) => canvas.folder));
    const server = await startRepoCanvasServer({ canvasesDir: CANVASES_ABS_DIR, canvasRuntimeFile: runtimeFile });

    project.provide('repoCanvasOrigin', server.origin);

    return () => server.close();
}
