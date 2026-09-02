/**
 * @module @commise/features-recipes — recipe-list model layer.
 *
 * Pure, platform-agnostic types + helpers shared by the web (`*.tsx`) and native (`*.native.tsx`) list
 * views, so the two renders can never drift on shape or formatting. No React, no platform APIs — just the
 * view-model projection and the copy-formatting primitives.
 */
import type { Locale } from '@commise/i18n';
import type { ReactNode } from 'react';

import { toRecipeCardModel, type RecipeCardModel } from '../card/model.js';
import type { RecipeListMessages } from '../messages.js';
import type { RenderRecipeNutrition } from '../nutrition/model.js';

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
 * Project a `Recipe` (`@kitchensink/recipe-core`) down to the {@link RecipeListItem} the list
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

// ─── Quick-filter chips (L4) ─────────────────────────────────────────────────────────────────────────
//
// The list's quick-filter chips are CLIENT-SIDE predicates over the already-loaded page: `GET /api/v1/recipes`
// (the owner library list) takes no filter params — only `/search` does (see `filters/model.ts`'s module
// doc) — so a chip narrows the rows the container already has, it never issues a new request. Dietary-flag
// and cuisine chips match by literal string equality against real recipe data (the container derives
// `available` from what is actually present). The "Quick (<30m)" chip is different in kind: it has no
// backing data VALUE to match against — it is a fixed bucket over `totalTimeMinutes` — so it is modelled as
// one reserved sentinel token, `QUICK_TIME_FACET`, that both `available`/`active` arrays can carry
// alongside the real facet values, with `matchesListFacet` and `filterChipLabel` giving that one
// token special-cased matching/label behavior while every other facet stays a plain passthrough.

/**
 * The reserved sentinel facet token for the "Quick (<30m)" time-bucket chip. Carried in the same
 * `available`/`active` string arrays as real dietary-flag/cuisine facet values, but never itself a value
 * that appears in recipe data — {@link matchesListFacet} special-cases it to a total-time comparison instead
 * of a literal string match, so a recipe whose cuisine or dietary flag happens to equal this string can never
 * be mistaken for a "quick" match.
 */
export const QUICK_TIME_FACET = 'quick' as const;

/** The total-time bound (minutes, exclusive) the "Quick (<30m)" chip filters to — the wireframe's "<30m". */
export const QUICK_TIME_THRESHOLD_MINUTES = 30;

/**
 * Whether a recipe qualifies for the "Quick (<30m)" chip. Pure.
 *
 * @param totalTimeMinutes - The recipe's total time in minutes.
 * @returns `true` when strictly under {@link QUICK_TIME_THRESHOLD_MINUTES}.
 */
export const isQuickRecipe = (totalTimeMinutes: number): boolean => totalTimeMinutes < QUICK_TIME_THRESHOLD_MINUTES;

/** The subset of a recipe DTO the list's quick-filter chips read — dietary flags, cuisine, and total time. */
export interface RecipeFacetSource {
    readonly dietaryFlags: readonly string[];
    readonly cuisine?: string;
    readonly totalTimeMinutes: number;
}

/**
 * Whether a recipe satisfies one active quick-filter chip. The {@link QUICK_TIME_FACET} sentinel compares
 * total time via {@link isQuickRecipe}; every other facet value matches literally against the recipe's
 * dietary flags or cuisine (the existing L4 chip mechanism). A caller narrowing by several active chips
 * calls this once per chip and requires every one to match (`Array.prototype.every`). Pure.
 *
 * @param recipe - The recipe's facet-relevant fields.
 * @param facet - One active facet value (a real dietary-flag/cuisine string, or {@link QUICK_TIME_FACET}).
 * @returns Whether the recipe satisfies that facet.
 */
export const matchesListFacet = (recipe: RecipeFacetSource, facet: string): boolean =>
    facet === QUICK_TIME_FACET
        ? isQuickRecipe(recipe.totalTimeMinutes)
        : recipe.dietaryFlags.includes(facet) || recipe.cuisine === facet;

/**
 * The visible label for a quick-filter chip. Dietary-flag and cuisine facets ARE their own label (real,
 * user-authored data — never translated). The {@link QUICK_TIME_FACET} sentinel is not user data, so it maps
 * to the caller's localized copy instead of leaking the internal token. Pure.
 *
 * @param facet - The facet value the chip represents.
 * @param quickLabel - The localized "Quick (<30m)" copy, rendered when `facet` is {@link QUICK_TIME_FACET}.
 * @returns The chip's visible label.
 */
export const filterChipLabel = (facet: string, quickLabel: string): string =>
    facet === QUICK_TIME_FACET ? quickLabel : facet;

/**
 * Whether the viewer has NARROWED the list — an active search term, or at least one active quick-filter chip.
 *
 * This is the empty-vs-no-match discriminator, and the one authoritative representation of it (both list
 * leaves call this, so web and native cannot drift on the branch they pick). Zero rows *while narrowing* is a
 * NO-MATCH: the library has recipes and the viewer's own criteria excluded them. Zero rows *without*
 * narrowing is the genuine first-run empty library — the only state that earns "No recipes yet" and the
 * "Create your first recipe" CTA.
 *
 * Facets count, not just the search box: the chips are DERIVED from the loaded library, so a pressed chip can
 * only exist when the caller has recipes — treating a chip-narrowed zero as first-run tells a viewer with a
 * full library that they have nothing. The discovery surface reaches the same conclusion through its own
 * `searchValue || hasActiveFilters` gate. Pure.
 *
 * @param searchValue - The raw (untrimmed) search-box value.
 * @param activeFacets - The active quick-filter facet values; absent/empty means no chip is pressed.
 * @returns `true` when the visible rows are the result of viewer-applied criteria.
 */
export const isListNarrowed = (searchValue: string, activeFacets: readonly string[] = []): boolean =>
    searchValue.trim().length > 0 || activeFacets.length > 0;

/** What {@link shouldShowCreateDial} needs to decide, as one shape rather than four positional booleans. */
export interface CreateDialVisibility {
    /** The list's load state. */
    readonly status: RecipeListStatus;
    /** How many rows the list is currently showing. */
    readonly recipeCount: number;
    /** Whether the viewer narrowed those rows themselves — see {@link isListNarrowed}. */
    readonly narrowed: boolean;
    /** Whether the Community source tab is the active one. */
    readonly onCommunity: boolean;
}

/**
 * Whether the pinned create dial (U34's SpeedDial FAB) is mounted.
 *
 * Two gates, and the ONE authoritative representation of both — they were previously spelled inline in each
 * list leaf, agreeing by inspection rather than by construction:
 *
 *  - **Not on a TRUE empty library.** The first-run empty body renders its own "Create your first recipe"
 *    CTA, and two competing create affordances on one screen is the defect. "True empty" means the SAME
 *    thing here as in the body branch, because both read {@link isListNarrowed}: a chip- or search-narrowed
 *    zero KEEPS the dial, since that body renders no CTA to replace it and suppressing would leave the
 *    viewer with no way to create at all.
 *  - **Never on the Community tab.** A cook does not create into another cook's list.
 *
 * Loading and error keep the dial for the same reason a narrowed zero does: neither renders a CTA. Pure.
 *
 * @param visibility - The list state the two gates are decided from.
 * @returns `true` when the dial should be rendered.
 */
export const shouldShowCreateDial = ({ status, recipeCount, narrowed, onCommunity }: CreateDialVisibility): boolean => {
    const trueEmpty = status === 'ready' && recipeCount === 0 && !narrowed;

    return !trueEmpty && !onCommunity;
};

/** Props for a single recipe row in the list. */
export interface RecipeListCardProps {
    readonly recipe: RecipeListItem;
    /** Invoked with the recipe id when the row is activated. */
    readonly onSelect: (id: string) => void;
    /**
     * This recipe's per-serving nutrition, as an already-decided NODE for the card's meta row (the host
     * closes over the page's ONE batch promise — see `RenderRecipeNutrition`). Absent ⇒ no nutrition line.
     */
    readonly nutrition?: ReactNode;
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
    /**
     * Open the ingredient-paste surface (plan U9) — the dial's SECOND destination.
     *
     * ⛔ OPTIONAL, and its absence removes the entry rather than disabling it. U34 chose a disclosing dial
     * precisely so "adding Scan / Import / AI when 004 and 005 ship is a change to THIS LIST"; this is the
     * first of those, and a host that has no paste route (none exists today, but the contract must survive
     * one) must not be forced to render a destination that goes nowhere.
     */
    readonly onPasteIngredients?: () => void;
    readonly onRetry: () => void;
    /** Optional My/Community source tabs (L5). Absent → no tab control (e.g. mobile uses shell tabs). */
    readonly tab?: RecipeListTabControl;
    /** Optional quick-filter chip row (L4). Absent → no chips. */
    readonly filters?: RecipeListFilterControl;
    /** Optional pull-to-refresh (L8) — mobile only; the web leaf ignores it (no web pull gesture). */
    readonly refresh?: RecipeListRefreshControl;
    /**
     * How to render one card's deferred calorie figure — called once per visible card with its recipe id
     * (see {@link RenderRecipeNutrition}). The host closes over the page's ONE batch promise, so N cards are
     * ONE read. Absent ⇒ no card shows a nutrition line, which is the card's absent-value rule, not a gap.
     */
    readonly renderNutrition?: RenderRecipeNutrition;
}

/** Pull-to-refresh control (L8): whether a refresh is in flight, and the refetch to run on pull. */
export interface RecipeListRefreshControl {
    readonly refreshing: boolean;
    readonly onRefresh: () => void;
}

/** Which recipe source the list shows (L5). */
export type RecipeListTab = 'mine' | 'community';

/**
 * The two sources, in display order. The ONE authoritative order (both platform strips map over this), so
 * "My Recipes then Community" cannot drift between the leaves — it used to be spelled inline in each.
 */
export const RECIPE_SOURCE_TABS: readonly RecipeListTab[] = ['mine', 'community'];

/**
 * The My/Community source switcher (L5): which source is showing, WHERE each source lives, and how to
 * activate one.
 *
 * `href` is REQUIRED, and that is the point. The web strip renders real links from it, so a switcher can no
 * longer be built without a destination for BOTH sources — the exact defect this contract closes, where
 * "Community" pushed a route and "My Recipes" led nowhere at all, making the community surface a one-way
 * trip. A missing destination is now a type error rather than a dead end a viewer discovers.
 *
 * Each platform consumes the half its navigation model can express — the same web-only/native-only prop
 * convention `refresh` (native pull-to-refresh, ignored on web) and `className` already follow:
 *
 *  - **web** routes by URL, so its strip IS a set of links built from `href` and never calls `onChange`;
 *  - **native** has no URLs — its shell swaps screens — so its strip calls `onChange` and ignores `href`.
 */
export interface RecipeListTabControl {
    readonly active: RecipeListTab;
    /** Where each source lives. Web navigates by these; native ignores them (see the interface JSDoc). */
    readonly href: Readonly<Record<RecipeListTab, string>>;
    /** Activate a source. Native's only navigation seam; web ignores it (its link does the navigating). */
    readonly onChange?: (tab: RecipeListTab) => void;
}

/**
 * The visible label for one source. The ONE mapping from source to copy, so the web strip, the native strip
 * and the mobile shell cannot disagree about which label belongs to which source. Pure.
 *
 * @param value - The source.
 * @param labels - The localized tab copy.
 * @returns The label to render.
 */
export const sourceTabLabel = (
    value: RecipeListTab,
    labels: Pick<RecipeListMessages, 'tabMine' | 'tabCommunity'>,
): string => (value === 'mine' ? labels.tabMine : labels.tabCommunity);

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
