/**
 * `@commise/features-recipes` never depends on `@commise/features-cooking`.
 *
 * ⛔ WHY THIS GUARD EXISTS. The edge runs one way. Cooking mode takes its ingredient row, its servings stepper and its
 * marks from the recipe page through the `./cook` subpath, so it shows the same row and the same numbers. If the recipe
 * page imported cooking mode back, the two packages would form a cycle and a change to either would rebuild both.
 *
 * ⛔ IT CHECKS THE MANIFEST ONLY, because that is enough. `workspaceImportsDeclared` fails any import of a workspace
 * package that the importing package's manifest does not declare, test files and `vi.mock` arguments included. So while
 * the recipes manifest does not declare `@commise/features-cooking`, no recipes file can name it.
 *
 * ✅ THE FIX FOR A FAILURE: move what both packages need into the recipes feature's `./cook` surface or into a shared
 * package, and let cooking mode import it from there.
 */
import { describe, expect, it } from 'vitest';

import { declaredDependencies } from './workspaceSourceScan.js';

const RECIPES_ROOT = 'packages/apps/commise/features/recipes';

describe('the recipes feature package', () => {
    it('declares @commise/features-cooking in no dependency field', () => {
        expect(declaredDependencies(RECIPES_ROOT).has('@commise/features-cooking')).toBe(false);
    });
});
