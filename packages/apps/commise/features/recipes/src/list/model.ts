/**
 * @module @commise/features-recipes — recipe-list model layer.
 *
 * Pure, platform-agnostic types + helpers shared by the web (`*.tsx`) and native (`*.native.tsx`) list
 * views, so the two renders can never drift on shape or formatting. No React, no platform APIs — just the
 * view-model projection and the copy-formatting primitives.
 */
import type { Locale } from '@commise/i18n';

import { toRecipeCardModel, type RecipeCardModel } from '../card/model.js';

/**
 * The three top-level states the list view renders. `ready` further splits into empty vs populated on
 * `recipes.length` (a distinction the view derives — an empty successful load is not an error).
 */
export type RecipeListStatus = 'loading' | 'error' | 'ready';

/**
 * View-model for one recipe card in the list. This is the SHARED card view-model ({@link RecipeCardModel}):
 * the list and the Home widget draw the identical mockup card (4:3 cover + PRO badge, title, time · servings
 * · difficulty, star rating), so both render the same shape and project through the same
 * {@link toRecipeListItem}. Kept as a named alias so existing list imports (`RecipeListItem`) stay stable.
 * Richer cookable content (ingredients, steps, per-serving nutrition) still belongs to the detail view (T066).
 */
export type RecipeListItem = RecipeCardModel;

/**
 * Project a {@link import('@kitchensink/recipe-core').Recipe} down to the {@link RecipeListItem} the list
 * card renders — the single shared card projection, so the list and widget can never disagree on card fields.
 */
export const toRecipeListItem = toRecipeCardModel;

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
    /** Optional My/Community source tabs (L5). Absent → no tab control (e.g. mobile uses shell tabs). */
    readonly tab?: RecipeListTabControl;
    /** Optional quick-filter chip row (L4). Absent → no chips. */
    readonly filters?: RecipeListFilterControl;
}

/** Which recipe source the list shows (L5). */
export type RecipeListTab = 'mine' | 'community';

/** The My/Community source-tab control (L5) — the active tab plus a change callback. */
export interface RecipeListTabControl {
    readonly active: RecipeListTab;
    readonly onChange: (tab: RecipeListTab) => void;
}

/**
 * The quick-filter chip control (L4): the available real facet values (dietary flags + cuisine present in the
 * library), the active subset, a per-facet toggle, and a clear-all. A leading "All" chip (pressed when nothing
 * is active) resets via {@link onClear}. The mockup's Favorites / AI-Generated chips are intentionally NOT
 * modelled — the product has no favorites feature and no AI-generated source, so they would be dead controls.
 */
export interface RecipeListFilterControl {
    readonly available: readonly string[];
    readonly active: readonly string[];
    readonly onToggle: (value: string) => void;
    readonly onClear: () => void;
}
