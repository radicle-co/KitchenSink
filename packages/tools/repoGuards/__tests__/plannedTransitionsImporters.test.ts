/**
 * PLANNED edges are not enforced, so nothing at runtime may read them (docs/architecture/recipeStateModel.md 5). The one
 * reader is the doc generator. The list is a subpath export of recipe-core and not part of its root entry, so a read
 * names the subpath or a relative path to `plannedTransitions.ts`. This guard parses every tracked source with the house
 * scanner (`workspaceSourceScan.ts`) and finds both.
 *
 * Allowed readers: `packages/tools/recipeStateDoc/**` and test files (`__tests__/`, `*.test.ts`).
 *
 * ## Mutation evidence
 *
 *   1. The predicate ignoring relative specifiers (`spec.startsWith('.')` made `false`) -> the unit case that feeds it a
 *      non-test recipe-core module importing `./recipeState/plannedTransitions.js` goes red (run seen red, then restored).
 *   2. `export { PLANNED } from './plannedTransitions.js';` added to `recipeState.ts` -> the repo-wide case reports that
 *      file (run seen red, then removed).
 */
import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

import { describe, expect, it } from 'vitest';

import recipeCorePackage from '../../../shared/recipe-core/package.json' with { type: 'json' };
import { repoRoot } from './serviceSources.js';
import { isSource, moduleSpecifiers, trackedPackageFiles } from './workspaceSourceScan.js';

const SUBPATH = '@kitchensink/recipe-core/recipe-state/planned';
const PLANNED_MODULE = 'packages/shared/recipe-core/src/recipeState/plannedTransitions';
const GENERATOR = 'packages/tools/recipeStateDoc/';
const SOURCE_EXTENSION = /\.[cm]?[jt]sx?$/u;

const isTestFile = (file: string): boolean => file.includes('/__tests__/') || /\.test\.[cm]?[jt]sx?$/u.test(file);

/**
 * @param file - Repo-relative path of a source file.
 * @param text - Its source.
 * @returns True when it imports or re-exports the planned transitions, by the subpath or by a relative path. Pure.
 */
function readsPlanned(file: string, text: string): boolean {
    return moduleSpecifiers(file, text).some(
        (spec) =>
            spec === SUBPATH ||
            (spec.startsWith('.') &&
                posix.join(posix.dirname(file), spec).replace(SOURCE_EXTENSION, '') === PLANNED_MODULE),
    );
}

/** @sideEffect Reads the file. */
const readsPlannedInRepo = (file: string): boolean => readsPlanned(file, readFileSync(join(repoRoot, file), 'utf8'));

describe('readsPlanned', () => {
    const CORE_MODULE = 'packages/shared/recipe-core/src/recipeState/recipeState.ts';

    it.each([
        ['a sibling re-export', CORE_MODULE, "export { PLANNED } from './plannedTransitions.js';"],
        [
            'a relative import from another folder of recipe-core',
            'packages/shared/recipe-core/src/sourceRules.ts',
            "import { PLANNED } from './recipeState/plannedTransitions.js';",
        ],
        ['the subpath', 'packages/apps/commise/web/src/x.ts', `import { PLANNED } from '${SUBPATH}';`],
    ])('finds %s', (_label, file, text) => {
        expect(readsPlanned(file, text)).toBe(true);
    });

    it('does not mistake another module for it', () => {
        expect(readsPlanned(CORE_MODULE, "export { TRANSITIONS } from './transitions.js';")).toBe(false);
        expect(readsPlanned(CORE_MODULE, "// export { PLANNED } from './plannedTransitions.js';")).toBe(false);
    });
});

describe('the planned transitions subpath', () => {
    it('is read only by the recipe state doc generator and by tests', () => {
        const readers = trackedPackageFiles()
            .filter(isSource)
            .filter((file) => file !== `${PLANNED_MODULE}.ts`)
            .filter((file) => !isTestFile(file))
            .filter((file) => !file.startsWith(GENERATOR))
            .filter((file) => readsPlannedInRepo(file));

        expect(readers).toEqual([]);
    });

    it('is read by the generator, so the scan above is looking at the right files', () => {
        expect(
            trackedPackageFiles()
                .filter(isSource)
                .filter((file) => file.startsWith(GENERATOR))
                .filter((file) => readsPlannedInRepo(file)).length,
        ).toBeGreaterThan(0);
    });

    it('is declared as a subpath export', () => {
        expect(recipeCorePackage.exports['./recipe-state/planned']).toBe('./src/recipeState/plannedTransitions.ts');
    });
});
