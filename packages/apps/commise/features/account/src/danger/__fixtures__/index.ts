/**
 * `make*` fixture factories for the account danger-zone tests (CODING_STANDARDS §7). Each accepts a
 * `Partial` override and returns a complete object.
 */
import type { DonatableRecipe } from '../model.js';

/**
 * Build a {@link DonatableRecipe} for the donate election, with sensible defaults.
 *
 * @param overrides - Fields to override on the default recipe.
 * @returns A complete donatable recipe.
 */
export function makeDonatableRecipe(overrides: Partial<DonatableRecipe> = {}): DonatableRecipe {
    return {
        id: 'rec-1',
        title: 'Weeknight Ramen',
        ...overrides,
    };
}
