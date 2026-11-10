/**
 * The pure public-foods policy: may a recipe in this state hold these lines? (ADR-0029 §4; owner rulings 2026-11-08).
 *
 * A private food may be used only in a private recipe. So a recipe that is PUBLISHED and PUBLIC holds no line bound to a
 * private food, and every write that would leave one so is refused, naming the lines. A recipe in review is public for
 * this purpose (ADR-0074 makes review a derived state, not a visibility), so it needs no case of its own.
 *
 * The sibling of `evaluateVisibility`, `evaluateProvenance` and `evaluatePublication`: it answers from its inputs alone —
 * no DB, no principal, no I/O — and `RecipesService` judges the state AFTER the write, on every create, update and
 * visibility change. The database holds the same rule (`recipe_holds_private_food` and a constraint trigger, migration
 * 0064), so a write path the service forgets is a rolled-back transaction rather than a leak.
 *
 * @pattern Specification — one pure predicate over the post-write state, the sibling of the visibility, provenance and
 *   publish policies
 */
import { RecipeStatus, RecipeVisibility, type PrivateFoodLine } from '@kitchensink/recipe-core';

/** One root-food line as the policy reads it. */
export interface PublicFoodsLine {
    /** The line's position (its `sort_order`): the key a client marks the line by. */
    readonly sortOrder: number;
    /** The food the line is bound to. */
    readonly foodId: string;
    /** The food's author when it is their private authored food, else `null`. */
    readonly foodOwnerId: string | null;
}

/** The state a write would leave the recipe in. */
export interface PublicFoodsPolicyInput {
    readonly status: RecipeStatus;
    readonly visibility: RecipeVisibility;
    /** The recipe's root-food lines after the write. */
    readonly lines: readonly PublicFoodsLine[];
}

/** The outcome. A denial lists EVERY private line, in line order, and is non-empty by construction. */
export type PublicFoodsDecision =
    | { readonly allowed: true }
    | { readonly allowed: false; readonly lines: readonly [PrivateFoodLine, ...PrivateFoodLine[]] };

/**
 * Evaluate whether a write may leave a recipe in this state. Pure — inputs only.
 *
 * @param input - The status, visibility and root-food lines after the write.
 * @returns An allow, or a denial naming every line bound to a private food.
 */
export function evaluatePublicFoods(input: PublicFoodsPolicyInput): PublicFoodsDecision {
    if (input.status !== RecipeStatus.PUBLISHED || input.visibility !== RecipeVisibility.PUBLIC) {
        return { allowed: true };
    }

    const [first, ...rest] = input.lines
        .filter((line) => line.foodOwnerId !== null)
        .map((line): PrivateFoodLine => ({ sortOrder: line.sortOrder, foodId: line.foodId }))
        .sort((a, b) => a.sortOrder - b.sortOrder);

    return first === undefined ? { allowed: true } : { allowed: false, lines: [first, ...rest] };
}
