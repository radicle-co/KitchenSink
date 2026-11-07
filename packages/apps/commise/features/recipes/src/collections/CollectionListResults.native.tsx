/**
 * @module @commise/features-recipes — native collection-list RESULTS (presentational): what renders inside the list's suspense boundary
 * once the read has settled.
 *
 * The React Native leaf of `CollectionListResults`: the refresh notice, then the empty state or the rows, with the
 * server-paged `[Load more]` control (W5/C7) as the list footer. U4: the rows are virtualized with FlashList v2 (v2
 * auto-measures — no `estimatedItemSize`), pull-to-refresh is wired through the recycler, and the styles derive from
 * the shared design scale (`nativeTokens`).
 */
import { useFabReservedBottom } from '@commise/ui/create-fab';
import { LoadMoreControl } from '@commise/ui/load-more';
import { useLocale, useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { contentWidthOf, containerClassOf } from '@commise/ui/container-class';
import { Icon } from '@commise/ui/icon';
import { nativeTokens } from '@commise/ui/native';
import { PressScale } from '@commise/ui/press-scale';
import { RecipeCover } from '@commise/ui/recipe-cover';
import { RefreshNotice } from '@commise/ui/refresh-notice';
import { Text } from '@commise/ui/text';
import { useTheme } from '@commise/ui/theme';
import { FlashList } from '@shopify/flash-list';
import { useContext, type FC } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';

import { cappedFontScale } from '@commise/ui/font-scale-cap';
import { compactColumnsOf, libraryGridColumnsOf } from '../card/cardGridLayout.js';
import { HostAnimatedScroll } from '../list/HostAnimatedScroll.native.js';
import { formatRecipeCount } from '../list/model.js';
import { RecipeListHeaderContext } from '../list/recipeListHeaderContext.js';
import { recipeMessages } from '../messages.js';
import { fillTemplate } from '../format/fillTemplate.js';
import { collectionMessages } from './messages.js';
import { bylineMessages } from '../byline/messages.js';
import { sourceOwnerBylineText } from './sourceOwnerByline.js';
import { cardCoverOf, type CollectionCardSource, type CollectionListResultsProps } from './model.js';

export const CollectionListResults: FC<CollectionListResultsProps> = ({
    collections,
    total,
    onSelect,
    search,
    firstRun,
    loadMore,
    refresh,
    refreshNotice,
    scrollBind,
}) => {
    const { list } = useMessages(collectionMessages);
    const locale = useLocale();
    // The frame's large title and segments, which this list draws as its first child so they scroll away with it.
    const header = useContext(RecipeListHeaderContext);
    const fabRoom = useFabReservedBottom();
    const { width, fontScale } = useWindowDimensions();
    const contentWidth = contentWidthOf(width);
    // On a phone, two columns while a column keeps 320 pt at the capped text scale, else one (designer rule, 2026-11-02); from
    // a 600 container, as many columns of at least 240 as fit (§5.1).
    const textScale = cappedFontScale(fontScale);
    const columns =
        containerClassOf(contentWidth) === 'narrow'
            ? compactColumnsOf(contentWidth, textScale)
            : libraryGridColumnsOf(contentWidth);

    if (total === 0) {
        // A scroller, not a bare View: at the largest text size the block is taller than the screen, and "New collection"
        // must stay reachable. It ends with the room the floating button needs (`cards`), as the populated list does.
        return (
            <ScrollView contentContainerStyle={{ paddingBottom: fabRoom }} keyboardShouldPersistTaps="handled">
                {header}
                <View style={styles.firstRun}>
                    <Text role="heading" aria-level={2} typeRole="sectionTitle">
                        {list.emptyTitle}
                    </Text>
                    <Text typeRole="body" color="$inkMuted" textAlign="center">
                        {list.emptyBody}
                    </Text>
                    {/* "New collection" is the frame's floating button (shared with New recipe), so only the no-recipes case
                        needs a start button of its own: a collection needs recipes first. */}
                    {firstRun.hasRecipes ? null : (
                        <>
                            <Text typeRole="body" color="$inkMuted">
                                {list.needRecipes}
                            </Text>
                            <Button icon="pencilLine" size="lg" width="fill" onPress={firstRun.onAddRecipe}>
                                {list.addRecipe}
                            </Button>
                        </>
                    )}
                </View>
            </ScrollView>
        );
    }

    return (
        <FlashList
            keyboardShouldPersistTaps="handled"
            key={`${String(columns)}-${String(textScale)}`}
            {...scrollBind}
            // The host's offset reaches the pinned search through this scroller (a plain one left it at 0: no slide, no band).
            renderScrollComponent={HostAnimatedScroll}
            data={collections}
            numColumns={columns}
            keyExtractor={(collection) => collection.id}
            renderItem={({ item }) => (
                <View style={columns > 1 ? styles.cell : null}>
                    <CollectionCard collection={item} onSelect={onSelect} />
                </View>
            )}
            ItemSeparatorComponent={CardSeparator}
            // The frame's header (title, segments, and the pinned search's spacer) is the list's first child, full width; the count and
            // the refresh notice follow it, inside the list's side padding. A new layout, and a new text scale, is a NEW list (the key
            // above): FlashList starts with an empty size cache, and the host resets its scroll offset when the new scroller attaches.
            ListHeaderComponent={
                <View>
                    <View style={styles.headerBleed}>{header}</View>
                    <Text typeRole="label" figures>
                        {formatRecipeCount(total, { one: list.countOne, other: list.countOther }, locale)}
                    </Text>
                    {refreshNotice !== undefined && (
                        <RefreshNotice
                            failed={refreshNotice.failed}
                            refreshing={refreshNotice.refreshing}
                            onRetry={refreshNotice.onRetry}
                            labels={{ failed: list.refreshError, retry: list.retry }}
                        />
                    )}
                </View>
            }
            ListEmptyComponent={
                <Text role="status" typeRole="body" color="$inkMuted">
                    {fillTemplate(list.noMatch, { query: search.value.trim() })}
                </Text>
            }
            ListFooterComponent={
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
                )
            }
            style={styles.cardsScroll}
            contentContainerStyle={{ paddingBottom: fabRoom, paddingHorizontal: nativeTokens.spacing[4] }}
            refreshControl={
                refresh !== undefined ? (
                    <RefreshControl refreshing={refresh.refreshing} onRefresh={refresh.onRefresh} />
                ) : undefined
            }
        />
    );
};

/**
 * A card's cover (`buildSpec.md` §5.1): the first four members' photos as a 2 × 2 album with 2 pt gaps, the first photo
 * filling the box when there are one to three, the collection's tint and monogram when there are none.
 */
const CollectionCover: FC<{ readonly collection: CollectionCardSource }> = ({ collection }) => {
    const cover = cardCoverOf(collection.coverPhotoUrls);

    if (cover.kind === 'album') {
        return (
            <View style={styles.album}>
                {cover.urls.map((url, index) => (
                    <View key={url + String(index)} style={styles.albumTile}>
                        <RecipeCover
                            recipeId={`${collection.id}:${String(index)}`}
                            title={collection.name}
                            aspect="1:1"
                            photoUrl={url}
                        />
                    </View>
                ))}
            </View>
        );
    }

    return (
        <RecipeCover
            recipeId={collection.id}
            title={collection.name}
            aspect="1:1"
            {...(cover.kind === 'single' ? { photoUrl: cover.url } : {})}
        />
    );
};

/** One album card: the cover, the name (two lines), the count and visibility, and a copy's credit. */
const CollectionCard: FC<{ readonly collection: CollectionCardSource; readonly onSelect: (id: string) => void }> = ({
    collection,
    onSelect,
}) => {
    const { list, detail } = useMessages(collectionMessages);
    // A copy's credit: its source owner through the one byline rule (plan 2026-10-15-010 D11).
    const copiedFrom = sourceOwnerBylineText(collection, useMessages(bylineMessages), 'sentence');
    const { card } = useMessages(recipeMessages);
    const { colors } = useTheme();
    const locale = useLocale();
    const visibility = collection.visibility === 'public' ? list.visibilityPublic : list.visibilityPrivate;
    // The count is on the list read (W-11); a body that carries none says none, never a made-up 0.
    const count =
        collection.recipeCount === undefined
            ? undefined
            : formatRecipeCount(
                  collection.recipeCount,
                  { one: detail.recipeCountOne, other: detail.recipeCountOther },
                  locale,
              );

    return (
        <PressScale
            accessibilityRole="link"
            accessibilityLabel={
                count === undefined
                    ? fillTemplate(list.cardLabel, { name: collection.name, visibility })
                    : fillTemplate(list.cardLabelCounted, { name: collection.name, count, visibility })
            }
            width="fill"
            onPress={() => onSelect(collection.id)}
        >
            <View style={[styles.card, { backgroundColor: colors.paper, borderColor: colors.lineDivider }]}>
                <View style={styles.clip}>
                    <CollectionCover collection={collection} />
                    <View style={styles.cardBody}>
                        <Text numberOfLines={2} typeRole="cardTitle">
                            {collection.name}
                        </Text>
                        <View style={styles.meta}>
                            {count === undefined ? null : (
                                <>
                                    <Text typeRole="meta" color="$inkMuted">
                                        {count}
                                    </Text>
                                    <Text accessible={false} typeRole="meta" color="$inkMuted">
                                        {card.separator.trim()}
                                    </Text>
                                </>
                            )}
                            <Icon
                                name={collection.visibility === 'public' ? 'globe' : 'lock'}
                                size={16}
                                tone="inkMuted"
                            />
                            <Text typeRole="meta" color="$inkMuted">
                                {visibility}
                            </Text>
                        </View>
                        {copiedFrom === undefined ? null : (
                            <Text numberOfLines={1} typeRole="caption" color="$inkMuted">
                                {fillTemplate(list.copiedFrom, { byline: copiedFrom })}
                            </Text>
                        )}
                    </View>
                </View>
            </View>
        </PressScale>
    );
};

/** The inter-card spacer for the virtualized list (FlashList lays cells out itself, so gap is a separator). */
const CardSeparator: FC = () => <View style={styles.cardSeparator} />;

const styles = StyleSheet.create({
    firstRun: {
        alignItems: 'center',
        alignSelf: 'center',
        width: '100%',
        maxWidth: 448,
        gap: nativeTokens.spacing[3],
        paddingVertical: nativeTokens.spacing[8],
        paddingHorizontal: nativeTokens.spacing[4],
    },
    cardsScroll: { flex: 1 },
    // The frame's header insets its own sides, so under the list's 16 pt side padding it steps back out by that much.
    headerBleed: { marginHorizontal: -nativeTokens.spacing[4] },
    cardSeparator: { height: nativeTokens.spacing[4] },
    // No `flex: 1`: a cell that grows vertically fills the recycler's ESTIMATE and is measured at it, which left a blank slot
    // between rows. The cell takes its card's height, and its width from the column.
    cell: { paddingHorizontal: nativeTokens.spacing[2] },
    card: { borderRadius: nativeTokens.radius.md, borderWidth: StyleSheet.hairlineWidth, ...nativeTokens.elevation.sm },
    clip: { borderRadius: nativeTokens.radius.md, overflow: 'hidden' },
    cardBody: { padding: nativeTokens.spacing[3], gap: nativeTokens.spacing[1] },
    meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: nativeTokens.spacing[1] },
    album: { flexDirection: 'row', flexWrap: 'wrap', gap: 2 },
    albumTile: { flexBasis: '49%', flexGrow: 1 },
});
