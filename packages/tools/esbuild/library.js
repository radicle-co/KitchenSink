/**
 * esbuild configuration for shared library packages.
 *
 * Builds dual browser + node ESM bundles for cross-platform consumption.
 * Browser targets are resolved from the project's browserslist config.
 *
 * Output structure:
 *   dist/browser/ — Browser-targeted ESM bundle
 *   dist/node/    — Node-targeted ESM bundle
 *
 * Usage:
 *   node --import=tsx node_modules/@commise/tools-esbuild/library.js [--entry src/index.ts] [--entry src/system.ts]
 *
 * @module @commise/tools-esbuild/library
 *
 * @requirements
 * 1. Must build ESM bundles for both browser and node platforms.
 * 2. Must resolve browser targets from the project's browserslist config.
 * 3. Must externalize all dependencies (no bundling of node_modules).
 * 4. Must generate source maps for all builds.
 * 5. Must support multiple entry points via --entry CLI flags.
 * 6. Must default to src/index.ts when no entry points are specified.
 */

import * as esbuild from 'esbuild';
import { resolve } from 'node:path';
import { baseOptions, getBrowserTargets, parseEntryPoints } from './base.js';

/**
 * Builds dual browser + node bundles for a shared library package.
 *
 * @param options - Build configuration.
 * @param options.entryPoints - Entry point file paths relative to cwd (default: ['src/index.ts']).
 * @param options.cwd - The workspace root directory (default: process.cwd()).
 */
async function buildLibrary({ entryPoints = ['src/index.ts'], cwd = process.cwd() } = {}) {
    const base = baseOptions(entryPoints, cwd);
    const browserTargets = getBrowserTargets();

    await Promise.all([
        esbuild.build({
            ...base,
            outdir: resolve(cwd, 'dist/browser'),
            platform: 'browser',
            target: browserTargets,
        }),
        esbuild.build({
            ...base,
            outdir: resolve(cwd, 'dist/node'),
            platform: 'node',
            target: ['node22'],
        }),
    ]);
}

const cwd = process.cwd();
const entryPoints = parseEntryPoints();

buildLibrary({ entryPoints, cwd }).catch((err) => {
    console.error(err);
    process.exit(1);
});
