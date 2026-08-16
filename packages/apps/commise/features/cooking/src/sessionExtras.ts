/**
 * @module @commise/features-cooking/sessionExtras — the platform-neutral model layer for Cooking Mode's
 * SESSION EXTRAS (ARCH-015): ingredient checkoff (FR-032a) and yield scaling (FR-034a).
 *
 * Pattern: **pure function module + shared props contract**. It holds the two things the web (`*.tsx`) and
 * native (`*.native.tsx`) leaves of {@link IngredientChecklist} and {@link ScaleSelector} must NOT diverge
 * on — the display shaping of a scaled ingredient line, and the components' prop contracts (§14.4). The
 * scaling ARITHMETIC is deliberately not reimplemented here: it is delegated to `scaleQuantity`
 * (`@kitchensink/cooking-core`, MOD-020), which is the single authority on that rule.
 *
 * Everything in this module is pure — no I/O, no mutation, no platform SDK. Both components are read-only
 * consumers of the recipe (REQ-CN-001): nothing here can write to it, because nothing here holds a writer.
 */
import type { Locale } from '@commise/i18n';
import { scaleQuantity, type ScaleFactor } from '@kitchensink/cooking-core';
import type { RecipeIngredientView } from '@kitchensink/recipe-core';

/** One ingredient line, shaped for display at the active yield. */
export interface ScaledIngredientLine {
    /** The scaled quantity with its unit, locale-formatted — e.g. `400 g`, or `2` when the line is unitless. */
    readonly quantityText: string;
    /** The full accessible name of the line's checkbox — e.g. `400 g Flour`. */
    readonly label: string;
}

/**
 * Shape one ingredient for display at the active yield factor (FR-034a).
 *
 * The quantity is scaled by {@link scaleQuantity} and then formatted with {@link Intl.NumberFormat} — never
 * string concatenation — so grouping and decimal separators stay locale-correct (`1,000`, `0.5`). An
 * absent or empty unit yields the bare number. The input ingredient is never modified.
 *
 * @param ingredient - The recipe's stored ingredient line.
 * @param factor - The active yield scale factor.
 * @param locale - The active BCP-47 locale.
 * @returns The display strings for that line.
 * @throws {InvalidQuantityError} When the stored quantity is negative or not finite (surfaced by
 *   `scaleQuantity`, so a corrupt recipe fails loudly rather than rendering a nonsense amount).
 */
export const scaleIngredientLine = (
    ingredient: RecipeIngredientView,
    factor: ScaleFactor,
    locale: Locale,
): ScaledIngredientLine => {
    const formatted = new Intl.NumberFormat(locale).format(scaleQuantity(ingredient.quantity, factor));
    const quantityText =
        ingredient.unit !== undefined && ingredient.unit.length > 0 ? `${formatted} ${ingredient.unit}` : formatted;

    return { quantityText, label: `${quantityText} ${ingredient.name}`.trim() };
};

/**
 * Format the "{checked} of {total} checked" progress readout (FR-032a).
 *
 * @param checkedCount - How many of the recipe's ingredients are checked.
 * @param total - How many ingredients the recipe contains.
 * @param template - The `ingredientsChecked` message template.
 * @param locale - The active BCP-47 locale.
 * @returns The interpolated progress string.
 */
export const formatCheckoffProgress = (
    checkedCount: number,
    total: number,
    template: string,
    locale: Locale,
): string => {
    const format = new Intl.NumberFormat(locale);

    return template.replace('{checked}', format.format(checkedCount)).replace('{total}', format.format(total));
};

/**
 * Props for the ingredient-checkoff panel, shared by its web and native leaves so the platforms cannot
 * drift on the contract (§14.4).
 *
 * The panel is a CONTROLLED, purely presentational surface: the checked ids and the open/dismissed state
 * arrive as props and intent leaves as callbacks. It owns no session state and performs no write — that is
 * what makes "MUST NOT mutate the stored recipe" (FR-032a) structural rather than merely tested.
 */
export interface IngredientChecklistProps {
    /** The recipe's ingredient lines, in display order. Read-only — never written back. */
    readonly ingredients: readonly RecipeIngredientView[];
    /** Ingredient ids checked in the current cooking session (`CookingSession.checkedIngredientIds`). */
    readonly checkedIngredientIds: readonly string[];
    /** The active yield factor applied to DISPLAYED quantities (FR-034a). Defaults to `1`. */
    readonly scaleFactor?: ScaleFactor;
    /** Whether the panel is open. `false` renders nothing, leaving the current step untouched. */
    readonly isOpen: boolean;
    /** Reports which ingredient the cook toggled; the session owner applies `toggleIngredient`. */
    readonly onToggleIngredient: (ingredientId: string) => void;
    /** Reports that the cook dismissed the panel; the session owner closes it. */
    readonly onDismiss: () => void;
}

/**
 * Props for the yield-scale control, shared by its web and native leaves (§14.4).
 *
 * Deliberately minimal: the active factor in, the chosen factor out. There is no third field, and in
 * particular NOTHING here can carry a countdown or a cook-time value — see spec.md D-002.
 */
export interface ScaleSelectorProps {
    /** The active yield factor. */
    readonly scaleFactor: ScaleFactor;
    /** Reports the factor the cook chose; the session owner applies `setScaleFactor`. */
    readonly onScaleChange: (factor: ScaleFactor) => void;
}
