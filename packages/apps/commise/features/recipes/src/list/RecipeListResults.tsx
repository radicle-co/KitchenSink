'use client';

/**
 * @module @commise/features-recipes — the web My recipes RESULTS (`docs/design/uiOverhaul/buildSpec.md` §4.3): what
 * renders inside the list's suspense boundary once the library has settled.
 *
 * The facet chips with their counts and the result bar (count, sort, list/grid switch), the notice for a failed refresh,
 * then the body the host's `LibraryState` names — the first run, a no-match for a search, for chips or for both, or the
 * cards in the variant the host decided — then "Load more" past 500 recipes, and the create button wherever
 * `shouldShowCreateButton` keeps it. Pure `props → JSX`: the host reads, narrows and decides.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { Chip, ChipRow } from '@commise/ui/chip';
import { LoadMoreControl } from '@commise/ui/load-more';
import { RefreshNotice } from '@commise/ui/refresh-notice';
import { SegmentedControl } from '@commise/ui/segmented-control';
import { useId, type FC, type ReactElement } from 'react';

import { GRID_CELL_CLASS, LIBRARY_GRID_CLASS, LIBRARY_LIST_CLASS } from '../card/cardGridClass.js';
import { LIST_VIEW_MODES, isListViewMode } from '../card/cardVariant.js';
import { RecipeCard } from '../card/RecipeCard.js';
import { recipeMessages } from '../messages.js';
import { LibrarySortMenu } from './LibrarySortMenu.js';
import { RecipeCreateButton } from './RecipeCreateButton.js';
import { fillTemplate, formatRecipeCount, shouldShowCreateButton, type RecipeListResultsProps } from './model.js';

/** The first run: the two ways to start, stacked below a 600 container and side by side above. */
const FirstRun: FC<Pick<RecipeListResultsProps, 'onCreateRecipe' | 'onPasteIngredients'>> = ({
    onCreateRecipe,
    onPasteIngredients,
}) => {
    const { list } = useMessages(recipeMessages);

    return (
        <section className="mx-auto flex w-full max-w-[28rem] flex-col items-center gap-3 py-8 text-center">
            <h2 className="text-section-title text-ink">{list.emptyTitle}</h2>
            <p className="text-body text-ink-muted">{list.emptyBody}</p>
            <div className="flex w-full flex-col gap-3 @regular/main:w-auto @regular/main:flex-row">
                <Button icon="pencilLine" size="lg" width="fill" onPress={onCreateRecipe}>
                    {list.emptyCreateCta}
                </Button>
                {onPasteIngredients === undefined ? null : (
                    <Button
                        variant="secondary"
                        icon="clipboardPaste"
                        size="lg"
                        width="fill"
                        onPress={onPasteIngredients}
                    >
                        {list.pasteIngredients}
                    </Button>
                )}
            </div>
        </section>
    );
};

/** A no-match: what narrowed the rows, and the action that clears it. */
const NoMatch: FC<Pick<RecipeListResultsProps, 'state' | 'searchValue' | 'onClearSearch' | 'onClearFilters'>> = ({
    state,
    searchValue,
    onClearSearch,
    onClearFilters,
}) => {
    const { list } = useMessages(recipeMessages);
    const searched = state === 'noMatchQuery' || state === 'noMatchBoth';
    const filtered = state === 'noMatchFilters' || state === 'noMatchBoth';

    return (
        // A status region: it is announced, and its heading takes no focus — focus stays in the search field (§4.6).
        <div role="status" className="flex flex-col items-start gap-3 py-6">
            <h2 className="text-section-title text-ink">{list.noMatchTitle}</h2>
            {searched ? (
                <p className="text-body text-ink-muted">
                    {fillTemplate(list.noMatchQuery, { query: searchValue.trim() })}
                </p>
            ) : null}
            {filtered ? <p className="text-body text-ink-muted">{list.noMatchFilters}</p> : null}
            <div className="flex flex-wrap gap-3">
                {filtered ? (
                    <Button variant="secondary" icon="x" onPress={onClearFilters}>
                        {list.clearFilters}
                    </Button>
                ) : null}
                {searched ? (
                    <Button variant="secondary" icon="x" onPress={onClearSearch}>
                        {list.clearSearch}
                    </Button>
                ) : null}
            </div>
        </div>
    );
};

export const RecipeListResults: FC<RecipeListResultsProps> = ({
    recipes,
    state,
    searchValue,
    onClearSearch,
    onClearFilters,
    onSelectRecipe,
    hrefOf,
    variant,
    chipOverflow,
    facets,
    view,
    sort,
    loadMore,
    onCreateRecipe,
    onPasteIngredients,
    refreshNotice,
    renderNutrition,
}) => {
    const { list } = useMessages(recipeMessages);
    const locale = useLocale();
    const countId = useId();
    const count = formatRecipeCount(recipes.length, { one: list.countOne, other: list.countOther }, locale);
    const isGrid = variant === 'grid';

    if (state === 'firstRun') {
        // No chips, no result bar, no button: the block's own two actions are the only way in.
        return <FirstRun onCreateRecipe={onCreateRecipe} onPasteIngredients={onPasteIngredients} />;
    }

    let body: ReactElement;

    if (state === 'results') {
        body = (
            <ul aria-labelledby={countId} className={isGrid ? LIBRARY_GRID_CLASS : LIBRARY_LIST_CLASS}>
                {recipes.map((recipe) => (
                    <li key={recipe.id} className={isGrid ? GRID_CELL_CLASS : undefined}>
                        {/* ONE promise, N slots: the host's renderer closes over the library's single nutrition
                            batch, so the figures cost one request and land together. */}
                        <RecipeCard
                            variant={variant}
                            recipe={recipe}
                            onSelect={onSelectRecipe}
                            {...(hrefOf === undefined ? {} : { href: hrefOf(recipe.id) })}
                            nutrition={renderNutrition?.(recipe.id)}
                        />
                    </li>
                ))}
            </ul>
        );
    } else {
        body = (
            <NoMatch
                state={state}
                searchValue={searchValue}
                onClearSearch={onClearSearch}
                onClearFilters={onClearFilters}
            />
        );
    }

    return (
        <>
            {facets.facets.length > 0 && (
                <ChipRow mode="filter" label={list.filtersLabel} overflow={chipOverflow}>
                    <Chip
                        kind="filter"
                        label={list.filterAll}
                        selected={facets.facets.every((facet) => !facet.selected)}
                        onPress={facets.onClear}
                    />
                    {facets.facets.map((facet) => (
                        <Chip
                            key={facet.value}
                            kind="filter"
                            label={facet.label}
                            count={facet.count}
                            selected={facet.selected}
                            onPress={() => facets.onToggle(facet.value)}
                        />
                    ))}
                </ChipRow>
            )}

            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                <p id={countId} className="text-meta font-semibold text-ink tabular-nums lining-nums">
                    {count}
                </p>
                <div className="flex items-center gap-2">
                    <LibrarySortMenu value={sort.value} onChange={sort.onChange} />
                    <SegmentedControl
                        form="view"
                        label={list.viewLabel}
                        labelVisibility="hidden"
                        value={view.mode}
                        onChange={(mode) => {
                            if (isListViewMode(mode)) {
                                view.onChange(mode);
                            }
                        }}
                        segments={LIST_VIEW_MODES.map((mode) => ({
                            id: mode,
                            label: mode === 'list' ? list.viewList : list.viewGrid,
                            icon: mode === 'list' ? 'list' : 'layoutGrid',
                        }))}
                    />
                </div>
            </div>

            {refreshNotice !== undefined && (
                <RefreshNotice
                    failed={refreshNotice.failed}
                    refreshing={refreshNotice.refreshing}
                    onRetry={refreshNotice.onRetry}
                    labels={{ failed: list.refreshError, retry: list.retry }}
                />
            )}

            {body}

            {loadMore === undefined ? null : (
                <LoadMoreControl
                    {...loadMore}
                    labels={{
                        loadMore: list.loadMore,
                        loadingMore: list.loadingMore,
                        retry: list.retry,
                        failed: list.loadMoreError,
                    }}
                />
            )}

            {/* The policy owns ONE side of "exactly one create affordance": the first-run block above is the other. */}
            {shouldShowCreateButton({ recipeCount: recipes.length, narrowed: true }) && (
                <RecipeCreateButton onCreateRecipe={onCreateRecipe} />
            )}
        </>
    );
};
