import { RecipeStatus } from '@kitchensink/recipe-core';

/** What the rule reads about a recipe. An object, so a later requirement (spec 020's "in review") adds one field. */
export interface CookabilityInput {
    /** The recipe's publication status, from the wire type. */
    readonly status: RecipeStatus;
    /** How many steps the recipe has WITH TEXT (see {@link countCookableSteps}). */
    readonly stepCount: number;
}

/**
 * How many steps a cook can cook: those whose text is not empty and not only whitespace (FR-033a). The ONE
 * definition of "a step with text", so the gate, the cook link, the place and Done all count the same steps.
 *
 * @param instructions - The text of each of the recipe's steps, in order.
 * @returns The number of steps with text. Pure.
 */
export function countCookableSteps(instructions: readonly string[]): number {
    return instructions.filter(hasStepText).length;
}

/**
 * Whether a step's text is something a cook can follow: not empty and not only whitespace (FR-033a). The ONE
 * definition, which the count above and the step list both use.
 *
 * @param text - A step's text.
 * @returns `true` when the step has text. Pure.
 */
export function hasStepText(text: string): boolean {
    return text.trim().length > 0;
}

/**
 * Whether a cook can cook this recipe: it is published and has at least one step with text
 * (FR-033a). Callers pass the count from {@link countCookableSteps}, never the raw number of steps.
 *
 * The rule has no viewer input. Whether the viewer may read the recipe is decided before it, by the read itself, so the
 * same recipe answers the same for its owner and for another cook. "In review" (spec 020) is not built and the client has
 * no field for it. When it is, it becomes a REQUIRED field of {@link CookabilityInput}, so every caller fails to compile
 * until it passes the reading.
 *
 * @pattern Specification — one pure predicate for "may a cook start cooking this recipe"
 * @param input - The recipe's status and step count.
 * @returns `true` when Start cooking is offered. Pure.
 */
export function isCookable({ status, stepCount }: CookabilityInput): boolean {
    return status === RecipeStatus.PUBLISHED && Number.isInteger(stepCount) && stepCount > 0;
}
