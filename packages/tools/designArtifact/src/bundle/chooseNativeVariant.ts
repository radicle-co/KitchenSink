/**
 * @module bundle/chooseNativeVariant — the pure decision behind the native build's "native first" resolution:
 * when the mobile app imports `Chip`, Metro serves `Chip.native.tsx` if it exists. esbuild does not know that,
 * so this decides it for the plugin, given the filesystem as a function.
 *
 * @pattern Strategy — a pure policy the esbuild plugin consults; the filesystem is injected so the rules are
 * a fixture table rather than a directory fixture.
 */
import { COMMISE_ROOT } from '../config.js';

const SOURCE_EXTENSION = /\.(?:web\.)?(?:tsx|ts|js|jsx)$/u;
const NATIVE_EXTENSIONS = ['.native.tsx', '.native.ts'] as const;

function isInside(path: string, root: string): boolean {
    return path.startsWith(`${root}/`) && !path.includes('/node_modules/');
}

/**
 * The file the native build should load for an import.
 *
 * Applies only when BOTH the importer and the resolved target are inside the Commise tree and neither is under
 * `node_modules`: a library's own import graph must resolve as the library wrote it.
 *
 * @param importer - Absolute path of the importing file.
 * @param resolved - Absolute path esbuild resolved the import to.
 * @param exists - Whether a file exists.
 * @param root - The Commise tree root; defaults to the real one.
 * @returns The `.native.tsx` / `.native.ts` sibling when one exists, else `resolved` unchanged.
 */
export function chooseNativeVariant(
    importer: string,
    resolved: string,
    exists: (path: string) => boolean,
    root: string = COMMISE_ROOT,
): string {
    if (!isInside(importer, root) || !isInside(resolved, root) || !SOURCE_EXTENSION.test(resolved)) {
        return resolved;
    }

    const base = resolved.replace(SOURCE_EXTENSION, '');

    if (base.endsWith('.native')) {
        return resolved;
    }

    for (const extension of NATIVE_EXTENSIONS) {
        if (exists(`${base}${extension}`)) {
            return `${base}${extension}`;
        }
    }

    return resolved;
}
