/**
 * @module canvasRuntimePrerequisites — what every LOCAL e2e set-up proves before it serves a canvas: the Design canvas
 * runtime file is named and readable, and Chromium launches.
 *
 * ⛔ Each check THROWS, with the instruction that fixes it, when a dependency is absent (`docs/CODING_STANDARDS.md`
 * §7.1a: a LOCAL suite never skips).
 */
import { readFile } from 'node:fs/promises';

import { chromium } from 'playwright-core';

const RUNTIME_HELP = [
    'DESIGN_CANVAS_RUNTIME must name a local copy of the Design canvas runtime (the `support.js` the claude.ai platform',
    'supplies to a canvas; this repository does not vendor it). To get one: read any Design canvas artifact with the',
    "Artifact tool's `read` action and its `path` set to `artifact-type/dc-runtime.js`, then export",
    'DESIGN_CANVAS_RUNTIME=<the saved file>.',
].join(' ');

/**
 * Proves the Design canvas runtime and Chromium are present.
 *
 * @param env - The process environment.
 * @returns The path of the runtime file.
 * @throws Error naming the fix when the runtime is unset or unreadable, or Chromium cannot launch.
 * @sideEffect Reads the runtime file and launches Chromium once.
 */
export async function assertCanvasRuntimePrerequisites(env: NodeJS.ProcessEnv): Promise<string> {
    const runtimeFile = env['DESIGN_CANVAS_RUNTIME'];

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

    return runtimeFile;
}
