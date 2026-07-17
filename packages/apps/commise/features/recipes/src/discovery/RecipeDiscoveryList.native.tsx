/**
 * @module @commise/features-recipes — native public-discovery view (T076 building block, US2).
 *
 * The React Native leaf of {@link import('./RecipeDiscoveryList.js').RecipeDiscoveryList} — same controlled,
 * presentational contract and the same four states (loading, error, empty, populated), rendered with RN
 * primitives. Every recipe shown is public; each row offers a Clone action.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import type { FC, ReactElement } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { formatRecipeCount } from '../list/model.js';
import { discoveryMessages } from './messages.js';
import { RecipeDiscoveryCard } from './RecipeDiscoveryCard.native.js';
import { toRecipeDiscoveryItem, type RecipeDiscoveryListProps } from './model.js';

export const RecipeDiscoveryList: FC<RecipeDiscoveryListProps> = ({
    status,
    results,
    searchValue,
    onSearchChange,
    onSelectRecipe,
    onClone,
    onRetry,
    cloningId,
    hasActiveFilters = false,
    filterSlot,
}) => {
    const discovery = useMessages(discoveryMessages);
    const locale = useLocale();

    let body: ReactElement;

    if (status === 'loading') {
        body = <View accessibilityLabel={discovery.loadingLabel} />;
    } else if (status === 'error') {
        body = (
            <View accessibilityRole="alert">
                <Text>{discovery.errorTitle}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={discovery.retry} onPress={onRetry}>
                    <Text>{discovery.retry}</Text>
                </Pressable>
            </View>
        );
    } else if (results.length === 0) {
        // Empty ≠ no-match: a search/filter with zero hits is a NO-MATCH, not the browse-empty "no public
        // recipes" state. `searchValue` or an active filter distinguishes them.
        const searching = searchValue.trim().length > 0 || hasActiveFilters;
        body = (
            <View>
                <Text>{searching ? discovery.noMatchTitle : discovery.emptyTitle}</Text>
                <Text>{searching ? discovery.noMatchBody : discovery.emptyBody}</Text>
            </View>
        );
    } else {
        const count = formatRecipeCount(
            results.length,
            { one: discovery.countOne, other: discovery.countOther },
            locale,
        );
        // ScrollView, not View: the full-bleed 4:3 cover cards mean only ~1 card fits, so without scrolling
        // every discovered recipe past the first is unreachable. Header + search + filters stay pinned above.
        body = (
            <ScrollView
                style={styles.cardsScroll}
                contentContainerStyle={styles.cards}
                keyboardShouldPersistTaps="handled"
            >
                <Text style={styles.count}>{count}</Text>
                {results.map((result) => {
                    const item = toRecipeDiscoveryItem(result);

                    return (
                        <RecipeDiscoveryCard
                            key={item.id}
                            recipe={item}
                            isCloning={cloningId === item.id}
                            onSelect={onSelectRecipe}
                            onClone={onClone}
                        />
                    );
                })}
            </ScrollView>
        );
    }

    return (
        <View accessibilityLabel={discovery.heading} style={styles.container}>
            <Text accessibilityRole="header" style={styles.heading}>
                {discovery.heading}
            </Text>
            <TextInput
                accessibilityLabel={discovery.searchLabel}
                placeholder={discovery.searchPlaceholder}
                placeholderTextColor={palette.mist}
                value={searchValue}
                onChangeText={onSearchChange}
                style={styles.search}
            />
            {filterSlot}
            {body}
        </View>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, gap: 16, paddingHorizontal: 16, paddingTop: 8 },
    heading: { fontSize: 28, fontWeight: '700', color: palette.charcoal },
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
