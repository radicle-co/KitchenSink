'use client';

/**
 * @module @commise/features-recipes — web recipe-list RESULTS (presentational): what renders inside the list's
 * suspense boundary once the library has settled.
 *
 * The quick-filter chips (derived from the loaded library, so they exist only here), the notice for a failed refresh
 * of the rows on screen, then one of three bodies — the first-run empty library, a no-match for the viewer's own
 * narrowing, or the populated grid — and the create dial wherever {@link shouldShowCreateDial} keeps it.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { RefreshNotice } from '@commise/ui/refresh-notice';
import type { FC, ReactElement } from 'react';

import { recipeMessages } from '../messages.js';
import { RecipeCreateDial } from './RecipeCreateDial.js';
import { RecipeListCard } from './RecipeListCard.js';
import { filterChipLabel, formatRecipeCount, shouldShowCreateDial, type RecipeListResultsProps } from './model.js';

export const RecipeListResults: FC<RecipeListResultsProps> = ({
    recipes,
    narrowed,
    onSelectRecipe,
    onCreateRecipe,
    onPasteIngredients,
    filters,
    refreshNotice,
    renderNutrition,
}) => {
    const { list } = useMessages(recipeMessages);
    const locale = useLocale();

    let body: ReactElement;

    if (recipes.length === 0) {
        // A narrowed zero (search term or pressed chip) is a NO-MATCH, not "no recipes yet" — the caller HAS recipes.
        body = (
            <div className="flex flex-col items-start gap-3">
                <p>{narrowed ? list.noMatchTitle : list.emptyTitle}</p>
                <p>{narrowed ? list.noMatchBody : list.emptyBody}</p>
                {!narrowed && (
                    // Empty-state CTA — the SOLE create control here (the dial is suppressed on a true empty library so
                    // there are never two competing create affordances).
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
                            {/* ONE promise, N slots: the host's renderer closes over the page's single
                                nutrition batch, so this grid's figures cost one request and land together. */}
                            <RecipeListCard
                                recipe={recipe}
                                onSelect={onSelectRecipe}
                                nutrition={renderNutrition?.(recipe.id)}
                            />
                        </li>
                    ))}
                </ul>
            </div>
        );
    }

    return (
        <>
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

            {refreshNotice !== undefined && (
                <RefreshNotice
                    failed={refreshNotice.failed}
                    refreshing={refreshNotice.refreshing}
                    onRetry={refreshNotice.onRetry}
                    labels={{ failed: list.refreshError, retry: list.retry }}
                />
            )}

            {body}

            {/* ⚠️ The policy owns ONE SIDE of a two-sided invariant — "exactly one create affordance is on screen" — and
                the empty-state CTA above is its complement, spelled inline. What keeps the two in step is this leaf's
                tests, which check the true-empty and narrowed-zero branches from BOTH directions. */}
            {shouldShowCreateDial({ recipeCount: recipes.length, narrowed }) && (
                <RecipeCreateDial onCreateRecipe={onCreateRecipe} onPasteIngredients={onPasteIngredients} />
            )}
        </>
    );
};
