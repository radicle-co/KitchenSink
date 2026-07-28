/**
 * @module @commise/features-recipes — web recipe-list view (T065 building block).
 *
 * Controlled, presentational recipe list: persistent chrome (heading + search + create) over a body that
 * renders one of four states — loading, error, empty, populated — derived from `status` + `recipes`. It
 * fetches nothing; the composing app wires `useRecipes` (and search) to these props.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { GradientSurface } from '@commise/ui/surface';
import type { FC, ReactElement } from 'react';

import { RecipeCardGridSkeleton } from '../card/RecipeCardGridSkeleton.js';
import { PlusIcon } from '../form/icons.js';
import { recipeMessages } from '../messages.js';
import { RecipeListCard } from './RecipeListCard.js';
import { filterChipLabel, formatRecipeCount, isListNarrowed, type RecipeListViewProps } from './model.js';

export const RecipeList: FC<RecipeListViewProps> = ({
    status,
    recipes,
    searchValue,
    onSearchChange,
    onSelectRecipe,
    onCreateRecipe,
    onRetry,
    tab,
    filters,
}) => {
    const { list } = useMessages(recipeMessages);
    const locale = useLocale();
    const onCommunity = tab?.active === 'community';
    // Empty ≠ no-match, and the discriminator is the SHARED predicate (see `isListNarrowed`): an active search
    // term OR an active quick-filter chip means the viewer narrowed the rows themselves.
    const narrowed = isListNarrowed(searchValue, filters?.active);

    let body: ReactElement;

    if (status === 'loading') {
        // The ONE authoritative web recipe-grid skeleton, shared with `RecipeDiscoveryList` so the two
        // card-grid surfaces cannot drift; it also captions itself with the localized label, because an empty
        // `role="status"` region announces nothing.
        body = <RecipeCardGridSkeleton label={list.loadingLabel} />;
    } else if (status === 'error') {
        body = (
            <div role="alert">
                <p>{list.errorTitle}</p>
                <button type="button" onClick={onRetry}>
                    {list.retry}
                </button>
            </div>
        );
    } else if (recipes.length === 0) {
        // A narrowed zero (search term or pressed chip) is a NO-MATCH, not "no recipes yet" — the caller HAS
        // recipes. The Community tab has its own distinct empty copy (L5).
        const emptyTitle = onCommunity ? list.emptyCommunityTitle : list.emptyTitle;
        const emptyBody = onCommunity ? list.emptyCommunityBody : list.emptyBody;
        body = (
            <div className="flex flex-col items-start gap-3">
                <p>{narrowed ? list.noMatchTitle : emptyTitle}</p>
                <p>{narrowed ? list.noMatchBody : emptyBody}</p>
                {!narrowed && !onCommunity && (
                    // Empty-state CTA — the SOLE create control here (the floating FAB is suppressed on empty
                    // so there are never two competing create affordances). Never on Community (L5).
                    <button
                        type="button"
                        onClick={onCreateRecipe}
                        className="rounded-full bg-seafoam px-5 py-2.5 text-body-sm font-semibold text-white shadow-sm transition hover:bg-ocean-dark"
                    >
                        {list.emptyCreateCta}
                    </button>
                )}
            </div>
        );
    } else {
        const count = formatRecipeCount(recipes.length, { one: list.countOne, other: list.countOther }, locale);
        body = (
            <div className="flex flex-col gap-4">
                <p className="text-body-sm font-medium text-slate">{count}</p>
                <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {recipes.map((recipe) => (
                        <li key={recipe.id}>
                            <RecipeListCard recipe={recipe} onSelect={onSelectRecipe} />
                        </li>
                    ))}
                </ul>
            </div>
        );
    }

    // The FAB is the persistent create control (L1) — pinned, OUTSIDE the header, present across loading /
    // error / populated. It is suppressed in the true empty state (the empty-state CTA is the single create
    // affordance) AND on the Community tab (L5 — you never create into someone else's list). "True empty"
    // means the same thing here as in the body branch above, so both read the ONE `narrowed` predicate: a
    // chip-narrowed zero keeps the FAB, because its empty body renders no CTA to replace it.
    const isEmpty = status === 'ready' && recipes.length === 0 && !narrowed;
    const showFab = !isEmpty && !onCommunity;

    return (
        <section aria-label={list.heading} className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8">
            {/* U8: the heading rides a beach-glow gradient title band (mockup recipe-list). */}
            <GradientSurface gradient="hero" className="rounded-2xl">
                <header className="flex items-center justify-between gap-4 p-6">
                    <h1 className="font-display text-display-md font-bold text-charcoal">{list.heading}</h1>
                </header>
            </GradientSurface>

            {tab !== undefined && (
                <div role="tablist" aria-label={list.tabsLabel} className="flex gap-2 border-b border-border">
                    {(['mine', 'community'] as const).map((value) => {
                        const selected = tab.active === value;

                        return (
                            <button
                                key={value}
                                type="button"
                                role="tab"
                                aria-selected={selected}
                                onClick={() => tab.onChange(value)}
                                // Touch floor: `min-h-11` at base, reset at `md:` so the desktop tab density
                                // (py-2) is unchanged.
                                //
                                // The selected tab's UNDERLINE stays seafoam and its LABEL is `ocean-dark`
                                // deliberately — the split is the palette rule, not an oversight (see the
                                // palette JSDoc in `@commise/ui`'s `tokens/colors.ts`).
                                className={`-mb-px inline-flex min-h-11 items-center border-b-2 px-4 py-2 text-body-sm font-semibold transition md:min-h-0 ${
                                    selected
                                        ? 'border-seafoam text-ocean-dark'
                                        : 'border-transparent text-slate hover:text-charcoal'
                                }`}
                            >
                                {value === 'mine' ? list.tabMine : list.tabCommunity}
                            </button>
                        );
                    })}
                </div>
            )}

            <input
                type="search"
                aria-label={list.searchLabel}
                placeholder={list.searchPlaceholder}
                value={searchValue}
                onChange={(event) => onSearchChange(event.target.value)}
                className="w-full rounded-full border border-border bg-card px-5 py-3 text-body-md text-charcoal shadow-sm outline-none placeholder:text-mist focus:ring-2 focus:ring-seafoam-light"
            />

            {filters !== undefined && filters.available.length > 0 && (
                <div role="group" aria-label={list.filtersLabel} className="flex flex-wrap gap-2">
                    {/* Leading "All" chip (mockup L4) resets every quick-filter; pressed when nothing is active. */}
                    <button
                        type="button"
                        aria-pressed={filters.active.length === 0}
                        onClick={filters.onClear}
                        // Base `py-1.5` + the `min-h-11` (44px) floor make the mobile tap target clear the
                        // minimum; `md:py-1 md:min-h-0` restores the desktop chip density exactly.
                        className={`inline-flex min-h-11 items-center rounded-full px-3 py-1.5 text-body-sm font-medium transition md:min-h-0 md:py-1 ${
                            filters.active.length === 0
                                ? 'bg-seafoam text-white'
                                : 'bg-pearl text-slate hover:bg-mist/40'
                        }`}
                    >
                        {list.filterAll}
                    </button>
                    {filters.available.map((value) => {
                        const active = filters.active.includes(value);

                        return (
                            <button
                                key={value}
                                type="button"
                                aria-pressed={active}
                                onClick={() => filters.onToggle(value)}
                                className={`inline-flex min-h-11 items-center rounded-full px-3 py-1.5 text-body-sm font-medium transition md:min-h-0 md:py-1 ${
                                    active ? 'bg-seafoam text-white' : 'bg-pearl text-slate hover:bg-mist/40'
                                }`}
                            >
                                {filterChipLabel(value, list.filterQuick)}
                            </button>
                        );
                    })}
                </div>
            )}

            {body}

            {showFab && (
                <button
                    type="button"
                    aria-label={list.createCta}
                    onClick={onCreateRecipe}
                    // Bottom offset is DERIVED, not hardcoded: it clears the narrow-breakpoint bottom nav (Task
                    // 1.5) plus the device safe-area inset, and drops to the base offset once the nav becomes a
                    // desktop sidebar at the shared `lg` cutover.
                    className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-seafoam text-white shadow-lg transition hover:bg-ocean-dark lg:bottom-8"
                >
                    {/* An SVG, not the text "+": flex centres the LINE BOX but ink is placed by the BASELINE, so a
                        "+" character paints ~1.7px low and no centring property can correct it. This glyph's
                        extents are symmetric about the viewBox centre, matching the mockup. */}
                    <PlusIcon className="size-6" />
                </button>
            )}
        </section>
    );
};
