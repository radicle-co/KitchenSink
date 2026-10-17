/**
 * @module globalSetup — the LOCAL e2e tier's one-time set-up: prove the dependencies are present, build the artifacts
 * with the real adapters, and serve them.
 *
 * ⛔ It THROWS, with the instruction that fixes it, when a dependency is absent (`docs/CODING_STANDARDS.md` §7.1a: a
 * LOCAL suite never skips). The dependencies are Chromium, the React 18 builds the host loads (fetched and checked
 * against their pinned hashes), and the Design canvas runtime the platform supplies for the boards.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { chromium } from 'playwright-core';
import type { TestProject } from 'vitest/node';

import { buildArtifact } from '../../src/buildArtifact.js';
import { realBuildPorts } from '../../src/realBuildPorts.js';

import { startArtifactServer } from './artifactServer.js';
import { reactRuntime } from './reactRuntime.js';
import { hostTokensCss } from './tokensCss.js';

declare module 'vitest' {
    export interface ProvidedContext {
        /** Where the artifact server listens. */
        artifactOrigin: string;
    }
}

const RUNTIME_HELP = [
    'DESIGN_CANVAS_RUNTIME must name a local copy of the Design canvas runtime (the `support.js` the claude.ai platform',
    'supplies to a canvas; this repository does not vendor it). To get one: read any Design canvas artifact with the',
    "Artifact tool's `read` action and its `path` set to `artifact-type/dc-runtime.js`, then export",
    'DESIGN_CANVAS_RUNTIME=<the saved file>.',
].join(' ');

async function assertChromiumLaunches(): Promise<void> {
    try {
        const browser = await chromium.launch();

        await browser.close();
    } catch (error) {
        throw new Error(
            `Chromium cannot launch (${String(error)}). Install it with \`npx playwright-core install chromium\`.`,
            { cause: error },
        );
    }
}

/**
 * Builds and serves the artifacts for the suite.
 *
 * @param project - The vitest project, which hands the server's address to the suites.
 * @returns The teardown that stops the server and removes the build.
 * @sideEffect Launches Chromium once, builds into a temp directory, fetches React on a cold cache, opens a port.
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
    await assertChromiumLaunches();

    const react = await reactRuntime();
    const outDir = await mkdtemp(join(tmpdir(), 'designArtifact-e2e-'));
    const built = await buildArtifact(realBuildPorts(process.env), outDir);
    const tokens: unknown = JSON.parse(await readFile(join(built.designSystemDir, 'tokens.json'), 'utf8'));
    const server = await startArtifactServer({
        designSystemDir: built.designSystemDir,
        canvasDir: built.canvasDir,
        canvasRuntimeFile: runtimeFile,
        tokensCss: hostTokensCss(tokens, '/ds/'),
        react: react.react,
        reactDom: react.reactDom,
    });

    project.provide('artifactOrigin', server.origin);

    return async () => {
        await server.close();
        await rm(outDir, { recursive: true, force: true });
    };
}
