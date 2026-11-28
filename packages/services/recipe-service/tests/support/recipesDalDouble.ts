import type { ProviderDouble } from '@kitchensink/service-test-harness';

import type { RecipesDal } from '../../src/recipes/dal/recipes.dal.js';
import type { RecipesDalMembers } from '../../src/recipes/__fixtures__/recipesDal.fixture.js';
import { RECIPES_DAL } from '../../src/recipes/recipes.tokens.js';

/**
 * The ONE way an integration suite provides `RECIPES_DAL`. `bootServiceApp` types `useValue` as `unknown`, so a plain
 * provider literal is never checked against the DAL; this puts the type at the hand-over. Each member is checked
 * against
 * `RecipesDal`'s own member type, and a member that answers `any` (a bare `vi.fn()`) or is not a DAL member is a
 * compile
 * error, however it reaches the call (see `RecipesDalMembers`).
 *
 * @param members - The DAL members the suite answers; the rest are absent, so a call to one fails loudly.
 * @returns The provider double for the `RECIPES_DAL` token.
 */
export function recipesDalDouble<M extends Partial<RecipesDal> & RecipesDalMembers<M>>(members: M): ProviderDouble {
    return { provide: RECIPES_DAL, useValue: members };
}
