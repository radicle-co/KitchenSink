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
 * `card/model.ts`'s `formatCalories`. Pure.
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

/**
 * Props for the PURE detail body — the whole `RecipeDetailView` contract plus the serving scale it renders
 * at. Split out so the body stays `props → JSX` while `RecipeDetailView` itself is a thin orchestration
 * shell that binds the session serving-scale store and computes the scaled projection.
 *
 * The scale is deliberately NOT on {@link RecipeDetailViewProps}: it is not something an app can forget to
 * wire, because there is nothing for an app to wire. That is the structural answer to the failure this
 * feature was added to fix — a capability that reaches the screen only if a container remembers to pass it.
 */
export interface RecipeDetailBodyProps extends RecipeDetailViewProps {
    /** The serving count the body renders at (already clamped to the recipe's supported `servingsRange`). */
    readonly servings: number;
    /** Report a newly chosen serving count back to the shell. */
    readonly onServingsChange: (servings: number) => void;
}

/**
 * Props for the recipe-source (provenance) line, shared by the web (`RecipeSourceLine.tsx`) and native
 * (`RecipeSourceLine.native.tsx`) leaves so the two cannot drift on the contract (§14.4).
 *
 * Both fields are UNTRUSTED and both are optional; every combination renders something defensible, and the
 * all-absent case renders nothing at all. A `sourceUrl` becomes a link only if it survives `safeHttpUrl`.
 */
export interface RecipeSourceLineProps {
    /** The recipe's original URL, as stored. Untrusted — gated by `safeHttpUrl` before it is ever linked. */
    readonly sourceUrl?: string;
    /** The author-stated provenance ("Serious Eats", "Grandma's cookbook"). */
    readonly sourceAttribution?: string;
}

/**
 * The NATIVE source line's props: the shared contract plus the injected "open a URL" adapter.
 *
 * React Native has no declarative link, so leaving the app is a platform CALL. Injecting it (defaulting to
 * `openExternalUrl`) keeps the leaf a pure `props → JSX` render and gives tests a seam that a double
 * actually crosses. The web leaf needs no equivalent — `<a href>` already is the browser's link adapter.
 */
export interface RecipeSourceLineNativeProps extends RecipeSourceLineProps {
    /** Open a VERIFIED href. Defaults to the `Linking.openURL` adapter. */
    readonly onOpen?: (href: string) => void;
}

/**
 * Props for the serving-count control, shared by the web and native leaves (§14.4).
 *
 * Controlled by construction: it owns no state and derives its own bounds from `baseServings` via
 * `servingsRange`, so it cannot offer a serving count the domain would refuse.
 */
export interface ServingScaleControlProps {
    /** The serving count currently displayed. */
    readonly servings: number;
    /** The recipe's authored serving count — the default, and what defines the selectable range. */
    readonly baseServings: number;
    /** Report a newly chosen serving count. Absent → the control renders inert rather than disappearing. */
    readonly onServingsChange?: (servings: number) => void;
}
