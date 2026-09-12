/**
 * @module @commise/features-recipes — native recipe filter bar (FR-006 / W4 S2).
 *
 * The React Native leaf of `RecipeFilterBar` — the same P9
 * descriptor-driven contract (facets are DATA dispatched through a `kind → renderer` map), rendered with RN
 * primitives. Dietary + Tags are multi-select chips, Cuisine is single-select (the search API filters by ONE
 * cuisine), Prep-time + Cook-time (REQ-030f) + Total-time are bucket ladders, and Ingredients (FR-006 gap #3)
 * is a typeahead `TextInput` + result list + removable chips — the container owns its live query/view state
 * (`useIngredientFilterSearch`) and passes it down as `ingredientSearch`, so this leaf stays presentational
 * like every other facet. Each chip is a `Pressable` exposing its selected state as both the native
 * `selected` trait and `aria-pressed` (what react-native-web surfaces to the DOM for the tests), so on-device
 * readers and the harness agree.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { nativeTokens } from '@commise/ui/native';
import { useScreenReaderFocusOnSignal } from '@commise/ui/screen-reader-focus';
import { Sheet } from '@commise/ui/sheet';
import { useState, type FC, type ReactElement } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { fillTemplate, formatRecipeCount } from '../list/model.js';
import { recipeMessages } from '../messages.js';
import { filterMessages, type FilterMessages } from './messages.js';
import {
    TIME_BUCKETS_MINUTES,
    buildFacetChips,
    countActiveFilters,
    formatFacetChipName,
    hasActiveFilters,
    type FacetDimension,
    type FoodIngredient,
    type RecipeFacetChip,
    type RecipeFilterBarProps,
} from './model.js';

/** The kinds of facet the render map knows how to draw. */
type FacetKind = 'multiChip' | 'singleChip' | 'timeBucket' | 'ingredientTypeahead';

/** One facet, expressed as DATA (P9). The render map dispatches on {@link kind}. */
interface FacetDescriptor {
    readonly id: string;
    readonly kind: FacetKind;
    readonly labelKey: keyof FilterMessages;
    readonly dimension?: FacetDimension;
    readonly timeField?: 'maxPrepTime' | 'maxCookTime' | 'maxTotalTime';
}

const FACET_DESCRIPTORS: readonly FacetDescriptor[] = [
    { id: 'dietaryFlags', kind: 'multiChip', dimension: 'dietaryFlags', labelKey: 'dietaryLabel' },
    { id: 'cuisine', kind: 'singleChip', labelKey: 'cuisineLabel' },
    { id: 'tags', kind: 'multiChip', dimension: 'tags', labelKey: 'tagsLabel' },
    { id: 'maxPrepTime', kind: 'timeBucket', timeField: 'maxPrepTime', labelKey: 'maxPrepTimeLabel' },
    { id: 'maxCookTime', kind: 'timeBucket', timeField: 'maxCookTime', labelKey: 'maxCookTimeLabel' },
    { id: 'maxTotalTime', kind: 'timeBucket', timeField: 'maxTotalTime', labelKey: 'maxTotalTimeLabel' },
    { id: 'ingredients', kind: 'ingredientTypeahead', labelKey: 'ingredientsLabel' },
];

export const RecipeFilterBar: FC<RecipeFilterBarProps> = ({ facets, filters, ingredientSearch, onFilterAction }) => {
    const m = useMessages(filterMessages);
    // The FR-010a minimum copy is shared by all four ingredient-search surfaces — see its message doc.
    const { ingredientSearch: minimumCopy } = useMessages(recipeMessages);
    const locale = useLocale();
    const countLabels = { one: m.chipCountOne, other: m.chipCountOther };

    const chipButton = (chip: RecipeFacetChip, onSelect: () => void): ReactElement => (
        <Pressable
            key={chip.value}
            accessibilityRole="button"
            accessibilityLabel={formatFacetChipName(chip, countLabels, locale)}
            // Both state forms are load-bearing, neither is redundant (#114). `accessibilityState.selected` is
            // the DEVICE trait (React Native has no `pressed` state), and `aria-pressed` is the only one that
            // reaches the DOM — react-native-web forwards literal `aria-*` props and projects
            // `accessibilityState` for nothing, so the object form alone is silent on the web build. RN maps
            // `aria-selected`/`checked`/`busy`/`expanded`/`disabled` back into `accessibilityState` but NOT
            // `aria-pressed`, so dropping the object form would silence the device instead. `aria-pressed`
            // rather than `aria-selected` because this is a `role="button"` toggle, matching the web leaf.
            accessibilityState={{ selected: chip.selected }}
            aria-pressed={chip.selected}
            onPress={onSelect}
            style={[styles.chip, chip.selected ? styles.chipSelected : styles.chipUnselected]}
        >
            <Text style={chip.selected ? styles.chipTextSelected : styles.chipText}>
                {chip.count === undefined ? chip.value : `${chip.value} ${chip.count}`}
            </Text>
        </Pressable>
    );

    const timeButton = (minutes: number, active: boolean, onPress: () => void): ReactElement => (
        <Pressable
            key={minutes}
            accessibilityRole="button"
            accessibilityLabel={fillTemplate(m.timeBucket, { minutes })}
            // Device trait + the DOM-observable toggle state — see `chipButton` above.
            accessibilityState={{ selected: active }}
            aria-pressed={active}
            onPress={onPress}
            style={[styles.chip, active ? styles.chipSelected : styles.chipUnselected]}
        >
            <Text style={active ? styles.chipTextSelected : styles.chipText}>
                {fillTemplate(m.timeBucket, { minutes })}
            </Text>
        </Pressable>
    );

    const group = (label: string, children: readonly ReactElement[]): ReactElement => (
        <View role="group" aria-label={label} style={styles.group}>
            <Text style={styles.groupLabel}>{label}</Text>
            <View style={styles.chipRow}>{children}</View>
        </View>
    );

    const renderers: Record<FacetKind, (descriptor: FacetDescriptor) => ReactElement | null> = {
        multiChip: ({ dimension, labelKey }) => {
            const chips = buildFacetChips(facets[dimension as 'dietaryFlags' | 'tags'], filters[dimension!] ?? []);

            if (chips.length === 0) {
                return null;
            }

            return group(
                m[labelKey],
                chips.map((chip) =>
                    chipButton(chip, () =>
                        onFilterAction({ kind: 'toggleFacet', dimension: dimension!, value: chip.value }),
                    ),
                ),
            );
        },
        singleChip: ({ labelKey }) => {
            const chips = buildFacetChips(facets.cuisine, filters.cuisine !== undefined ? [filters.cuisine] : []);

            if (chips.length === 0) {
                return null;
            }

            return group(
                m[labelKey],
                chips.map((chip) =>
                    chipButton(chip, () => onFilterAction({ kind: 'setCuisine', cuisine: chip.value })),
                ),
            );
        },
        timeBucket: ({ timeField, labelKey }) => {
            const set = (minutes: number | undefined): void =>
                onFilterAction({ kind: 'setTimeBound', field: timeField!, minutes });

            return group(
                m[labelKey],
                TIME_BUCKETS_MINUTES.map((minutes) => {
                    const active = filters[timeField!] === minutes;

                    return timeButton(minutes, active, () => set(active ? undefined : minutes));
                }),
            );
        },
        ingredientTypeahead: ({ labelKey }) => {
            const selected = filters.ingredients ?? [];
            const selectedIds = new Set(selected.map((entry) => entry.foodId));
            const { viewState } = ingredientSearch;
            const visibleResults: readonly FoodIngredient[] =
                viewState.kind === 'results'
                    ? viewState.results.filter((ingredient) => !selectedIds.has(ingredient.foodId))
                    : [];

            return group(m[labelKey], [
                <View key="typeahead" style={styles.ingredientTypeahead}>
                    <TextInput
                        accessibilityLabel={m.ingredientSearchLabel}
                        placeholder={m.ingredientSearchPlaceholder}
                        value={ingredientSearch.query}
                        onChangeText={ingredientSearch.onQueryChange}
                        style={styles.ingredientInput}
                    />

                    {/* The label is the region's CONTENT, not only its `aria-label`: an empty live region has
                        nothing to render and nothing to announce (a live region announces content CHANGES).
                        Same doctrine as the web leaf and the mobile `LoadingState`. */}
                    {/* 003-FR-010a — see the web leaf for why this is not the no-matches copy and not
                        a live region. */}
                    {viewState.kind === 'tooShort' && (
                        <Text style={styles.groupLabel}>
                            {fillTemplate(minimumCopy.tooShort, { minimum: viewState.minimum })}
                        </Text>
                    )}

                    {viewState.kind === 'searching' && (
                        <View role="status" aria-label={m.ingredientSearching}>
                            <Text style={styles.groupLabel}>{m.ingredientSearching}</Text>
                        </View>
                    )}

                    {viewState.kind === 'results' && viewState.isError && (
                        <View role="alert">
                            <Text>{m.ingredientSearchError}</Text>
                        </View>
                    )}

                    {viewState.kind === 'results' && !viewState.isError && visibleResults.length === 0 && (
                        <Text style={styles.groupLabel}>{m.ingredientNoMatches}</Text>
                    )}

                    {visibleResults.length > 0 && (
                        <View role="list">
                            {/* Named by its ACTION ("Filter by Flour"), not the bare ingredient name: the
                                sibling search box already carries that exact string as its value, so a bare
                                name is not uniquely addressable — see the `addIngredientFilter` message's doc
                                for the failure that closes. The row also carries the 44pt tap-target floor
                                every other control here has (its web peer's `py-2`); unstyled, its hit area
                                was the intrinsic height of one line of text. */}
                            {visibleResults.map((ingredient) => (
                                <Pressable
                                    key={ingredient.id}
                                    accessibilityRole="button"
                                    accessibilityLabel={fillTemplate(m.addIngredientFilter, {
                                        name: ingredient.name,
                                    })}
                                    onPress={() =>
                                        onFilterAction({
                                            kind: 'addIngredient',
                                            ingredient: { foodId: ingredient.foodId, name: ingredient.name },
                                        })
                                    }
                                    style={styles.ingredientOption}
                                >
                                    <Text style={styles.ingredientOptionText}>{ingredient.name}</Text>
                                </Pressable>
                            ))}
                        </View>
                    )}

                    {selected.length > 0 && (
                        <View style={styles.chipRow}>
                            {selected.map((entry) => (
                                <Pressable
                                    key={entry.foodId}
                                    accessibilityRole="button"
                                    accessibilityLabel={fillTemplate(m.removeIngredientFilter, { name: entry.name })}
                                    onPress={() => onFilterAction({ kind: 'removeIngredient', foodId: entry.foodId })}
                                    style={[styles.chip, styles.chipSelected]}
                                >
                                    <Text style={styles.chipTextSelected}>{entry.name}</Text>
                                </Pressable>
                            ))}
                        </View>
                    )}
                </View>,
            ]);
        },
    };

    // Collapse the ~7 always-open facet groups into a single "Filters" button + a bottom sheet (U7): the
    // groups above the results were eating the phone viewport before a single card was visible. The button
    // carries an active-count badge; the sheet holds every facet + Clear-all. The sheet is the design system's
    // (`@commise/ui/sheet`, §S8.1a), which owns the insets, the keyboard and every close route.
    const [open, setOpen] = useState(false);
    // Advances on EVERY close, whatever the route (Done, Close, the scrim, a swipe, back), so the trigger takes
    // the screen-reader cursor back each time: React Native cannot tell the Sheet where that cursor was.
    const [closes, setCloses] = useState(0);
    const triggerRef = useScreenReaderFocusOnSignal<View>(closes);

    const onOpenChange = (next: boolean): void => {
        setOpen(next);

        if (!next) {
            setCloses((count) => count + 1);
        }
    };

    const activeCount = countActiveFilters(filters);
    const triggerLabel =
        activeCount > 0 ? fillTemplate(m.filtersButtonActive, { count: activeCount }) : m.filtersButton;

    return (
        <View style={styles.bar}>
            <Pressable
                ref={triggerRef}
                accessibilityRole="button"
                accessibilityLabel={triggerLabel}
                onPress={() => onOpenChange(true)}
                style={styles.trigger}
            >
                <Text style={styles.triggerText}>{m.filtersButton}</Text>
                {activeCount > 0 && (
                    <View style={styles.badge}>
                        <Text style={styles.badgeText}>{activeCount}</Text>
                    </View>
                )}
            </Pressable>

            <Sheet
                open={open}
                onOpenChange={onOpenChange}
                title={m.barLabel}
                closeLabel={m.filtersClose}
                size="content"
                footer={
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={m.filtersDone}
                        onPress={() => onOpenChange(false)}
                        style={styles.done}
                    >
                        <Text style={styles.doneText}>{m.filtersDone}</Text>
                    </Pressable>
                }
            >
                <View style={styles.container}>
                    {FACET_DESCRIPTORS.map((descriptor) => (
                        <View key={descriptor.id}>{renderers[descriptor.kind](descriptor)}</View>
                    ))}

                    {hasActiveFilters(filters) && (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={formatRecipeCount(
                                activeCount,
                                { one: m.clearOne, other: m.clearOther },
                                locale,
                            )}
                            onPress={() => onFilterAction({ kind: 'clearAll' })}
                            style={styles.clear}
                        >
                            <Text style={styles.clearText}>
                                {formatRecipeCount(activeCount, { one: m.clearOne, other: m.clearOther }, locale)}
                            </Text>
                        </Pressable>
                    )}
                </View>
            </Sheet>
        </View>
    );
};

const styles = StyleSheet.create({
    bar: { alignSelf: 'flex-start' },
    trigger: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: nativeTokens.spacing[2],
        minHeight: 44,
        borderRadius: nativeTokens.radius.full,
        borderWidth: 1,
        borderColor: nativeTokens.borderSubtle,
        backgroundColor: palette.white,
        paddingHorizontal: nativeTokens.spacing[4],
    },
    triggerText: { fontSize: nativeTokens.fontSize.bodySm, fontWeight: '600', color: palette.charcoal },
    // A 22 dp FLOOR, not a fixed height (E2 I10): at a large font scale the digit outgrew a fixed circle and sat
    // white on white outside it. The padding gives a scaled digit room, so the badge grows with the text.
    badge: {
        minWidth: 22,
        minHeight: 22,
        paddingVertical: 2,
        borderRadius: nativeTokens.radius.full,
        backgroundColor: palette.seafoam,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: nativeTokens.spacing[1],
    },
    badgeText: { fontSize: nativeTokens.fontSize.overline, fontWeight: '700', color: palette.white },
    done: {
        minHeight: 44,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: nativeTokens.radius.full,
        backgroundColor: palette.charcoal,
    },
    doneText: { fontSize: nativeTokens.fontSize.bodyMd, fontWeight: '600', color: palette.white },
    container: { gap: 12 },
    group: { gap: 6 },
    groupLabel: {
        fontSize: 11,
        fontWeight: '600',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        color: palette.slate,
    },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { borderRadius: 999, borderWidth: 1, paddingVertical: 6, paddingHorizontal: 14 },
    chipSelected: { backgroundColor: palette.seafoam, borderColor: palette.seafoam },
    chipUnselected: { backgroundColor: palette.white, borderColor: 'rgba(178, 190, 195, 0.3)' },
    chipText: { fontSize: 14, fontWeight: '500', color: palette.charcoal },
    chipTextSelected: { fontSize: 14, fontWeight: '500', color: palette.white },
    clear: { alignSelf: 'flex-start', borderRadius: 999, paddingVertical: 6, paddingHorizontal: 14 },
    clearText: { fontSize: 14, fontWeight: '600', color: palette['ocean-dark'] },
    ingredientTypeahead: { gap: 8, flexBasis: '100%' },
    // One typeahead result row: the 44pt touch floor (`Button.native`/`Input.native` carry the same), with
    // horizontal padding so the label is not flush against the sheet edge.
    ingredientOption: {
        minHeight: 44,
        justifyContent: 'center',
        borderRadius: nativeTokens.radius.md,
        paddingHorizontal: nativeTokens.spacing[3],
    },
    ingredientOptionText: { fontSize: nativeTokens.fontSize.bodyMd, color: palette.charcoal },
    ingredientInput: {
        borderRadius: 8,
        borderWidth: 1,
        borderColor: 'rgba(178, 190, 195, 0.3)',
        paddingVertical: 8,
        paddingHorizontal: 12,
        fontSize: 14,
        color: palette.charcoal,
    },
});
