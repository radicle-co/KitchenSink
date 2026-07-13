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

/** Props for the recipe-detail view — a presentational render of an already-loaded {@link RecipeDetail}. */
export interface RecipeDetailViewProps {
    readonly recipe: RecipeDetail;
}
