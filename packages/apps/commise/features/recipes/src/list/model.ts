/**
 * @module @commise/features-recipes — recipe-list model layer.
 *
 * Pure, platform-agnostic types + helpers shared by the web (`*.tsx`) and native (`*.native.tsx`) list
 * views, so the two renders can never drift on shape or formatting. No React, no platform APIs — just the
 * view-model projection and the copy-formatting primitives.
 */
import type { Locale } from '@commise/i18n';
import type { Recipe } from '@kitchensink/recipe-core';

/**
 * The three top-level states the list view renders. `ready` further splits into empty vs populated on
 * `recipes.length` (a distinction the view derives — an empty successful load is not an error).
 */
export type RecipeListStatus = 'loading' | 'error' | 'ready';

/**
 * Minimal view-model for one recipe row in the list — the subset of a {@link Recipe} the list renders, so
 * the building blocks never depend on the full DTO. Richer detail (ingredients, steps, photos, nutrition)
 * belongs to the detail view (T066), not the list.
 */
export interface RecipeListItem {
    readonly id: string;
    readonly title: string;
    /** Total time (prep + cook) in minutes — the single duration the list card surfaces. */
    readonly totalTimeMinutes: number;
    /** ISO 8601 timestamp of the recipe's last update (drives the default `updatedAt` sort). */
    readonly updatedAt: string;
}

/**
 * Project a {@link Recipe} down to the {@link RecipeListItem} the list renders. Pure.
 *
 * @param recipe - The source recipe DTO.
 * @returns The list view-model subset.
 */
export const toRecipeListItem = (recipe: Recipe): RecipeListItem => ({
    id: recipe.id,
    title: recipe.title,
    totalTimeMinutes: recipe.totalTimeMinutes,
    updatedAt: recipe.updatedAt,
});

/**
 * Replace `{token}` placeholders in `template` with the matching value from `tokens`. Unknown tokens are
 * left intact rather than throwing (a missing translation variable degrades gracefully). Pure.
 *
 * @param template - A string containing zero or more `{name}` placeholders.
 * @param tokens - The values to substitute, keyed by placeholder name.
 * @returns The template with known placeholders filled.
 */
export const fillTemplate = (template: string, tokens: Readonly<Record<string, string | number>>): string =>
    template.replace(/\{(\w+)\}/g, (match, key: string) => (key in tokens ? String(tokens[key]) : match));

/** The singular/plural templates for the recipe-count label (each may contain `{count}`). */
export interface RecipeCountLabels {
    readonly one: string;
    readonly other: string;
}

/**
 * Format the "{n} recipe(s)" count label for the active locale. Selects the singular vs plural template
 * via {@link Intl.PluralRules} (locale-correct: e.g. English treats `1` as "one" and `0`/`6` as "other"),
 * then fills `{count}`. Pure.
 *
 * NOTE: English has only the `one`/`other` categories, so this maps every non-`one` category to `other`.
 * When additional locales ship (SUPPORTED_LOCALES grows), languages with `few`/`many` categories will
 * need those templates too — move to a full ICU MessageFormat plural at that point.
 *
 * @param count - The number of recipes.
 * @param labels - The singular/plural templates.
 * @param locale - The active BCP-47 locale.
 * @returns The formatted count label.
 */
export const formatRecipeCount = (count: number, labels: RecipeCountLabels, locale: Locale): string => {
    const category = new Intl.PluralRules(locale).select(count);
    const template = category === 'one' ? labels.one : labels.other;

    return fillTemplate(template, { count });
};

/**
 * Format a recipe's total time using the localized `{minutes}`-templated unit string. Pure.
 *
 * @param minutes - The total time in minutes.
 * @param template - The localized template (e.g. `'{minutes} min'`).
 * @returns The formatted duration.
 */
export const formatDurationMinutes = (minutes: number, template: string): string => fillTemplate(template, { minutes });

/** Props for a single recipe row in the list. */
export interface RecipeListCardProps {
    readonly recipe: RecipeListItem;
    /** Invoked with the recipe id when the row is activated. */
    readonly onSelect: (id: string) => void;
}

/**
 * Props for the recipe-list view — a controlled, presentational component. It renders one of four states
 * (loading, error, empty, populated) from `status` + `recipes`, and delegates every interaction upward.
 * It performs NO data fetching: the composing app wires `useRecipes` (and search) to these props.
 */
export interface RecipeListViewProps {
    readonly status: RecipeListStatus;
    readonly recipes: readonly RecipeListItem[];
    readonly searchValue: string;
    readonly onSearchChange: (value: string) => void;
    readonly onSelectRecipe: (id: string) => void;
    readonly onCreateRecipe: () => void;
    readonly onRetry: () => void;
}
