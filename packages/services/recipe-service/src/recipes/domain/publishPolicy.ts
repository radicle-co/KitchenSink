/**
 * The pure publish policy: may a recipe be in this state? (owner rulings 2026-10-13).
 *
 * The third sibling of `evaluateProvenance` (what the recipe IS) and `evaluateVisibility` (what visibility that thing
 * may hold). It answers from its inputs alone — no DB, no principal, no I/O — so the whole floor is one total,
 * table-testable function, and it is the ONE statement of what Publish needs:
 *
 * - a **cuisine**, unless the recipe is a public-domain import ({@link requiresCuisine});
 * - at least one **ingredient**;
 * - at least one **step**.
 *
 * A draft needs none of them: a recipe may EXIST empty, which is what a draft is.
 *
 * ## ⛔ Why this is NOT a route Guard, and not a zod refinement
 *
 * `POST`/`PATCH /api/v1/recipes` stay open to every authenticated user (ADR-0023's reasoning for field-level rules).
 * What is gated is the STATE a write leaves: a status together with content, some of which lives only in the stored
 * row. A request body cannot see the stored `sourceType`, cuisine or lines, so a body refinement could only ever be the
 * partial half of the rule — and the four that used to exist fired only when the body said `status: 'published'`,
 * which let a "Save changes" PATCH (no `status`) empty a published recipe. `RecipesService` judges the state AFTER
 * the write, on every create and update.
 *
 * ## ⚠️ Looks wrong, isn't: a CLONE of a public-domain recipe is exempt too
 *
 * The exemption keys on `sourceType`, and a clone keeps its source's. That is deliberate. Lineage cannot be the key:
 * account erasure sets `cloned_from_id = NULL` on every clone of the erased user's recipes, so a rule keyed on lineage
 * would change its answer for a recipe nobody edited. Readers already treat an absent cuisine as "no cuisine", because
 * the corpus itself has none. The app asks every cook for a cuisine on every publish regardless (stricter, never
 * looser), so this is reachable only by another client.
 *
 * @pattern Specification — one pure predicate over the post-write state, the sibling of the provenance and visibility
 *   policies
 * @pattern Visitor — {@link requiresCuisine} is an exhaustive switch over `RecipeSourceType`
 */
import {
    PUBLISH_REQUIREMENTS,
    RecipeSourceType,
    RecipeStatus,
    type PublishRequirement,
} from '@kitchensink/recipe-core';

/** The complete input to a publish decision: the state a write would leave the recipe in. */
export interface PublishPolicyInput {
    /** The status after the write. */
    readonly status: RecipeStatus;
    /** The recipe's provenance (the resolved one on create, the stored one on update). */
    readonly sourceType: RecipeSourceType;
    /** The cuisine after the write, or `null` for none. */
    readonly cuisine: string | null;
    /** The ingredient lines after the write. */
    readonly ingredientCount: number;
    /** The steps after the write. */
    readonly stepCount: number;
}

/**
 * The outcome of a publish decision. A denial lists EVERY missing requirement, in the vocabulary's page order, so a
 * client can mark each one; it is a non-empty tuple, because a denial with nothing missing is not a denial.
 */
export type PublishDecision =
    | { readonly allowed: true; readonly reason: string }
    | {
          readonly allowed: false;
          readonly missing: readonly [PublishRequirement, ...PublishRequirement[]];
          readonly reason: string;
      };

/**
 * Whether a recipe of this provenance needs a cuisine to be published. Only the public-domain cookbook import is exempt
 * (the curator path, ADR-0023): its source books state no cuisine. A physical or paid import is a cook's own copy of a
 * book, and is asked for one like any other recipe. Pure.
 *
 * @param sourceType - The recipe's provenance.
 * @returns `true` unless it is `imported_public`.
 */
export function requiresCuisine(sourceType: RecipeSourceType): boolean {
    switch (sourceType) {
        case RecipeSourceType.IMPORTED_PUBLIC:
            return false;
        case RecipeSourceType.USER_CREATED:
        case RecipeSourceType.IMPORTED_PHYSICAL:
        case RecipeSourceType.IMPORTED_PAID:
            return true;
    }
}

/**
 * Evaluate whether a write may leave a recipe in this state. Pure — inputs only.
 *
 * @param input - The status, provenance and content after the write.
 * @returns An allow, or a denial naming every missing requirement.
 */
export function evaluatePublication(input: PublishPolicyInput): PublishDecision {
    if (input.status !== RecipeStatus.PUBLISHED) {
        return { allowed: true, reason: 'A draft may be saved with anything missing.' };
    }

    const unmet: Readonly<Record<PublishRequirement, boolean>> = {
        cuisine: requiresCuisine(input.sourceType) && (input.cuisine ?? '').trim() === '',
        ingredients: input.ingredientCount === 0,
        steps: input.stepCount === 0,
    };
    const [first, ...rest] = PUBLISH_REQUIREMENTS.filter((requirement) => unmet[requirement]);

    if (first === undefined) {
        return { allowed: true, reason: 'The recipe has everything Publish needs.' };
    }

    const missing: readonly [PublishRequirement, ...PublishRequirement[]] = [first, ...rest];

    return { allowed: false, missing, reason: `A published recipe needs: ${missing.join(', ')}.` };
}
