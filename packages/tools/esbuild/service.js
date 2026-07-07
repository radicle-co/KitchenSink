/**
 * esbuild configuration for Lambda service packages.
 *
 * Builds a node-only ESM bundle for server-side execution.
 *
 * Output structure:
 *   dist/ — Node-targeted ESM bundle
 *
 * Usage:
 *   node --import=tsx node_modules/@commise/tools-esbuild/service.js [--entry src/handler.ts]
 *
 * @module @commise/tools-esbuild/service
 *
 * @requirements
 * 1. Must build a node-only ESM bundle.
 * 2. Must externalize all dependencies (no bundling of node_modules).
 * 3. Must generate source maps for all builds.
 * 4. Must support multiple entry points via --entry CLI flags.
 * 5. Must default to src/handler.ts when no entry points are specified.
 */

import * as esbuild from 'esbuild';
import { resolve } from 'node:path';
import { baseOptions, parseEntryPoints } from './base.js';

/**
 * Builds a node-only bundle for a Lambda service package.
 *
 * @param options - Build configuration.
 * @param options.entryPoints - Entry point file paths relative to cwd (default: ['src/handler.ts']).
 * @param options.cwd - The workspace root directory (default: process.cwd()).
 */
async function buildService({ entryPoints = ['src/handler.ts'], cwd = process.cwd() } = {}) {
    const base = baseOptions(entryPoints, cwd);

    await esbuild.build({
        ...base,
        outdir: resolve(cwd, 'dist'),
        platform: 'node',
        target: ['node22'],
        packages: 'external',
    });
}

const cwd = process.cwd();
const entryPoints = parseEntryPoints();

buildService({ entryPoints, cwd }).catch((err) => {
    console.error(err);
    process.exit(1);
});
