/**
 * Shared esbuild utilities for the KitchenSink monorepo.
 *
 * Provides common build configuration: dependency externalization,
 * browserslist target resolution, and base esbuild options.
 *
 * @module @commise/tools-esbuild/base
 *
 * @requirements
 * 1. Must read workspace package.json and return all dependency names to externalize.
 * 2. Must resolve browser targets from the project's browserslist config.
 * 3. Must provide base esbuild options shared by library and service builds.
 * 4. Must parse --entry CLI flags into entry points array.
 */

import browserslistToEsbuild from 'browserslist-to-esbuild';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Reads the package.json from the calling workspace and returns
 * all dependency names (dependencies + peerDependencies + devDependencies)
 * to externalize.
 *
 * @param cwd - The workspace root directory.
 * @returns Array of package names to mark as external.
 */
export function getExternalDeps(cwd) {
    const pkgPath = resolve(cwd, 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    return [
        ...Object.keys(pkg.dependencies ?? {}),
        ...Object.keys(pkg.peerDependencies ?? {}),
        ...Object.keys(pkg.devDependencies ?? {}),
    ];
}

/**
 * Resolves browserslist targets to esbuild-compatible target strings.
 *
 * @returns Array of esbuild target strings (e.g., ['chrome120', 'firefox115']).
 */
export function getBrowserTargets() {
    return browserslistToEsbuild();
}

/**
 * Shared esbuild options common to all builds.
 *
 * @param entryPoints - Entry point file paths relative to cwd.
 * @param cwd - The workspace root directory.
 * @returns Base esbuild build options.
 */
export function baseOptions(entryPoints, cwd) {
    return {
        entryPoints: entryPoints.map((e) => resolve(cwd, e)),
        bundle: true,
        format: 'esm',
        sourcemap: true,
        external: getExternalDeps(cwd),
        logLevel: 'info',
    };
}

/**
 * Parses entry points from the ESBUILD_ENTRIES environment variable
 * or --entry flags from process.argv.
 *
 * The environment variable takes precedence: set ESBUILD_ENTRIES to a
 * comma-separated list of entry point paths (e.g., "src/index.ts,src/system.ts").
 *
 * Falls back to --entry CLI flags if the environment variable is not set.
 * Returns undefined if no entry points are found, allowing callers
 * to fall back to their default entry points.
 *
 * @returns Array of entry point paths, or undefined if none specified.
 */
export function parseEntryPoints() {
    const envEntries = process.env.ESBUILD_ENTRIES;
    if (envEntries) {
        return envEntries
            .split(',')
            .map((e) => e.trim())
            .filter(Boolean);
    }

    const args = process.argv.slice(2);
    const entryPoints = [];

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--entry' && args[i + 1]) {
            entryPoints.push(args[i + 1]);
            i++;
        }
    }

    return entryPoints.length > 0 ? entryPoints : undefined;
}
