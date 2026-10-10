/**
 * @module @commise/features-recipes — recipe-list model layer.
 *
 * Pure, platform-agnostic types + helpers shared by the web (`*.tsx`) and native (`*.native.tsx`) list
 * views, so the two renders can never drift on shape or formatting. No React, no platform APIs — just the
 * view-model projection and the copy-formatting primitives.
 */
import type { HeaderAction } from '@commise/ui/large-title-header';
import type { Locale } from '@commise/i18n';
import type { ReactNode } from 'react';

import type { ChipRowOverflow } from '@commise/ui/chip';
import type { LoadMoreControlProps } from '@commise/ui/load-more';
import type { ScrollBind } from '@commise/ui/scroll-host';
import type { RecipeListSortBy } from '@kitchensink/recipe-service-client';

import type { CardVariant, ListViewMode } from '../card/cardVariant.js';
import { toRecipeCardModel, type RecipeCardModel } from '../card/model.js';
import { fillTemplate } from '../format/fillTemplate.js';
import type { RecipeListMessages } from '../messages.js';
import type { RenderRecipeNutrition } from '../nutrition/model.js';
import type { RefreshNoticeControl } from '../refresh/model.js';
import type { LibraryFacet, LibraryState } from './libraryTypes.js';

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

/**
 * Whether the floating create button ("New recipe", build spec §3.4) is mounted over SETTLED results.
 *
 * One gate, and the ONE authoritative representation of it: **not on a TRUE empty library.** The first-run empty
 * body renders its own "Create your first recipe" CTA, and two competing create affordances on one screen is the
 * defect. "True empty" means the SAME thing here as in the body branch, because both read {@link isListNarrowed}'s
 * answer: a chip- or search-narrowed zero KEEPS the button, since that body renders no CTA to replace it and
 * suppressing would leave the viewer with no way to create at all.
 *
 * ⚠️ It is asked ONLY of settled results, and the two other states answer structurally rather than here:
 *
 *  - **Loading renders no button at all** (`RecipeListLoading` has none). While the library has not answered,
 *    `recipeCount: 0` is "unknown", not "empty", and a button mounted through that window UNMOUNTED under a first-run
 *    cook's finger the moment the empty library settled — Playwright saw `element was detached from the DOM` for
 *    60s. This used to be a `status === 'loading'` clause; the suspense boundary now makes it unrepresentable.
 *  - **A load error renders the button unconditionally** (`RecipeListLoadError`). Its body has no create CTA, so
 *    suppressing there would strand a cook whose library failed to load with no create affordance. ⚠️ An error can
 *    still become a settled EMPTY library without a user action — TanStack refetches a stale errored query on
 *    focus and reconnect — and that transition unmounts the button the same way. It is accepted: it needs a failed
 *    load AND a focus change AND an empty library, rather than happening on every first run.
 *
 * The Community source never reaches this policy: the community surface is discovery, which mounts no button. Pure.
 *
 * @param visibility - How many rows the results show, and whether the viewer narrowed them.
 * @returns `true` when the button should be rendered.
 */
export const shouldShowCreateButton = ({ recipeCount, narrowed }: CreateButtonVisibility): boolean =>
    recipeCount > 0 || narrowed;

/** What {@link shouldShowCreateButton} decides from. */
export interface CreateButtonVisibility {
    /** How many rows the results are showing. */
    readonly recipeCount: number;
    /** Whether the viewer narrowed those rows themselves — see {@link isListNarrowed}. */
    readonly narrowed: boolean;
}

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
 * Where creating starts, shared by the settled results and the load error: the create entry's one tap (build spec §3.4,
 * slice 8), and the first-run block's Paste ingredients.
 */
export interface RecipeCreateDestinations {
    readonly onCreateRecipe: () => void;
    /**
     * The first-run block's Paste ingredients: the new editor at Ingredients with its Paste a list sheet open (§7.5.4).
     * ⛔ OPTIONAL, and its absence removes the button rather than disabling it.
     */
    readonly onPasteIngredients?: () => void;
}

/** A place in the Recipes screen's segments (`docs/design/uiOverhaul/buildSpec.md` §4.3, §5.1). */
export type RecipesSegment = 'mine' | 'collections';

/** The id of the Recipes screen's large title (My recipes and Collections share it). */
export const RECIPES_TITLE_ID = 'recipes-title';

/** The segments, in display order. */
export const RECIPES_SEGMENTS: readonly RecipesSegment[] = ['mine', 'collections'];

/**
 * The My recipes · Collections segments. `href` is required for both places, so a segment can never lead nowhere; web
 * links by it (a plain click is handed to `onSelect`), native has no URLs and calls `onSelect`.
 */
export interface RecipesSegmentControl {
    readonly current: RecipesSegment;
    readonly href: Readonly<Record<RecipesSegment, string>>;
    /** Go to a segment. Web: a plain click on a segment link. Native: the only navigation. */
    readonly onSelect: (segment: RecipesSegment) => void;
}

/**
 * Props for the recipe list's FRAME — the chrome (heading, segments, search field) that renders OUTSIDE the list's
 * suspense boundary, so a pending or failed read never unmounts the heading or the field the viewer is typing in. The
 * boundary renders inside, as `children`.
 */
export interface RecipeListFrameProps {
    readonly searchValue: string;
    readonly onSearchChange: (value: string) => void;
    /**
     * Whether the search field shows. The first run hides it (§4.3: "Search, chips and result bar hide"); it stays while
     * loading, and whenever the cook has typed, so a search can always be cleared.
     */
    readonly searchVisible: boolean;
    /** The My recipes · Collections segments. Absent → none (a host whose shell switches the places itself). */
    readonly segments?: RecipesSegmentControl;
    /**
     * A counter whose change moves focus to the heading: the owner advances it when a retry from the refresh notice
     * succeeds, because that retry removed the button the viewer pressed. The frame never moves focus on mount.
     */
    readonly headingFocusSignal: number;
    /**
     * The large title's action (slice 3, `buildSpec.md` §3.3, §4.3): the avatar, which opens Profile. The app supplies
     * it, because the profile read and the navigation are the app's.
     */
    readonly headerAction?: HeaderAction;
    /** The read boundary: its loading or error fallback, or the settled results. */
    readonly children: ReactNode;
}

/** The list/grid switch: the mode in use, and how to change it. */
export interface RecipeListViewControl {
    readonly mode: ListViewMode;
    readonly onChange: (mode: ListViewMode) => void;
}

/** The sort: the server sort in use, and how to change it. */
export interface RecipeListSortControl {
    readonly value: RecipeListSortBy;
    readonly onChange: (sort: RecipeListSortBy) => void;
}

/** The facet chips: one per facet the library offers, with its count, and the toggles. */
export interface RecipeListFacetControl {
    readonly facets: readonly LibraryFacet[];
    readonly onToggle: (value: string) => void;
    /** The leading "All" chip: clears every facet. */
    readonly onClear: () => void;
}

/**
 * Props for the recipe list's RESULTS — what renders inside the suspense boundary once the read has settled: the facet
 * chips, the result bar (count, sort, view), the refresh notice, then the first-run, no-match or populated body, the
 * "Load more" past 500 recipes, and the create button. It performs NO data fetching: the composing app reads the library,
 * narrows it with `./library.ts`, decides the card variant with `cardVariantOf`, and hands over the result.
 */
export interface RecipeListResultsProps extends RecipeCreateDestinations {
    /** The visible rows — the library after the viewer's search and chips. */
    readonly recipes: readonly RecipeListItem[];
    /** Which body to draw (`libraryStateOf`). */
    readonly state: LibraryState;
    /** The raw search term, quoted by the no-match body. */
    readonly searchValue: string;
    readonly onClearSearch: () => void;
    readonly onClearFilters: () => void;
    readonly onSelectRecipe: (id: string) => void;
    /** Where a recipe lives, which makes each card a real link on web. Native ignores it. */
    readonly hrefOf?: (id: string) => string;
    /** The card variant the orchestration decided (`cardVariantOf`). */
    readonly variant: CardVariant;
    /** How the chips lay out: one scrolling line below a 600 container, wrapped from 600. */
    readonly chipOverflow: ChipRowOverflow;
    readonly facets: RecipeListFacetControl;
    readonly view: RecipeListViewControl;
    readonly sort: RecipeListSortControl;
    /** "Load more", past the first 500 recipes. Absent → none. */
    readonly loadMore?: Omit<LoadMoreControlProps, 'labels'>;
    /** Optional pull-to-refresh (L8) — mobile only; the web leaf ignores it (no web pull gesture). */
    readonly refresh?: RecipeListRefreshControl;
    /** Optional notice for a failed refresh of the rows on screen — both platforms. Absent ⇒ no notice. */
    readonly refreshNotice?: RefreshNoticeControl;
    /**
     * How to render one card's deferred calorie figure — called once per visible card with its recipe id
     * (see {@link RenderRecipeNutrition}). The host closes over the page's ONE batch promise, so N cards are
     * ONE read. Absent ⇒ no card shows a nutrition line, which is the card's absent-value rule, not a gap.
     */
    readonly renderNutrition?: RenderRecipeNutrition;
    /**
     * The screen's scroll host's bind for this, its one vertical scroller (blueprint A7) — native only: the host reads
     * the scroll (the floating create button, the tab's second tap). Web's document scrolls, so the web leaf ignores it.
     */
    readonly scrollBind?: ScrollBind;
}

/** Props for the recipe list's LOADING fallback: the skeletons of the variant the cards will use. */
export interface RecipeListLoadingProps {
    readonly variant: CardVariant;
}

/**
 * Props for the recipe list's LOAD ERROR — what the error boundary renders when the read failed with nothing loaded:
 * the alert with its retry, and the create button (see {@link shouldShowCreateButton} for why an error keeps it).
 */
export interface RecipeListLoadErrorProps extends Pick<RecipeCreateDestinations, 'onCreateRecipe'> {
    /** The boundary's reset, which refetches. */
    readonly onRetry: () => void;
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
