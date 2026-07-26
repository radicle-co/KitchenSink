/**
 * @module @commise/features-recipes — native recipe-list view (T065 building block).
 *
 * The React Native leaf of {@link import('./RecipeList.js').RecipeList} — same controlled, presentational
 * contract and the same four states (loading, error, empty, populated), rendered with RN primitives.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import type { FC, ReactElement } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { recipeMessages } from '../messages.js';
import { RecipeListCard } from './RecipeListCard.native.js';
import { filterChipLabel, formatRecipeCount, type RecipeListViewProps } from './model.js';

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
        body = <View accessibilityLabel={list.loadingLabel} />;
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
        // ScrollView, not View: the full-bleed 4:3 cover cards mean only ~1 card fits the viewport, so without
        // scrolling every recipe past the first is unreachable. The header + search stay pinned above it.
        body = (
            <ScrollView
                style={styles.cardsScroll}
                contentContainerStyle={styles.cards}
                keyboardShouldPersistTaps="handled"
                // Pull-to-refresh (L8): bound to the query refetch by the container; absent on web (no gesture).
                refreshControl={
                    refresh !== undefined ? (
                        <RefreshControl refreshing={refresh.refreshing} onRefresh={refresh.onRefresh} />
                    ) : undefined
                }
            >
                <Text style={styles.count}>{count}</Text>
                {recipes.map((recipe) => (
                    <RecipeListCard key={recipe.id} recipe={recipe} onSelect={onSelectRecipe} />
                ))}
            </ScrollView>
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

const styles = StyleSheet.create({
    container: { flex: 1, gap: 16, paddingHorizontal: 16, paddingTop: 8 },
    headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    heading: { fontSize: 28, fontWeight: '700', color: palette.charcoal },
    createButton: {
        backgroundColor: palette.seafoam,
        borderRadius: 999,
        paddingVertical: 10,
        paddingHorizontal: 18,
    },
    createLabel: { color: palette.white, fontWeight: '600', fontSize: 14 },
    emptyBody: { gap: 12, alignItems: 'flex-start' },
    tabs: { flexDirection: 'row', gap: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(178, 190, 195, 0.3)' },
    tab: { paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 2, borderBottomColor: 'transparent' },
    tabSelected: { borderBottomColor: palette.seafoam },
    tabLabel: { fontSize: 14, fontWeight: '600', color: palette.slate },
    tabLabelSelected: { color: palette.seafoam },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: palette.pearl },
    chipActive: { backgroundColor: palette.seafoam },
    chipLabel: { fontSize: 14, fontWeight: '500', color: palette.slate },
    chipLabelActive: { fontSize: 14, fontWeight: '500', color: palette.white },
    fab: {
        position: 'absolute',
        right: 16,
        bottom: 24,
        width: 56,
        height: 56,
        borderRadius: 999,
        backgroundColor: palette.seafoam,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: palette.charcoal,
        shadowOpacity: 0.2,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
        elevation: 4,
    },
    fabLabel: { color: palette.white, fontSize: 28, fontWeight: '700', lineHeight: 32 },
    search: {
        backgroundColor: palette.white,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: 'rgba(178, 190, 195, 0.3)',
        paddingVertical: 12,
        paddingHorizontal: 20,
        fontSize: 16,
        color: palette.charcoal,
    },
    count: { fontSize: 13, fontWeight: '500', color: palette.slate },
    cardsScroll: { flex: 1 },
    cards: { gap: 12, paddingBottom: 24 },
});
