// @vitest-environment node
/**
 * A subpath a SERVICE imports must exist in the shared package's IMAGE manifest, not just its workspace one.
 *
 * ## Why this is invisible without a gate
 *
 * A shared package carries two manifests. `package.json` maps subpaths to `./src/*.ts` and is what the
 * workspace, `tsc` and vitest resolve against. `prod.package.json` maps them to `./dist/*.js` and is what
 * gets copied into the service's Docker image. Nothing keeps them in step, and the divergence is silent in
 * every local signal: typecheck passes, unit tests pass, integration tests pass, lint passes. The failure
 * appears only when a container boots and Node throws `ERR_PACKAGE_PATH_NOT_EXPORTED`.
 *
 * Measured on 2026-08-21. Two units running in parallel worktrees each added a `recipe-core` subpath —
 * `food-name` and `ingredient-quantity` — because the barrel is inside recipe-service's contract fingerprint
 * and adding to it moves `CONTRACT_HASH`. Both updated `package.json`; neither knew `prod.package.json`
 * existed. `sanitizeFoodName` sits on food-service's live write path, so all three heavy CI tiers failed at
 * "Boot service (Docker)" while every workspace check was green.
 *
 * The workspace manifest had 7 subpaths against the image manifest's 2 at that moment, and only one of the
 * five was a real defect: `scaling` and `external-url` are imported solely by `packages/apps/commise`, which
 * Next and Expo bundle rather than resolving at runtime in a service image, and `testing` is dev-only. So the
 * invariant is NOT "the two manifests must match" — that would demand dead entries and get relaxed the first
 * time someone hit it. It is narrower and true: **what a service imports, the image must export.**
 *
 * ⚠️ Test sources are excluded deliberately. A test may legitimately import a dev-only subpath (`./testing`)
 * that must never ship, so including them would force exactly the dead entries this gate exists to avoid.
 *
 * DESIGN PATTERN: Specification module over a pure predicate — {@link subpathImportsIn} is a pure verdict
 * over one file's text, fired at deliberately-violating fakes below as well as at the working tree.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { presentFiles, repoRoot } from './serviceSources.js';

/** Deployable services — the packages whose sources are copied into an image. */
const SERVICES_ROOT = 'packages/services';

/** Where a shared package's image manifest lives, relative to the package root. */
const IMAGE_MANIFEST = 'prod.package.json';

/** One `@scope/pkg/subpath` import found in a service's production source. */
interface SubpathImport {
    /** Repo-relative path of the importing file. */
    readonly file: string;
    /** The imported package, e.g. `@kitchensink/recipe-core`. */
    readonly packageName: string;
    /** The subpath as the exports map spells it, e.g. `./food-name`. */
    readonly subpath: string;
}

/**
 * Every scoped subpath import in one source file.
 *
 * Reads the module specifier out of `import`/`export … from` and `import(...)`, so a package name mentioned
 * in a comment or a docstring is not counted.
 *
 * @param file - Repo-relative path.
 * @param contents - The file's text.
 * @returns The subpath imports found. Pure.
 */
function subpathImportsIn(file: string, contents: string): readonly SubpathImport[] {
    const specifiers = [...contents.matchAll(/(?:from|import)\s*\(?\s*['"](@[^'"]+)['"]/gu)].map(
        (match) => match[1] ?? '',
    );

    return specifiers.flatMap((specifier) => {
        const segments = specifier.split('/');
        const [scope = '', name = '', ...rest] = segments;

        return rest.length === 0 ? [] : [{ file, packageName: `${scope}/${name}`, subpath: `./${rest.join('/')}` }];
    });
}

/**
 * A shared package's image-manifest export keys, or `undefined` when it ships no image manifest.
 *
 * A package without one is not imaged from source and is out of scope.
 *
 * @param packageName - The scoped package name.
 * @returns The exported subpath keys, or `undefined`. Impure.
 * @sideEffect Reads the working tree.
 */
function imageExports(packageName: string): ReadonlySet<string> | undefined {
    const directory = packageName.replace(/^@[^/]+\//u, '');

    for (const group of ['shared', 'clients']) {
        const manifest = path.join(repoRoot, 'packages', group, directory, IMAGE_MANIFEST);

        if (existsSync(manifest)) {
            const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { exports?: Record<string, unknown> };

            return new Set(Object.keys(parsed.exports ?? {}));
        }
    }

    return undefined;
}

/**
 * Production sources of every deployable service.
 *
 * @returns Repo-relative path and contents. Impure.
 * @sideEffect Shells out to git and reads the working tree.
 */
function serviceSources(): readonly { readonly file: string; readonly contents: string }[] {
    return presentFiles([SERVICES_ROOT])
        .filter((file) => /\/src\/.*\.tsx?$/u.test(file))
        .filter((file) => !/__tests__|__fixtures__|\.test\.|\.spec\./u.test(file))
        .map((file) => ({ file, contents: readFileSync(path.join(repoRoot, file), 'utf8') }));
}

describe('image subpath exports', () => {
    it('every subpath a service imports is exported by the shared package image manifest', () => {
        const missing = serviceSources()
            .flatMap(({ file, contents }) => subpathImportsIn(file, contents))
            .filter(({ packageName, subpath }) => imageExports(packageName)?.has(subpath) === false)
            .map(({ file, packageName, subpath }) => `${file} imports ${packageName}${subpath.slice(1)}`);

        expect(
            [...new Set(missing)].sort(),
            'A subpath missing from `prod.package.json` resolves in the workspace and throws ' +
                'ERR_PACKAGE_PATH_NOT_EXPORTED when the container boots. Every local check stays green.',
        ).toEqual([]);
    });

    it('reads a specifier from an import but not from prose that names one', () => {
        const contents = [
            "import { a } from '@kitchensink/recipe-core/food-name';",
            "export { b } from '@kitchensink/recipe-core/scaling';",
            '// see @kitchensink/recipe-core/testing for the harness',
            "import bare from '@kitchensink/recipe-core';",
        ].join('\n');

        expect(subpathImportsIn('fake/x.ts', contents).map(({ subpath }) => subpath)).toEqual([
            './food-name',
            './scaling',
        ]);
    });

    it('treats a package with no image manifest as out of scope', () => {
        expect(imageExports('@kitchensink/definitely-not-a-package')).toBeUndefined();
    });
});
