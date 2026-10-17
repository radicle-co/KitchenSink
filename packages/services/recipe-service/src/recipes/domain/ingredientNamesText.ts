/**
 * The denormalized `recipes.ingredient_names_text` search column, built from the names the recipe's lines have.
 *
 * The names come from each line's identity (plan 002 R10), never from the request body: indexing a client's
 * string would let a client index a recipe under arbitrary text, and would let the index disagree with the name
 * the recipe shows. A line with no name to show — food unreachable at save, or a food the saving cook may not
 * see — contributes nothing, so the column is degraded rather than wrong until the next save.
 *
 * ⛔ It indexes {@link shareableLineNameOf}, so a PRIVATE food adds nothing even when its author is saving: every
 * reader of the recipe can search this column, and indexing the name would let a stranger find it by searching.
 *
 * @pattern Pure function over the line identities
 */
import { shareableLineNameOf, type IngredientLineIdentity } from '../../ingredients/domain/ingredientLineIdentity.js';

/**
 * Space-join the lines' names in line order. A line whose binding has no identity adds nothing.
 *
 * @param lookupIds - Each line's binding id, in author order.
 * @param identities - The identity of each binding, by id.
 * @returns The search text. Pure.
 */
export function ingredientNamesText(
    lookupIds: readonly string[],
    identities: ReadonlyMap<string, IngredientLineIdentity>,
): string {
    return lookupIds
        .map((id) => {
            const identity = identities.get(id);

            return identity === undefined ? '' : (shareableLineNameOf(identity)?.trim() ?? '');
        })
        .filter((name) => name.length > 0)
        .join(' ');
}
