/**
 * @module @commise/features-recipes — web recipe-list view (T065 building block).
 *
 * Controlled, presentational recipe list: persistent chrome (heading + search + create) over a body that
 * renders one of four states — loading, error, empty, populated — derived from `status` + `recipes`. It
 * fetches nothing; the composing app wires `useRecipes` (and search) to these props.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import type { FC, ReactElement } from 'react';

import { recipeMessages } from '../messages.js';
import { RecipeListCard } from './RecipeListCard.js';
import { formatRecipeCount, type RecipeListViewProps } from './model.js';

/** The loading placeholder — a busy status region with inert skeleton rows (hidden from assistive tech). */
const LoadingBody: FC<{ label: string }> = ({ label }) => (
    <div role="status" aria-label={label}>
        {[0, 1, 2].map((row) => (
            <span key={row} aria-hidden="true" />
        ))}
    </div>
);

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

    let body: ReactElement;

    if (status === 'loading') {
        body = <LoadingBody label={list.loadingLabel} />;
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
        // Empty ≠ no-match: an active search that filtered every row out is NOT "no recipes yet" (the caller
        // has recipes) — it's a no-match. The Community tab has its own distinct empty copy (L5).
        const searching = searchValue.trim().length > 0;
        const emptyTitle = onCommunity ? list.emptyCommunityTitle : list.emptyTitle;
        const emptyBody = onCommunity ? list.emptyCommunityBody : list.emptyBody;
        body = (
            <div className="flex flex-col items-start gap-3">
                <p>{searching ? list.noMatchTitle : emptyTitle}</p>
                <p>{searching ? list.noMatchBody : emptyBody}</p>
                {!searching && !onCommunity && (
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
    // affordance) AND on the Community tab (L5 — you never create into someone else's list).
    const isEmpty = status === 'ready' && recipes.length === 0 && searchValue.trim().length === 0;
    const showFab = !isEmpty && !onCommunity;

    return (
        <section aria-label={list.heading} className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8">
            <header className="flex items-center justify-between gap-4">
                <h1 className="font-display text-display-md font-bold text-charcoal">{list.heading}</h1>
            </header>

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
                                className={`-mb-px border-b-2 px-4 py-2 text-body-sm font-semibold transition ${
                                    selected
                                        ? 'border-seafoam text-seafoam'
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
                    {filters.available.map((value) => {
                        const active = filters.active.includes(value);

                        return (
                            <button
                                key={value}
                                type="button"
                                aria-pressed={active}
                                onClick={() => filters.onToggle(value)}
                                className={`rounded-full px-3 py-1 text-body-sm font-medium transition ${
                                    active ? 'bg-seafoam text-white' : 'bg-pearl text-slate hover:bg-mist/40'
                                }`}
                            >
                                {value}
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
                    className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-seafoam text-2xl font-bold text-white shadow-lg transition hover:bg-ocean-dark lg:bottom-8"
                >
                    <span aria-hidden="true">+</span>
                </button>
            )}
        </section>
    );
};
