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
import { recipeMessages } from '../messages.js';
import { SpeedDial } from '../speedDial/SpeedDial.js';
import { RecipeListCard } from './RecipeListCard.js';
import { RecipeSourceTabs } from './RecipeSourceTabs.js';
import {
    filterChipLabel,
    formatRecipeCount,
    isListNarrowed,
    shouldShowCreateDial,
    type RecipeListViewProps,
} from './model.js';

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
    renderNutrition,
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

    // Whether the pinned create dial (L1) is mounted. Both gates — never over a TRUE empty library, never on
    // the Community tab — live in the ONE `shouldShowCreateDial` policy, which the other platform's leaf
    // calls too, so the two cannot drift on it.
    //
    // ⚠️ The policy owns ONE SIDE of a two-sided invariant. The rule it serves is "exactly one create
    // affordance is on screen", and the other side — the empty-state CTA above — is still spelled inline in
    // each leaf as the complement of this condition. Nothing structural keeps the two in step; what does is
    // the pair of assertions in this leaf's tests, which check the true-empty and the narrowed-zero branches
    // from BOTH directions. Widen this policy into the affordance itself before adding a third branch.
    const showDial = shouldShowCreateDial({
        status,
        recipeCount: recipes.length,
        narrowed,
        onCommunity,
    });

    return (
        <section aria-label={list.heading} className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8">
            {/* U8: the heading rides a beach-glow gradient title band (mockup recipe-list). */}
            <GradientSurface gradient="hero" className="rounded-2xl">
                <header className="flex items-center justify-between gap-4 p-6">
                    <h1 className="font-display text-display-md font-bold text-charcoal">{list.heading}</h1>
                </header>
            </GradientSurface>

            {/* The source switcher (L5) is the ONE shared `RecipeSourceTabs` — the same strip the community
                surface mounts, so the pair stays symmetric and a viewer can always get back. */}
            {tab !== undefined && <RecipeSourceTabs tab={tab} />}

            <input
                type="search"
                aria-label={list.searchLabel}
                placeholder={list.searchPlaceholder}
                value={searchValue}
                onChange={(event) => onSearchChange(event.target.value)}
                // Placeholder text is TEXT: `placeholder:text-slate`, never `mist` (palette JSDoc,
                // `@commise/ui`'s `tokens/colors.ts`). The `border-border` hairline stays `mist`-derived.
                className="w-full rounded-full border border-border bg-card px-5 py-3 text-body-md text-charcoal shadow-sm outline-none placeholder:text-slate focus:ring-2 focus:ring-seafoam"
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

            {showDial && (
                // U34: the pinned FAB now DISCLOSES the creation destinations rather than running the only
                // one. Adding Scan / Import / AI when 004 and 005 ship is a change to THIS LIST — which is
                // the whole reason the owner chose the dial over the button it replaces, knowing that until a
                // second destination is real it costs one extra tap on the primary path.
                <SpeedDial
                    triggerLabel={list.createCta}
                    menuLabel={list.createMenuLabel}
                    actions={[{ id: 'scratch', label: list.createFromScratch, onSelect: onCreateRecipe }]}
                />
            )}
        </section>
    );
};
