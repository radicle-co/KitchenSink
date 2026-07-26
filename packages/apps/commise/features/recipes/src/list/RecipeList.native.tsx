/**
 * @module @commise/features-recipes — native recipe-list view (T065 building block).
 *
 * The React Native leaf of {@link import('./RecipeList.js').RecipeList} — same controlled, presentational
 * contract and the same four states (loading, error, empty, populated), rendered with RN primitives.
 *
 * U4: the populated rows are virtualized with FlashList v2 (cell recycling; v2 auto-measures, so NO
 * `estimatedItemSize`) instead of a `ScrollView + .map`, the blank loading view became inert card skeletons,
 * pull-to-refresh is wired through the recycler, and the styles derive from the shared design scale
 * (`nativeTokens`) with 44pt touch targets on the source tabs.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { nativeTokens } from '@commise/ui/native';
import { FlashList } from '@shopify/flash-list';
import type { FC, ReactElement } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';

import { recipeMessages } from '../messages.js';
import { RecipeListCard } from './RecipeListCard.native.js';
import { filterChipLabel, formatRecipeCount, type RecipeListViewProps } from './model.js';

/** The inter-card gap, hoisted so the FlashList separator and the header spacer share one value. */
const CARD_GAP = nativeTokens.spacing[3];

/** How many inert skeleton cards the blank loading state renders. */
const SKELETON_COUNT = 3;

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
    refresh,
}) => {
    const { list } = useMessages(recipeMessages);
    const locale = useLocale();
    const onCommunity = tab?.active === 'community';

    let body: ReactElement;

    if (status === 'loading') {
        // Skeleton cards (NOT a blank view — the previous bug): inert, motion-free placeholders shaped like a
        // recipe card, so the surface has structure while the first page loads. Motion-free ⇒ no reduce-motion
        // gate is needed (there is no non-essential animation to suppress). Mirrors the discovery skeletons.
        body = (
            <View accessibilityLabel={list.loadingLabel} style={styles.cards}>
                {Array.from({ length: SKELETON_COUNT }, (_value, index) => (
                    <View key={index} aria-hidden style={styles.skeletonCard} />
                ))}
            </View>
        );
    } else if (status === 'error') {
        body = (
            <View accessibilityRole="alert">
                <Text>{list.errorTitle}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={list.retry} onPress={onRetry}>
                    <Text>{list.retry}</Text>
                </Pressable>
            </View>
        );
    } else if (recipes.length === 0) {
        // Empty ≠ no-match: an active search that filtered every row out is NOT "no recipes yet" (the caller
        // has recipes) — it's a no-match. Distinguishing them keeps the empty-state copy honest.
        const searching = searchValue.trim().length > 0;
        const emptyTitle = onCommunity ? list.emptyCommunityTitle : list.emptyTitle;
        const emptyBody = onCommunity ? list.emptyCommunityBody : list.emptyBody;
        body = (
            <View style={styles.emptyBody}>
                <Text>{searching ? list.noMatchTitle : emptyTitle}</Text>
                <Text>{searching ? list.noMatchBody : emptyBody}</Text>
                {!searching && !onCommunity && (
                    // Empty-state CTA — the SOLE create control here; the FAB is suppressed on empty/community.
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={list.emptyCreateCta}
                        onPress={onCreateRecipe}
                        style={styles.createButton}
                    >
                        <Text style={styles.createLabel}>{list.emptyCreateCta}</Text>
                    </Pressable>
                )}
            </View>
        );
    } else {
        const count = formatRecipeCount(recipes.length, { one: list.countOne, other: list.countOther }, locale);
        // FlashList (U4), not ScrollView + .map: the full-bleed 4:3 cover cards mean only ~1 card fits the
        // viewport, so the list must both scroll AND recycle cells as it grows. v2 auto-measures — no
        // `estimatedItemSize`. The count is the list header; a spacer separator keeps the inter-card rhythm
        // (FlashList lays out cells itself, so gap goes through a separator, not `contentContainerStyle`).
        // The header + search stay pinned above. Pull-to-refresh (L8) binds to the query refetch; absent on
        // web (no gesture).
        body = (
            <FlashList
                data={recipes}
                keyExtractor={(recipe) => recipe.id}
                renderItem={({ item }) => <RecipeListCard recipe={item} onSelect={onSelectRecipe} />}
                ListHeaderComponent={<Text style={styles.count}>{count}</Text>}
                ItemSeparatorComponent={CardSeparator}
                style={styles.cardsScroll}
                contentContainerStyle={styles.cards}
                keyboardShouldPersistTaps="handled"
                refreshControl={
                    refresh !== undefined ? (
                        <RefreshControl refreshing={refresh.refreshing} onRefresh={refresh.onRefresh} />
                    ) : undefined
                }
            />
        );
    }

    // FAB is the persistent create control (L1), pinned OUTSIDE the header, present across loading / error /
    // populated; suppressed in the true empty state (the empty CTA is the create control) AND on Community (L5).
    const isEmpty = status === 'ready' && recipes.length === 0 && searchValue.trim().length === 0;
    const showFab = !isEmpty && !onCommunity;

    return (
        <View accessibilityLabel={list.heading} style={styles.container}>
            <View style={styles.headerRow}>
                <Text accessibilityRole="header" style={styles.heading}>
                    {list.heading}
                </Text>
            </View>

            {tab !== undefined && (
                <View accessibilityRole="tablist" accessibilityLabel={list.tabsLabel} style={styles.tabs}>
                    {(['mine', 'community'] as const).map((value) => {
                        const selected = tab.active === value;

                        return (
                            <Pressable
                                key={value}
                                accessibilityRole="tab"
                                accessibilityState={{ selected }}
                                onPress={() => tab.onChange(value)}
                                style={[styles.tab, selected && styles.tabSelected]}
                            >
                                <Text style={[styles.tabLabel, selected && styles.tabLabelSelected]}>
                                    {value === 'mine' ? list.tabMine : list.tabCommunity}
                                </Text>
                            </Pressable>
                        );
                    })}
                </View>
            )}

            <TextInput
                accessibilityLabel={list.searchLabel}
                placeholder={list.searchPlaceholder}
                placeholderTextColor={palette.mist}
                value={searchValue}
                onChangeText={onSearchChange}
                style={styles.search}
            />

            {filters !== undefined && filters.available.length > 0 && (
                <View accessibilityLabel={list.filtersLabel} style={styles.chips}>
                    {/* Leading "All" chip (mockup L4) resets every quick-filter; active when nothing is selected. */}
                    <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ selected: filters.active.length === 0 }}
                        onPress={filters.onClear}
                        style={[styles.chip, filters.active.length === 0 && styles.chipActive]}
                    >
                        <Text style={filters.active.length === 0 ? styles.chipLabelActive : styles.chipLabel}>
                            {list.filterAll}
                        </Text>
                    </Pressable>
                    {filters.available.map((value) => {
                        const active = filters.active.includes(value);

                        return (
                            <Pressable
                                key={value}
                                accessibilityRole="button"
                                accessibilityState={{ selected: active }}
                                onPress={() => filters.onToggle(value)}
                                style={[styles.chip, active && styles.chipActive]}
                            >
                                <Text style={active ? styles.chipLabelActive : styles.chipLabel}>
                                    {filterChipLabel(value, list.filterQuick)}
                                </Text>
                            </Pressable>
                        );
                    })}
                </View>
            )}

            {body}

            {showFab && (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={list.createCta}
                    onPress={onCreateRecipe}
                    style={styles.fab}
                >
                    <Text style={styles.fabLabel}>+</Text>
                </Pressable>
            )}
        </View>
    );
};

/** The inter-card spacer for the virtualized list (FlashList lays cells out itself, so gap is a separator). */
const CardSeparator: FC = () => <View style={styles.cardSeparator} />;

const styles = StyleSheet.create({
    container: { flex: 1, gap: nativeTokens.spacing[4], paddingHorizontal: nativeTokens.spacing[4], paddingTop: nativeTokens.spacing[2] },
    headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    heading: { fontSize: nativeTokens.fontSize.displayMd, fontWeight: '700', color: palette.charcoal },
    createButton: {
        backgroundColor: palette.seafoam,
        borderRadius: nativeTokens.radius.full,
        paddingVertical: 10,
        paddingHorizontal: 18,
        minHeight: 44,
        justifyContent: 'center',
    },
    createLabel: { color: palette.white, fontWeight: '600', fontSize: nativeTokens.fontSize.bodySm },
    emptyBody: { gap: nativeTokens.spacing[3], alignItems: 'flex-start' },
    // The mine/community source tabs are a 44pt touch target (RC-3); the underline sits at the row's foot.
    tabs: { flexDirection: 'row', gap: nativeTokens.spacing[2], borderBottomWidth: 1, borderBottomColor: nativeTokens.borderSubtle },
    tab: { paddingHorizontal: nativeTokens.spacing[4], minHeight: 44, justifyContent: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
    tabSelected: { borderBottomColor: palette.seafoam },
    tabLabel: { fontSize: nativeTokens.fontSize.bodySm, fontWeight: '600', color: palette.slate },
    tabLabelSelected: { color: palette.seafoam },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: nativeTokens.spacing[2] },
    chip: { borderRadius: nativeTokens.radius.full, paddingHorizontal: nativeTokens.spacing[3], paddingVertical: 6, backgroundColor: palette.pearl },
    chipActive: { backgroundColor: palette.seafoam },
    chipLabel: { fontSize: nativeTokens.fontSize.bodySm, fontWeight: '500', color: palette.slate },
    chipLabelActive: { fontSize: nativeTokens.fontSize.bodySm, fontWeight: '500', color: palette.white },
    fab: {
        position: 'absolute',
        right: nativeTokens.spacing[4],
        bottom: nativeTokens.spacing[5],
        width: 56,
        height: 56,
        borderRadius: nativeTokens.radius.full,
        backgroundColor: palette.seafoam,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: palette.charcoal,
        shadowOpacity: 0.2,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
        elevation: 4,
    },
    fabLabel: { color: palette.white, fontSize: nativeTokens.fontSize.displayMd, fontWeight: '700', lineHeight: 32 },
    search: {
        backgroundColor: palette.white,
        borderRadius: nativeTokens.radius.full,
        borderWidth: 1,
        borderColor: nativeTokens.borderSubtle,
        paddingVertical: nativeTokens.spacing[3],
        paddingHorizontal: nativeTokens.spacing[4],
        fontSize: nativeTokens.fontSize.bodyMd,
        color: palette.charcoal,
    },
    count: { fontSize: 13, fontWeight: '500', color: palette.slate, marginBottom: CARD_GAP },
    cardsScroll: { flex: 1 },
    cards: { paddingBottom: nativeTokens.spacing[5] },
    cardSeparator: { height: CARD_GAP },
    // Inert loading placeholder shaped like a recipe card (cover + body height); borderSubtle fill, no motion.
    skeletonCard: { height: 300, borderRadius: nativeTokens.radius.lg, backgroundColor: nativeTokens.borderSubtle, marginBottom: CARD_GAP },
});
