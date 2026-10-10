/**
 * @module @commise/features-recipes — the native My recipes RESULTS (`docs/design/uiOverhaul/buildSpec.md` §4.3), the
 * twin of the web leaf: the facet chips with their counts and the result bar (count, sort sheet, list/grid switch),
 * the refresh notice, then the body the host's `LibraryState` names — the first run, a no-match, or the cards in the
 * decided variant in a virtualised list — then "Load more" past 500 recipes, and the create button wherever
 * `shouldShowCreateButton` keeps it.
 *
 * While the frame is collapsed (a short screen with the keyboard open) the chips and the button step aside so the field
 * and the first results stay in view. Pure `props → JSX`: the host reads, narrows and decides.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { Chip, ChipRow } from '@commise/ui/chip';
import { contentWidthOf } from '@commise/ui/container-class';
import { useFrameCollapsed } from '@commise/ui/layout';
import { LoadMoreControl } from '@commise/ui/load-more';
import { nativeTokens } from '@commise/ui/native';
import { RefreshNotice } from '@commise/ui/refresh-notice';
import { SegmentedControl } from '@commise/ui/segmented-control';
import { useTheme } from '@commise/ui/theme';
import { FlashList } from '@shopify/flash-list';
import type { FC, ReactElement } from 'react';
import { RefreshControl, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { GRID_GAP, libraryGridColumnsOf } from '../card/cardGridLayout.js';
import { LIST_VIEW_MODES, isListViewMode } from '../card/cardVariant.js';
import { RecipeCard } from '../card/RecipeCard.native.js';
import { recipeMessages } from '../messages.js';
import { LibrarySortMenu } from './LibrarySortMenu.native.js';
import { RecipeCreateButton } from './RecipeCreateButton.native.js';
import { formatRecipeCount, shouldShowCreateButton, type RecipeListResultsProps } from './model.js';
import { fillTemplate } from '../format/fillTemplate.js';

/** The first run: the two ways to start. */
const FirstRun: FC<Pick<RecipeListResultsProps, 'onCreateRecipe' | 'onPasteIngredients'>> = ({
    onCreateRecipe,
    onPasteIngredients,
}) => {
    const { list } = useMessages(recipeMessages);
    const { colors } = useTheme();

    return (
        <View style={styles.firstRun}>
            <Text role="heading" aria-level={2} style={[styles.sectionTitle, { color: colors.ink }]}>
                {list.emptyTitle}
            </Text>
            <Text style={[styles.body, styles.centred, { color: colors.inkMuted }]}>{list.emptyBody}</Text>
            <Button icon="pencilLine" size="lg" width="fill" onPress={onCreateRecipe}>
                {list.emptyCreateCta}
            </Button>
            {onPasteIngredients === undefined ? null : (
                <Button variant="secondary" icon="clipboardPaste" size="lg" width="fill" onPress={onPasteIngredients}>
                    {list.pasteIngredients}
                </Button>
            )}
        </View>
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
    const { colors } = useTheme();
    const searched = state === 'noMatchQuery' || state === 'noMatchBoth';
    const filtered = state === 'noMatchFilters' || state === 'noMatchBoth';

    return (
        <View collapsable={false} accessibilityLiveRegion="polite" role="status" style={styles.noMatch}>
            <Text role="heading" aria-level={2} style={[styles.sectionTitle, { color: colors.ink }]}>
                {list.noMatchTitle}
            </Text>
            {searched ? (
                <Text style={[styles.body, { color: colors.inkMuted }]}>
                    {fillTemplate(list.noMatchQuery, { query: searchValue.trim() })}
                </Text>
            ) : null}
            {filtered ? <Text style={[styles.body, { color: colors.inkMuted }]}>{list.noMatchFilters}</Text> : null}
            <View style={styles.actions}>
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
            </View>
        </View>
    );
};

export const RecipeListResults: FC<RecipeListResultsProps> = ({
    recipes,
    state,
    searchValue,
    onClearSearch,
    onClearFilters,
    onSelectRecipe,
    variant,
    chipOverflow,
    facets,
    view,
    sort,
    loadMore,
    onCreateRecipe,
    onPasteIngredients,
    refresh,
    refreshNotice,
    renderNutrition,
    scrollBind,
}) => {
    const { width } = useWindowDimensions();
    const collapsed = useFrameCollapsed();
    const { list } = useMessages(recipeMessages);
    const { colors } = useTheme();
    const locale = useLocale();

    if (state === 'firstRun') {
        return <FirstRun onCreateRecipe={onCreateRecipe} onPasteIngredients={onPasteIngredients} />;
    }

    const columns = variant === 'grid' ? libraryGridColumnsOf(contentWidthOf(width)) : 1;
    const count = formatRecipeCount(recipes.length, { one: list.countOne, other: list.countOther }, locale);
    const loadMoreControl =
        loadMore === undefined ? null : (
            <LoadMoreControl
                {...loadMore}
                labels={{
                    loadMore: list.loadMore,
                    loadingMore: list.loadingMore,
                    retry: list.retry,
                    failed: list.loadMoreError,
                }}
            />
        );

    let body: ReactElement;

    if (state === 'results') {
        body = (
            <FlashList
                // A new column count is a new layout: keying on it makes FlashList measure afresh.
                key={columns}
                {...scrollBind}
                data={recipes}
                numColumns={columns}
                keyExtractor={(recipe) => recipe.id}
                renderItem={({ item }) => (
                    <View style={columns > 1 ? styles.gridCell : null}>
                        <RecipeCard
                            variant={variant}
                            recipe={item}
                            onSelect={onSelectRecipe}
                            nutrition={renderNutrition?.(item.id)}
                        />
                    </View>
                )}
                ItemSeparatorComponent={variant === 'row' ? RowSeparator : GridSeparator}
                ListFooterComponent={loadMoreControl}
                style={styles.cardsScroll}
                contentContainerStyle={styles.cards}
                keyboardShouldPersistTaps="handled"
                refreshControl={
                    refresh === undefined ? undefined : (
                        <RefreshControl refreshing={refresh.refreshing} onRefresh={refresh.onRefresh} />
                    )
                }
            />
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
            {!collapsed && facets.facets.length > 0 && (
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

            <View style={styles.resultBar}>
                <Text style={[styles.count, { color: colors.ink }]}>{count}</Text>
                <View style={styles.resultControls}>
                    <LibrarySortMenu value={sort.value} onChange={sort.onChange} />
                    {/* A fixed width: icon-only segments grow to fill their track, and a row gives them no bound. */}
                    <View style={styles.viewSwitch}>
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
                    </View>
                </View>
            </View>

            {refreshNotice !== undefined && (
                <RefreshNotice
                    failed={refreshNotice.failed}
                    refreshing={refreshNotice.refreshing}
                    onRetry={refreshNotice.onRetry}
                    labels={{ failed: list.refreshError, retry: list.retry }}
                />
            )}

            {body}

            {!collapsed && shouldShowCreateButton({ recipeCount: recipes.length, narrowed: true }) && (
                <RecipeCreateButton onCreateRecipe={onCreateRecipe} />
            )}
        </>
    );
};

const RowSeparator: FC = () => <View style={styles.rowSeparator} />;
const GridSeparator: FC = () => <View style={styles.gridSeparator} />;

const styles = StyleSheet.create({
    firstRun: {
        alignItems: 'center',
        alignSelf: 'center',
        width: '100%',
        maxWidth: 448,
        gap: nativeTokens.spacing[3],
        paddingVertical: nativeTokens.spacing[8],
    },
    noMatch: { gap: nativeTokens.spacing[3], alignItems: 'flex-start', paddingVertical: nativeTokens.spacing[6] },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: nativeTokens.spacing[3] },
    sectionTitle: { ...nativeTokens.type.sectionTitle },
    body: { ...nativeTokens.type.body },
    centred: { textAlign: 'center' },
    resultBar: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        columnGap: nativeTokens.spacing[3],
        rowGap: nativeTokens.spacing[2],
    },
    resultControls: { flexDirection: 'row', alignItems: 'center', gap: nativeTokens.spacing[2] },
    viewSwitch: { width: 112 },
    count: { ...nativeTokens.type.label, fontVariant: ['tabular-nums', 'lining-nums'] },
    cardsScroll: { flex: 1 },
    cards: { paddingBottom: nativeTokens.spacing[5] },
    gridCell: { flex: 1, paddingHorizontal: GRID_GAP / 2 },
    rowSeparator: { height: nativeTokens.spacing[2] },
    gridSeparator: { height: GRID_GAP },
});
