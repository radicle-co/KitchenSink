/**
 * @module @commise/features-recipes — recipe-detail model layer.
 *
 * Pure, platform-agnostic helpers + props shared by the web (`*.tsx`) and native (`*.native.tsx`) detail
 * views. The detail render consumes a {@link RecipeDetail} directly (it is already the read model); the
 * only shaping needed is small formatting the two platforms must not diverge on.
 */
import type { RecipeDetail } from '@kitchensink/recipe-core';

/**
 * Format an ingredient quantity with its optional unit — e.g. `formatQuantity(1.5, 'lbs') === '1.5 lbs'`,
 * `formatQuantity(3) === '3'`. An empty-string unit is treated as absent. Pure.
 *
 * @param quantity - The ingredient quantity.
 * @param unit - The optional unit of measure.
 * @returns The formatted "quantity unit" string (quantity alone when no unit).
 */
export const formatQuantity = (quantity: number, unit?: string): string =>
    unit !== undefined && unit.length > 0 ? `${quantity} ${unit}` : `${quantity}`;

/**
 * Props for the recipe-detail view — a presentational render of an already-loaded {@link RecipeDetail}.
 *
 * The cooking-progress sets + toggle callbacks and the tag-filter callback are OPTIONAL: the view is a pure
 * `props → JSX` render, and the interaction/state lives in the orchestration container (which passes them
 * from `useCookingProgress` + router navigation). Rendered standalone (e.g. a story or a narrow test) the
 * checkboxes read unchecked and the tag chips are inert — no crashes, no hidden state.
 */
export interface RecipeDetailViewProps {
    readonly recipe: RecipeDetail;
    /** Ingredient ids the cook has checked off (D5). Absent → all unchecked. */
    readonly checkedIngredients?: ReadonlySet<string>;
    /** Toggle an ingredient's gathered state (D5). */
    readonly onToggleIngredient?: (ingredientId: string) => void;
    /** 1-based step numbers the cook has marked done (D4). Absent → all unchecked. */
    readonly checkedSteps?: ReadonlySet<number>;
    /** Toggle a step's completed state (D4). */
    readonly onToggleStep?: (stepNumber: number) => void;
    /** Navigate to the visibility-scoped search filtered by `tag` (D6). */
    readonly onFilterByTag?: (tag: string) => void;
}
