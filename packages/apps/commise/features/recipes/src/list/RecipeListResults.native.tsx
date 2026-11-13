/**
 * @module @commise/features-recipes — the native My recipes RESULTS (`docs/design/uiOverhaul/buildSpec.md` §4.3), the
 * twin of the web leaf: the facet chips with their counts and the result bar (count, sort sheet, list/grid switch),
 * the refresh notice, then the body the host's `LibraryState` names — the first run, a no-match, or the cards in the
 * decided variant — in ONE virtualised list whose foot clears the floating create button in every state, then "Load
 * more" past 500 recipes. The floating create button is the FRAME's
 * (outside the read boundary, so it also shows offline).
 *
 * While the frame is collapsed (a short screen with the keyboard open) the chips step aside so the field
 * and the first results stay in view. Pure `props → JSX`: the host reads, narrows and decides.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { Chip, ChipRow } from '@commise/ui/chip';
import { contentWidthOf } from '@commise/ui/container-class';
import { useFrameCollapsed } from '@commise/ui/layout';
import { useFabReservedBottom } from '@commise/ui/create-fab';
import { LoadMoreControl } from '@commise/ui/load-more';
import { nativeTokens } from '@commise/ui/native';
import { RefreshNotice } from '@commise/ui/refresh-notice';
import { SegmentedControl } from '@commise/ui/segmented-control';
import { Text } from '@commise/ui/text';
import { FlashList } from '@shopify/flash-list';
import { useContext, type FC, type ReactElement } from 'react';
import { RefreshControl, StyleSheet, View, useWindowDimensions } from 'react-native';

import { cappedFontScale } from '@commise/ui/font-scale-cap';
import { GRID_GAP, columnsOfVariant } from '../card/cardGridLayout.js';
import { LIST_VIEW_MODES, isListViewMode } from '../card/cardVariant.js';
import { RecipeCard } from '../card/RecipeCard.native.js';
import { recipeMessages } from '../messages.js';
import { LibrarySortMenu } from './LibrarySortMenu.native.js';
import {
    formatRecipeCount,
    type RecipeListItem,
    type RecipeListReading,
    type RecipeListResultsProps,
} from './model.js';
import { fillTemplate } from '@commise/i18n';
import { HostAnimatedScroll } from './HostAnimatedScroll.native.js';
import { RecipeListHeaderContext } from './recipeListHeaderContext.js';
import { ListEdge } from './RecipeListLayout.native.js';

/** The first run: the two ways to start. */
const FirstRun: FC<Pick<RecipeListResultsProps, 'onCreateRecipe' | 'onPasteIngredients'>> = ({
    onCreateRecipe,
    onPasteIngredients,
}) => {
    const { list } = useMessages(recipeMessages);

    return (
        <View style={styles.firstRun}>
            <Text role="heading" aria-level={2} typeRole="sectionTitle">
                {list.emptyTitle}
            </Text>
            <Text typeRole="body" color="$inkMuted" textAlign="center">
                {list.emptyBody}
            </Text>
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
    const searched = state === 'noMatchQuery' || state === 'noMatchBoth';
    const filtered = state === 'noMatchFilters' || state === 'noMatchBoth';

    return (
        <View collapsable={false} accessibilityLiveRegion="polite" role="status" style={styles.noMatch}>
            <Text role="heading" aria-level={2} typeRole="sectionTitle">
                {list.noMatchTitle}
            </Text>
            {searched ? (
                <Text typeRole="body" color="$inkMuted">
                    {fillTemplate(list.noMatchQuery, { query: searchValue.trim() })}
                </Text>
            ) : null}
            {filtered ? (
                <Text typeRole="body" color="$inkMuted">
                    {list.noMatchFilters}
                </Text>
            ) : null}
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
    clearCount,
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
    reading = SETTLED,
}) => {
    const { width, fontScale } = useWindowDimensions();
    const fabRoom = useFabReservedBottom();
    const collapsed = useFrameCollapsed();
    const { list } = useMessages(recipeMessages);
    const locale = useLocale();
    // The title, avatar, segments and search the frame owns, as its first child: it never moves when the rest changes.
    const header = useContext(RecipeListHeaderContext);

    const settled = reading.kind === 'settled';
    const showingRows = settled && state === 'results';
    const textScale = cappedFontScale(fontScale);
    const columns = columnsOfVariant(variant, contentWidthOf(width), textScale);
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
    let emptyBody: ReactElement | null = null;

    if (!settled) {
        emptyBody = reading.body;
    } else if (state === 'firstRun') {
        emptyBody = <FirstRun onCreateRecipe={onCreateRecipe} onPasteIngredients={onPasteIngredients} />;
    } else if (!showingRows) {
        emptyBody = (
            <NoMatch
                state={state}
                searchValue={searchValue}
                onClearSearch={onClearSearch}
                onClearFilters={onClearFilters}
            />
        );
    }

    // Chips, the result bar and the refresh notice sit AFTER the header group, as a separate sibling, so they appear and
    // go (settling, the keyboard collapsing the frame) without moving the field's index in its parent.
    const settledHeader =
        settled && state !== 'firstRun' ? (
            <ListEdge>
                {!collapsed && facets.facets.length > 0 && (
                    <ChipRow key={clearCount} mode="filter" label={list.filtersLabel} overflow={chipOverflow}>
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
                    <Text typeRole="label" figures>
                        {count}
                    </Text>
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
            </ListEdge>
        ) : null;

    // A plain FlashList over `HostAnimatedScroll`: the host's scroll offset is attached to the scroller natively, and FlashList
    // keeps its own handler. (`AnimatedFlashList` threw "Maximum update depth exceeded" on both platforms.)
    // ONE scroller for every state (designer ruling 2026-11-01): the header, the first run and a no-match are its
    // content, so they scroll away with the cards and end with the same room for the floating create button. A new layout is
    // a NEW list: keyed on the variant and the column count, FlashList starts with an empty size cache. In place, a Grid to
    // List switch left one stale slot (cells measured at 199, re-measured at 104.67, a 111 pt gap, qa-ios r4), and the 320 pt
    // rule changes the columns with the text scale. The text scale is in the key on its own too: it re-lays the whole list out
    // (taller header, taller rows), and the host's offset, written only by native scroll events, kept its pinned value over a list
    // that sat at the top again (the field floated over the title at its old place, qa-ios PinReset_TextScaleToCap). A new scroller
    // resets the host. The search field is drawn by the frame, outside this list, so the remount keeps its focus.
    return (
        <FlashList
            key={`${variant}-${String(columns)}-${String(textScale)}`}
            {...scrollBind}
            renderScrollComponent={HostAnimatedScroll}
            data={showingRows ? recipes : []}
            numColumns={columns}
            keyExtractor={(recipe: RecipeListItem) => recipe.id}
            renderItem={({ item }: { readonly item: RecipeListItem }) => (
                <ListEdge>
                    <View style={columns > 1 ? styles.gridCell : null}>
                        <RecipeCard
                            variant={variant}
                            showEdited
                            fullMeta
                            headingLevel={2}
                            recipe={item}
                            onSelect={onSelectRecipe}
                            nutrition={renderNutrition?.(item.id)}
                        />
                    </View>
                </ListEdge>
            )}
            ItemSeparatorComponent={variant === 'row' ? RowSeparator : GridSeparator}
            ListHeaderComponent={
                <View>
                    {header}
                    {settledHeader}
                </View>
            }
            ListEmptyComponent={emptyBody === null ? null : <ListEdge>{emptyBody}</ListEdge>}
            ListFooterComponent={showingRows ? <ListEdge>{loadMoreControl}</ListEdge> : null}
            style={styles.cardsScroll}
            contentContainerStyle={{ paddingBottom: fabRoom }}
            keyboardShouldPersistTaps="handled"
            // Always mounted: adding a RefreshControl to a live list can reset its offset on iOS. A pull re-reads the
            // library in every state, and from the failed state it shows the same loading as Try again.
            refreshControl={
                refresh === undefined ? undefined : (
                    <RefreshControl refreshing={refresh.refreshing} onRefresh={refresh.onRefresh} />
                )
            }
        />
    );
};

const SETTLED: RecipeListReading = { kind: 'settled' };

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
    resultBar: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        columnGap: nativeTokens.spacing[3],
        rowGap: nativeTokens.spacing[2],
    },
    // Wraps: at the largest font scale the sort and the view switch together are wider than the screen (A-028).
    resultControls: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: nativeTokens.spacing[2],
        flexShrink: 1,
    },
    viewSwitch: { width: 112 },
    cardsScroll: { flex: 1 },
    // The floating create button is drawn over the foot of the list (§3.4): reserve it in every state, the empty ones
    // too (they are the list's empty body).
    // No `flex: 1`: a cell that grows vertically fills the recycler's ESTIMATE and is measured at it, which left a blank slot
    // between rows. The cell takes its tile's height, and its width from the column.
    gridCell: { paddingHorizontal: GRID_GAP / 2 },
    rowSeparator: { height: nativeTokens.spacing[2] },
    gridSeparator: { height: GRID_GAP },
});
