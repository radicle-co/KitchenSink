// @vitest-environment node
/**
 * A package whose `format:check` runs `prettier --check .` and whose build emits `dist/` must carry its own
 * `.prettierignore` naming `dist`.
 *
 * ## The defect this was written for
 *
 * Prettier resolves `.prettierignore` from its working directory, and turbo runs each package's `format:check` with
 * the PACKAGE as the working directory, so the root `.prettierignore` (which does name `dist`) never applies. A
 * package without its own file passes on a clean checkout and fails the moment a build has run: `@kitchensink/sync`
 * went red on its emitted `dist/` files that way. `retry-after`, `queue-check` and others already carry the file;
 * nothing required the next package to.
 *
 * DESIGN PATTERN: Specification module over a pure predicate — {@link packagesMissingDistIgnore} is a verdict over
 * plain data, fired at a deliberately-violating fake as well as at the tracked tree.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { repoRoot } from './serviceSources.js';

/** One package, as this gate reads it. */
interface PackageFacts {
    /** Repo-relative directory. */
    readonly directory: string;
    /** Its `format:check` script, if any. */
    readonly formatCheck: string | undefined;
    /** Whether a tracked `tsconfig.build.json` sends the build to `dist`. */
    readonly buildsToDist: boolean;
    /** The lines of its own `.prettierignore`, or undefined when it has none. */
    readonly ignoreLines: readonly string[] | undefined;
}

/**
 * The directories of packages that would fail `format:check` on emitted output. Pure.
 *
 * @param packages - Every package's facts.
 * @returns The directories whose `prettier --check .` reads a `dist/` it does not ignore.
 */
export function packagesMissingDistIgnore(packages: readonly PackageFacts[]): readonly string[] {
    return packages
        .filter(
            ({ formatCheck, buildsToDist, ignoreLines }) =>
                buildsToDist &&
                formatCheck !== undefined &&
                /prettier --check \.$/u.test(formatCheck) &&
                !(ignoreLines ?? []).some((line) => line.trim() === 'dist'),
        )
        .map(({ directory }) => directory);
}

/** Tracked files, from the index (a new file must be staged before a local guard run). */
function tracked(pattern: string): readonly string[] {
    return execFileSync('git', ['ls-files', '--', pattern], { cwd: repoRoot, encoding: 'utf8' })
        .split('\n')
        .filter((file) => file !== '');
}

/** Read every tracked workspace package's facts. */
function discover(): readonly PackageFacts[] {
    const trackedSet = new Set(tracked('*'));

    return tracked('*package.json')
        .filter((file) => file !== 'package.json' && !file.includes('node_modules/'))
        .map((file) => {
            const directory = path.dirname(file);
            const manifest = JSON.parse(readFileSync(path.join(repoRoot, file), 'utf8')) as {
                scripts?: Record<string, string>;
            };
            const ignoreFile = path.posix.join(directory, '.prettierignore');

            return {
                directory,
                formatCheck: manifest.scripts?.['format:check'],
                buildsToDist: trackedSet.has(path.posix.join(directory, 'tsconfig.build.json')),
                ignoreLines: trackedSet.has(ignoreFile)
                    ? readFileSync(path.join(repoRoot, ignoreFile), 'utf8').split('\n')
                    : undefined,
            };
        });
}

describe('every package that formats its own directory ignores its build output', () => {
    it('names a violator when the package has no .prettierignore', () => {
        expect(
            packagesMissingDistIgnore([
                {
                    directory: 'packages/shared/fake',
                    formatCheck: 'prettier --check .',
                    buildsToDist: true,
                    ignoreLines: undefined,
                },
            ]),
        ).toEqual(['packages/shared/fake']);
    });

    it('names a violator whose .prettierignore does not list dist', () => {
        expect(
            packagesMissingDistIgnore([
                {
                    directory: 'packages/shared/fake',
                    formatCheck: 'prettier --check .',
                    buildsToDist: true,
                    ignoreLines: ['coverage'],
                },
            ]),
        ).toEqual(['packages/shared/fake']);
    });

    it('passes a package that lists dist, and one that emits nothing', () => {
        expect(
            packagesMissingDistIgnore([
                {
                    directory: 'a',
                    formatCheck: 'prettier --check .',
                    buildsToDist: true,
                    ignoreLines: ['# build output', 'dist'],
                },
                { directory: 'b', formatCheck: 'prettier --check .', buildsToDist: false, ignoreLines: undefined },
            ]),
        ).toEqual([]);
    });

    it('holds for every tracked package', () => {
        const packages = discover();

        // The guard must see packages, or an empty discovery would pass for the wrong reason.
        expect(packages.filter(({ buildsToDist }) => buildsToDist).length).toBeGreaterThan(5);
        expect(packagesMissingDistIgnore(packages)).toEqual([]);
    });
});
