/**
 * `@commise/features-recipes` never imports `@commise/features-cooking`, asserted by DISCOVERY, never by a list.
 *
 * ⛔ WHY THIS GUARD EXISTS. The edge runs one way. Cooking mode takes its ingredient row, its servings stepper and its
 * marks from the recipe page through the `./cook` subpath, so it shows the same row and the same numbers. If the recipe
 * page imported cooking mode back, the two packages would form a cycle and a change to either would rebuild both.
 * Nothing but a reviewer would notice the reverse edge being added.
 *
 * ⛔ IT ENUMERATES NOTHING. Candidates come from the FILESYSTEM: every source file under the recipes feature's `src`,
 * test files included, because a test that builds its subject from cooking mode still ties the packages together.
 * A string literal is checked rather than an import declaration, so `vi.mock('@commise/features-cooking/web')` and
 * `import('@commise/features-cooking')` are caught too, and a comment that merely NAMES the package is not. The
 * package manifest is checked as well, because a dependency entry is the same edge declared in JSON.
 *
 * ✅ THE FIX FOR A FAILURE: move what both packages need into the recipes feature's `./cook` surface or into a shared
 * package, and let cooking mode import it from there.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { globSync } from 'glob';
import { describe, expect, it } from 'vitest';

import { repoRoot, stringLiterals } from './serviceSources.js';

const COOKING_PACKAGE = /^@commise\/features-cooking(\/|$)/u;
const RECIPES_ROOT = 'packages/apps/commise/features/recipes';
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const;

/** Whether a source file names `@commise/features-cooking` (or a sub-path of it) in a string literal. */
const reachesCookingPackage = (source: string): boolean =>
    stringLiterals({ file: 'fixture.ts', contents: source }).some((literal) => COOKING_PACKAGE.test(literal));

/** Whether a package manifest declares `@commise/features-cooking` in any dependency field. */
const declaresCookingPackage = (manifestJson: string): boolean => {
    const manifest = JSON.parse(manifestJson) as Partial<Record<(typeof DEPENDENCY_FIELDS)[number], object>>;

    return DEPENDENCY_FIELDS.some((field) =>
        Object.keys(manifest[field] ?? {}).some((name) => COOKING_PACKAGE.test(name)),
    );
};

const recipesSourceFiles = (): readonly string[] =>
    globSync(`${RECIPES_ROOT}/src/**/*.{ts,tsx}`, {
        cwd: repoRoot,
        ignore: ['**/node_modules/**', '**/dist/**'],
    }).sort();

describe('the source detector', () => {
    const cases: readonly (readonly [string, string, boolean])[] = [
        ['a named import', "import { CookingRoute } from '@commise/features-cooking/web';", true],
        ['a type-only import', "import type { CookingRecipe } from '@commise/features-cooking';", true],
        ['a re-export', "export { CookingRoute } from '@commise/features-cooking/web';", true],
        ['a test mock', "vi.mock('@commise/features-cooking/native', () => ({}));", true],
        ['a dynamic import', "const m = await import('@commise/features-cooking');", true],
        [
            'a comment that names it',
            "// @commise/features-cooking is not imported here\nimport { a } from './a.js';",
            false,
        ],
        ['a doc block that names it', '/** `@commise/features-cooking`’s route */\nexport const a = 1;', false],
        ['a sibling package with the prefix', "import { z } from '@commise/features-cookingx';", false],
        ['an unrelated package', "import { z } from '@commise/features-recipes/cook';", false],
    ];

    it.each(cases)('%s', (_name, source, expected) => {
        expect(reachesCookingPackage(source)).toBe(expected);
    });
});

describe('the manifest detector', () => {
    const cases: readonly (readonly [string, string, boolean])[] = [
        ['a dependency', '{"dependencies":{"@commise/features-cooking":"*"}}', true],
        ['a dev dependency', '{"devDependencies":{"@commise/features-cooking":"*"}}', true],
        ['a peer dependency', '{"peerDependencies":{"@commise/features-cooking":"*"}}', true],
        ['a sibling package with the prefix', '{"dependencies":{"@commise/features-cookingx":"*"}}', false],
        ['an unrelated dependency', '{"dependencies":{"@commise/features-core":"*"}}', false],
        ['no dependency fields', '{"name":"x"}', false],
    ];

    it.each(cases)('%s', (_name, manifestJson, expected) => {
        expect(declaresCookingPackage(manifestJson)).toBe(expected);
    });
});

describe('the recipes feature package', () => {
    it('discovers its sources (a vacuous pass would hide the rule below)', () => {
        expect(recipesSourceFiles().length).toBeGreaterThan(100);
    });

    it('imports @commise/features-cooking nowhere', () => {
        const offenders = recipesSourceFiles().filter((file) =>
            reachesCookingPackage(readFileSync(path.join(repoRoot, file), 'utf8')),
        );

        expect(offenders).toEqual([]);
    });

    it('declares @commise/features-cooking in no dependency field', () => {
        expect(declaresCookingPackage(readFileSync(path.join(repoRoot, RECIPES_ROOT, 'package.json'), 'utf8'))).toBe(
            false,
        );
    });
});
