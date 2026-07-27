/**
 * @module @commise/features-recipes — recipe-detail model layer.
 *
 * Pure, platform-agnostic helpers + props shared by the web (`*.tsx`) and native (`*.native.tsx`) detail
 * views. The detail render consumes a {@link RecipeDetail} directly (it is already the read model); the
 * only shaping needed is small formatting the two platforms must not diverge on.
 */
import type { ReactNode } from 'react';

import type { Locale } from '@commise/i18n';
import type { RecipeDetail } from '@kitchensink/recipe-core';

/**
 * Format an ingredient quantity with its optional unit for the active locale via {@link Intl.NumberFormat}
 * (never string concatenation, so grouping/decimal separators stay locale-correct) — e.g.
 * `formatQuantity(1000, 'en-US') === '1,000'`, `formatQuantity(1.5, 'en-US', 'lbs') === '1.5 lbs'`,
 * `formatQuantity(3, 'en-US') === '3'`. An empty-string unit is treated as absent. Mirrors
 * `card/model.ts`'s {@link formatCalories}. Pure.
 *
 * @param quantity - The ingredient quantity.
 * @param locale - The active BCP-47 locale.
 * @param unit - The optional unit of measure.
 * @returns The formatted "quantity unit" string (quantity alone when no unit).
 */
export const formatQuantity = (quantity: number, locale: Locale, unit?: string): string => {
    const formattedQuantity = new Intl.NumberFormat(locale).format(quantity);

    return unit !== undefined && unit.length > 0 ? `${formattedQuantity} ${unit}` : formattedQuantity;
};

/**
 * Props for the recipe-detail HERO cover, shared by the web (`RecipeHero.tsx`) and native
 * (`RecipeHero.native.tsx`) leaves so the two cannot drift on the contract (§14.4).
 */
export interface RecipeHeroProps {
    /** The recipe title — the cover image's alt text / accessible name. */
    readonly title: string;
    /**
     * Absolute CDN URL of the cover photo. ABSENT → the deliberate no-photo fallback (never an empty source).
     *
     * This is the recipe's canonical cover (the same field the card tile paints), NOT `photos[0]`, so the hero
     * and the card can never disagree about which image represents the recipe.
     */
    readonly coverPhotoUrl?: string;
}

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
    /**
     * Caller-supplied content grouped into the ONE footer row alongside the version + visibility badges (C3
     * wireframe parity) — e.g. the clone action for a non-owner viewer. Absent renders no slot (e.g. the
     * owner viewing their own recipe, where the shared `canClone` gate excludes a clone control entirely).
     */
    readonly footerActions?: ReactNode;
}
