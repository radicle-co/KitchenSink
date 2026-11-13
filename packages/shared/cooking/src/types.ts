/**
 * Session-scoped domain types for Cooking Mode.
 *
 * This module deliberately defines **no recipe-shaped type**. Steps come from the shipped
 * `@kitchensink/recipe-core`; defining a local copy is prohibited by governance rule GR-007 AC-007-d.
 *
 * Every field is JSON-round-trippable on purpose: `JSON.stringify(new Set())` is `{}`, so a `Set` would
 * silently lose its contents if the session is ever stored.
 */

/**
 * The complete session-scoped state of one Cooking Mode session.
 *
 * None of this mutates the stored recipe: Cooking Mode is a read-only consumer.
 */
export interface CookingSession {
    recipeId: string;
    /** ISO 8601 timestamp. */
    startedAt: string;
    currentStepIndex: number;
    /** Array, not a `Set`, so the session survives a JSON round-trip. */
    completedSteps: number[];
}
