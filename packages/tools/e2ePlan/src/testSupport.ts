/**
 * Test support: code that exists to serve tests, such as a package's `testing` exports and `__fixtures__` folders.
 *
 * A path never makes a file test support. A file is only a CANDIDATE by where it lives, and becomes test support when
 * the import graphs PROVE that no file that ships imports it (`repoModels`). One shipping import turns it back into
 * an ordinary file. The zero-list guard fails CI if a shipping file imports a candidate, so the proof is also a rule.
 */
import { dirname, join } from 'node:path';

import type { WorkspacePackage } from './workspaces.js';

const TESTING_EXPORT = /(^|\/)testing(\/|$)/u;

const targetOf = (entry: unknown): string | undefined => {
    if (typeof entry === 'string') {
        return entry;
    }

    const record = typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : {};
    const picked = record['import'] ?? record['default'];

    return typeof picked === 'string' ? picked : undefined;
};

/**
 * The folders that hold what the workspace packages export under a `testing` name.
 *
 * @param packages - Every workspace package.
 * @returns Repo-relative folders, sorted, each once.
 */
export function testingDirs(packages: readonly WorkspacePackage[]): readonly string[] {
    const exported = (entry: WorkspacePackage): Readonly<Record<string, unknown>> =>
        typeof entry.exports === 'object' && entry.exports !== null ? (entry.exports as Record<string, unknown>) : {};

    return [
        ...new Set(
            packages.flatMap((entry) =>
                Object.entries(exported(entry)).flatMap(([key, value]) => {
                    const target = targetOf(value);

                    return TESTING_EXPORT.test(key) && target !== undefined
                        ? [join(entry.dir, dirname(target.replace('./dist/', './src/')))]
                        : [];
                }),
            ),
        ),
    ].sort();
}

/**
 * Whether a file lives where test support lives.
 *
 * @param file - Repo-relative path.
 * @param dirs - {@link testingDirs}.
 * @returns True for a candidate. It is not yet proven: see the module note.
 */
export const isTestSupportCandidate = (file: string, dirs: readonly string[]): boolean =>
    file.includes('/__fixtures__/') || dirs.some((dir) => file.startsWith(`${dir}/`));
