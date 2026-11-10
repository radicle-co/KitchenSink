/**
 * The denormalized `recipes.ingredient_names_text` search column, built from the names the recipe's lines have.
 *
 * The names come from each line's identity (plan 002 R10), never from the request body: indexing a client's
 * string would let a client index a recipe under arbitrary text, and would let the index disagree with the name
 * the recipe shows. A line with no name to show — food unreachable at save, or a food the saving cook may not
 * see — contributes nothing, so the column is degraded rather than wrong until the next save.
 *
 * It also indexes each line's own `display_text`, so a recipe is found by the cook's words.
 *
 * ⛔ It indexes {@link shareableLineNameOf}, so a PRIVATE food adds nothing even when its author is saving: every
 * reader of the recipe can search this column, and indexing the name would let a stranger find it by searching.
 *
 * @pattern Pure function over the line identities
 */
import { shareableLineNameOf, type IngredientLineIdentity } from '../../ingredients/domain/ingredientLineIdentity.js';

/** The part of a line the search text reads: its binding, and the words the cook wrote on it. */
export interface NamedLine {
    readonly foodLookupId: string;
    readonly displayText?: string | null | undefined;
}

/**
 * Space-join, in line order, each line's name and then the words the cook wrote on it. A line whose binding has no
 * identity adds only its own words. The cook's words (`display_text`) belong to the recipe line, so they are as
 * visible as the recipe; only a private food's NAME is withheld.
 *
 * @param lines - The lines, in author order.
 * @param identities - The identity of each binding, by id.
 * @returns The search text. Pure.
 */
export function ingredientNamesText(
    lines: readonly NamedLine[],
    identities: ReadonlyMap<string, IngredientLineIdentity>,
): string {
    return lines
        .flatMap((line) => {
            const identity = identities.get(line.foodLookupId);

            return [identity === undefined ? '' : shareableLineNameOf(identity), line.displayText].map(
                (part) => part?.trim() ?? '',
            );
        })
        .filter((part) => part.length > 0)
        .join(' ');
}
