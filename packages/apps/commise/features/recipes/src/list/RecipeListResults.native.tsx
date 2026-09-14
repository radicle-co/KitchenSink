/**
 * @module @commise/features-recipes — native recipe-list RESULTS (presentational): what renders inside the list's
 * suspense boundary once the library has settled.
 *
 * The React Native leaf of `RecipeListResults`: the quick-filter chips, the refresh notice, then the empty, no-match
 * or populated body, and the create dial wherever {@link shouldShowCreateDial} keeps it. U4: the populated rows are
 * virtualized with FlashList v2 (cell recycling; v2 auto-measures, so NO `estimatedItemSize`) and pull-to-refresh is
 * wired through the recycler.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { nativeTokens } from '@commise/ui/native';
import { RefreshNotice } from '@commise/ui/refresh-notice';
import { FlashList } from '@shopify/flash-list';
import type { FC, ReactElement } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { recipeMessages } from '../messages.js';
import { RecipeCreateDial } from './RecipeCreateDial.native.js';
import { RecipeListCard } from './RecipeListCard.native.js';
import { filterChipLabel, formatRecipeCount, shouldShowCreateDial, type RecipeListResultsProps } from './model.js';

/** The inter-card gap, hoisted so the FlashList separator and the header spacer share one value. */
const CARD_GAP = nativeTokens.spacing[3];

export const RecipeListResults: FC<RecipeListResultsProps> = ({
    recipes,
    narrowed,
    onSelectRecipe,
    onCreateRecipe,
    onPasteIngredients,
    filters,
    refresh,
    refreshNotice,
    renderNutrition,
}) => {
    const { list } = useMessages(recipeMessages);
    const locale = useLocale();

    let body: ReactElement;

    if (recipes.length === 0) {
        body = (
            <View style={styles.emptyBody}>
                <Text>{narrowed ? list.noMatchTitle : list.emptyTitle}</Text>
                <Text>{narrowed ? list.noMatchBody : list.emptyBody}</Text>
                {!narrowed && (
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
        body = (
            <FlashList
                data={recipes}
                keyExtractor={(recipe) => recipe.id}
                renderItem={({ item }) => (
                    <RecipeListCard recipe={item} onSelect={onSelectRecipe} nutrition={renderNutrition?.(item.id)} />
                )}
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

    return (
        <>
            {filters !== undefined && filters.available.length > 0 && (
                <View accessibilityLabel={list.filtersLabel} style={styles.chips}>
                    {/* Leading "All" chip (mockup L4) resets every quick-filter; active when nothing is selected.
                        Both state forms are deliberate, and neither is redundant (#114): `accessibilityState`
                        is the DEVICE channel (React Native has no `pressed` state, so `selected` is the trait
                        VoiceOver/TalkBack read for a selected chip), while `aria-pressed` is the only one that
                        reaches the DOM — react-native-web forwards literal `aria-*` props and projects
                        `accessibilityState` for NOTHING, so the object form alone left the selected state
                        unannounced on the web build and unassertable everywhere. `aria-pressed` rather than
                        `aria-selected` because these are `role="button"` toggles, which is also exactly what
                        the web leaf and the sibling `RecipeFilterBar.native` chips render. Do not "simplify"
                        by dropping either: RN maps `aria-selected`/`checked`/`busy`/`expanded`/`disabled` into
                        `accessibilityState` but NOT `aria-pressed`, so the object form is load-bearing. */}
                    <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ selected: filters.active.length === 0 }}
                        aria-pressed={filters.active.length === 0}
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
                                aria-pressed={active}
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

            {refreshNotice !== undefined && (
                <RefreshNotice
                    failed={refreshNotice.failed}
                    refreshing={refreshNotice.refreshing}
                    onRetry={refreshNotice.onRetry}
                    labels={{ failed: list.refreshError, retry: list.retry }}
                />
            )}

            {body}

            {shouldShowCreateDial({ recipeCount: recipes.length, narrowed }) && (
                <RecipeCreateDial onCreateRecipe={onCreateRecipe} onPasteIngredients={onPasteIngredients} />
            )}
        </>
    );
};

/** The inter-card spacer for the virtualized list (FlashList lays cells out itself, so gap is a separator). */
const CardSeparator: FC = () => <View style={styles.cardSeparator} />;

const styles = StyleSheet.create({
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
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: nativeTokens.spacing[2] },
    chip: {
        borderRadius: nativeTokens.radius.full,
        paddingHorizontal: nativeTokens.spacing[3],
        paddingVertical: 6,
        backgroundColor: palette.pearl,
    },
    chipActive: { backgroundColor: palette.seafoam },
    chipLabel: { fontSize: nativeTokens.fontSize.bodySm, fontWeight: '500', color: palette.slate },
    chipLabelActive: { fontSize: nativeTokens.fontSize.bodySm, fontWeight: '500', color: palette.white },
    count: { fontSize: 13, fontWeight: '500', color: palette.slate, marginBottom: CARD_GAP },
    cardsScroll: { flex: 1 },
    cards: { paddingBottom: nativeTokens.spacing[5] },
    cardSeparator: { height: CARD_GAP },
});
