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
import type { Ingredient } from '@kitchensink/recipe-core';
import { useState, type FC, type ReactElement } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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

/**
 * The bottom sheet's base edge padding, in dp, BEFORE the device's window insets are added. Exported so a
 * test can assert the COMPOSED padding rather than restating the literal (which would still pass with the
 * inset term dropped — exactly the defect this constant's consumer exists to prevent).
 */
export const FILTER_SHEET_PADDING = nativeTokens.spacing[4];

/** The `timeField` → setter map the `timeBucket` renderer dispatches on. */
function timeSetterFor(
    timeField: 'maxPrepTime' | 'maxCookTime' | 'maxTotalTime',
    setters: {
        onSetMaxPrepTime: (minutes: number | undefined) => void;
        onSetMaxCookTime: (minutes: number | undefined) => void;
        onSetMaxTotalTime: (minutes: number | undefined) => void;
    },
): (minutes: number | undefined) => void {
    if (timeField === 'maxPrepTime') {
        return setters.onSetMaxPrepTime;
    }

    if (timeField === 'maxCookTime') {
        return setters.onSetMaxCookTime;
    }

    return setters.onSetMaxTotalTime;
}

export const RecipeFilterBar: FC<RecipeFilterBarProps> = ({
    facets,
    filters,
    onToggleFacet,
    onSetCuisine,
    onSetMaxPrepTime,
    onSetMaxCookTime,
    onSetMaxTotalTime,
    ingredientSearch,
    onAddIngredientFilter,
    onRemoveIngredientFilter,
    onClearAll,
}) => {
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
                chips.map((chip) => chipButton(chip, () => onToggleFacet(dimension!, chip.value))),
            );
        },
        singleChip: ({ labelKey }) => {
            const chips = buildFacetChips(facets.cuisine, filters.cuisine !== undefined ? [filters.cuisine] : []);

            if (chips.length === 0) {
                return null;
            }

            return group(
                m[labelKey],
                chips.map((chip) => chipButton(chip, () => onSetCuisine(chip.value))),
            );
        },
        timeBucket: ({ timeField, labelKey }) => {
            const set = timeSetterFor(timeField!, { onSetMaxPrepTime, onSetMaxCookTime, onSetMaxTotalTime });

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
            const selectedIds = new Set(selected.map((entry) => entry.id));
            const { viewState } = ingredientSearch;
            const visibleResults: readonly Ingredient[] =
                viewState.kind === 'results'
                    ? viewState.results.filter((ingredient) => !selectedIds.has(ingredient.id))
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
                                    onPress={() => onAddIngredientFilter({ id: ingredient.id, name: ingredient.name })}
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
                                    key={entry.id}
                                    accessibilityRole="button"
                                    accessibilityLabel={fillTemplate(m.removeIngredientFilter, { name: entry.name })}
                                    onPress={() => onRemoveIngredientFilter(entry.id)}
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
    // carries an active-count badge; the sheet holds every facet + Clear-all, unchanged.
    const [open, setOpen] = useState(false);
    // An Android `Modal` window spans the WHOLE display (the app is edge-to-edge, as `FullScreenSheet.native`
    // already compensates for), and this sheet is bottom-ANCHORED — so without the device's bottom inset its
    // footer "Done" lands inside the navigation bar's own tap region and every press on it is swallowed by
    // the system bar. Left/right cover a landscape cutout for the same reason.
    const insets = useSafeAreaInsets();
    const activeCount = countActiveFilters(filters);
    const triggerLabel =
        activeCount > 0 ? fillTemplate(m.filtersButtonActive, { count: activeCount }) : m.filtersButton;

    return (
        <View style={styles.bar}>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={triggerLabel}
                onPress={() => setOpen(true)}
                style={styles.trigger}
            >
                <Text style={styles.triggerText}>{m.filtersButton}</Text>
                {activeCount > 0 && (
                    <View style={styles.badge}>
                        <Text style={styles.badgeText}>{activeCount}</Text>
                    </View>
                )}
            </Pressable>

            <Modal visible={open} transparent onRequestClose={() => setOpen(false)}>
                <View style={styles.sheetBackdrop}>
                    <View
                        role="group"
                        aria-label={m.barLabel}
                        style={[
                            styles.sheet,
                            {
                                paddingBottom: FILTER_SHEET_PADDING + insets.bottom,
                                paddingLeft: FILTER_SHEET_PADDING + insets.left,
                                paddingRight: FILTER_SHEET_PADDING + insets.right,
                            },
                        ]}
                    >
                        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
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
                                    onPress={onClearAll}
                                    style={styles.clear}
                                >
                                    <Text style={styles.clearText}>
                                        {formatRecipeCount(
                                            activeCount,
                                            { one: m.clearOne, other: m.clearOther },
                                            locale,
                                        )}
                                    </Text>
                                </Pressable>
                            )}
                        </ScrollView>

                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={m.filtersDone}
                            onPress={() => setOpen(false)}
                            style={styles.done}
                        >
                            <Text style={styles.doneText}>{m.filtersDone}</Text>
                        </Pressable>
                    </View>
                </View>
            </Modal>
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
    badge: {
        minWidth: 22,
        height: 22,
        borderRadius: nativeTokens.radius.full,
        backgroundColor: palette.seafoam,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: nativeTokens.spacing[1],
    },
    badgeText: { fontSize: nativeTokens.fontSize.overline, fontWeight: '700', color: palette.white },
    sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(45, 52, 54, 0.4)' },
    sheet: {
        maxHeight: '85%',
        backgroundColor: palette.white,
        borderTopLeftRadius: nativeTokens.radius.xl,
        borderTopRightRadius: nativeTokens.radius.xl,
        paddingTop: FILTER_SHEET_PADDING,
        // Bottom/left/right are composed PER RENDER from the device insets (see the `insets` read above) —
        // deliberately absent here so a static rule can never win over the inset-aware value.
        gap: nativeTokens.spacing[3],
    },
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
