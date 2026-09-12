/**
 * @module @kitchensink/docgen-components/discovery — finds the `.tsx` files a group documents.
 *
 * The predicate is separated from the walk so it can be unit-tested without a filesystem: what a reader
 * needs to trust is WHICH files are in and out, not that `readdir` works.
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Directories that hold test scaffolding or build output, never a documented component. */
const EXCLUDED_DIRECTORIES = new Set([
    '__fixtures__',
    '__mocks__',
    '__tests__',
    '.next',
    '.turbo',
    'dist',
    'node_modules',
    'test-utils',
    'tests',
]);

/**
 * Whether a directory is walked.
 *
 * @param name - The directory's basename.
 * @returns Whether to descend into it.
 */
export function isDocumentedDirectory(name: string): boolean {
    return !EXCLUDED_DIRECTORIES.has(name);
}

/**
 * Whether a file is a documented component source.
 *
 * `.test.tsx` and `.spec.tsx` are excluded by SUFFIX as well as by directory, because a test living beside
 * its subject is a shape this repository uses and a directory-only filter would document it.
 *
 * @param name - The file's basename.
 * @returns Whether it is documented.
 */
export function isDocumentedComponentFile(name: string): boolean {
    if (!name.endsWith('.tsx')) {
        return false;
    }

    return !/\.(?:test|spec|stories)\.tsx$/.test(name);
}

/**
 * Every documented component file under a path, which may be a directory or a single file.
 *
 * @param root - Absolute path to walk.
 * @returns Absolute file paths, sorted, so the emitted catalogue does not depend on directory order.
 * @sideEffect Reads directory entries from disk.
 */
export function discoverComponentFiles(root: string): readonly string[] {
    const found: string[] = [];

    const walk = (current: string): void => {
        const stats = statSync(current);

        if (!stats.isDirectory()) {
            const name = current.slice(current.lastIndexOf('/') + 1);

            if (isDocumentedComponentFile(name)) {
                found.push(current);
            }

            return;
        }

        for (const entry of readdirSync(current, { withFileTypes: true })) {
            if (entry.isDirectory()) {
                if (isDocumentedDirectory(entry.name)) {
                    walk(join(current, entry.name));
                }
            } else if (isDocumentedComponentFile(entry.name)) {
                found.push(join(current, entry.name));
            }
        }
    };

    walk(root);

    return found.sort();
}
