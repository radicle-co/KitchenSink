/**
 * @module @commise/features-recipes — native recipe filter bar (FR-006 / W4 S2).
 *
 * The React Native leaf of `RecipeFilterBar` — the same P9
 * descriptor-driven contract (facets are DATA, read into one view by `filterBarViewOf` in `./filterBarView.ts`, which
 * the web leaf shares), rendered with RN primitives. Dietary + Tags are multi-select chips, Cuisine is single-select (the search API filters by ONE
 * cuisine), Prep-time + Cook-time (REQ-030f) + Total-time are bucket ladders, and Ingredients (FR-006 gap #3)
 * is a typeahead `TextInput` + result list + removable chips — the container owns its live query/view state
 * (`useIngredientFilterSearch`) and passes it down as `ingredientSearch`, so this leaf stays presentational
 * like every other facet. Each chip is a `Pressable` exposing its selected state as both the native
 * `selected` trait and `aria-pressed` (what react-native-web surfaces to the DOM for the tests), so on-device
 * readers and the harness agree.
 *
 * The option or chip the cook pressed unmounts on every ingredient add and removal, so once the press lands
 * (`useIngredientPressLanding`) the screen-reader cursor moves to whatever then holds the search slot: the note when
 * the add filled the filter, else the search box (curated U9, spec §S8.1a "Focus at the cap"). It moves the reading
 * cursor only, so no keyboard rises, and a change nobody pressed moves nothing.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { Button } from '@commise/ui/button';
import { nativeTokens } from '@commise/ui/native';
import { useScreenReaderFocusOnSignal } from '@commise/ui/screen-reader-focus';
import { Sheet } from '@commise/ui/sheet';
import { TextInput } from '@commise/ui/text-input';
import { Feather } from '@expo/vector-icons';
import { useState, type FC, type ReactElement } from 'react';
import { Pressable, StyleSheet, Text, View, type TextInput as NativeTextInput } from 'react-native';

import { useIngredientPressLanding } from '../hooks/useIngredientPressLanding.js';
import { fillTemplate } from '../list/model.js';
import { recipeMessages } from '../messages.js';
import { filterBarViewOf, type FacetChipView, type FacetGroupView, type TimeBucketView } from './filterBarView.js';
import { filterMessages } from './messages.js';
import type { FilterAction, RecipeFilterBarProps } from './model.js';

export const RecipeFilterBar: FC<RecipeFilterBarProps> = ({ facets, filters, ingredientSearch, onFilterAction }) => {
    const m = useMessages(filterMessages);
    // The FR-010a minimum copy is shared by all four ingredient-search surfaces — see its message doc.
    const { ingredientSearch: minimumCopy } = useMessages(recipeMessages);
    const locale = useLocale();
    const bar = filterBarViewOf({ facets, filters, viewState: ingredientSearch.viewState }, m, locale);
    // One signal, two refs: only one of the note and the search box is mounted, and it takes the cursor once the press
    // lands.
    const landing = useIngredientPressLanding(filters.ingredients?.length ?? 0);
    const fullNoteRef = useScreenReaderFocusOnSignal<Text>(landing.signal);
    const searchInputRef = useScreenReaderFocusOnSignal<NativeTextInput>(landing.signal);

    const pressIngredient = (action: FilterAction): void => {
        landing.markPressed();
        onFilterAction(action);
    };

    const chipButton = ({ chip, name, action }: FacetChipView): ReactElement => (
        <Pressable
            key={chip.value}
            accessibilityRole="button"
            accessibilityLabel={name}
            // Both state forms are load-bearing, neither is redundant (#114). `accessibilityState.selected` is
            // the DEVICE trait (React Native has no `pressed` state), and `aria-pressed` is the only one that
            // reaches the DOM — react-native-web forwards literal `aria-*` props and projects
            // `accessibilityState` for nothing, so the object form alone is silent on the web build. RN maps
            // `aria-selected`/`checked`/`busy`/`expanded`/`disabled` back into `accessibilityState` but NOT
            // `aria-pressed`, so dropping the object form would silence the device instead. `aria-pressed`
            // rather than `aria-selected` because this is a `role="button"` toggle, matching the web leaf.
            accessibilityState={{ selected: chip.selected }}
            aria-pressed={chip.selected}
            onPress={() => onFilterAction(action)}
            style={[styles.chip, chip.selected ? styles.chipSelected : styles.chipUnselected]}
        >
            <Text style={chip.selected ? styles.chipTextSelected : styles.chipText}>
                {chip.count === undefined ? chip.value : `${chip.value} ${chip.count}`}
            </Text>
        </Pressable>
    );

    const timeButton = ({ minutes, label, active, action }: TimeBucketView): ReactElement => (
        <Pressable
            key={minutes}
            accessibilityRole="button"
            accessibilityLabel={label}
            // Device trait + the DOM-observable toggle state — see `chipButton` above.
            accessibilityState={{ selected: active }}
            aria-pressed={active}
            onPress={() => onFilterAction(action)}
            style={[styles.chip, active ? styles.chipSelected : styles.chipUnselected]}
        >
            <Text style={active ? styles.chipTextSelected : styles.chipText}>{label}</Text>
        </Pressable>
    );

    const group = (label: string, children: readonly ReactElement[]): ReactElement => (
        <View style={styles.group}>
            <Text accessibilityRole="header" style={styles.groupLabel}>
                {label}
            </Text>
            <View style={styles.chipRow}>{children}</View>
        </View>
    );

    // Each facet group is drawn by its kind: an exhaustive switch over the view's union.
    const drawGroup = (facet: FacetGroupView): ReactElement => {
        switch (facet.kind) {
            case 'chips':
                return group(facet.label, facet.chips.map(chipButton));
            case 'timeBuckets':
                return group(facet.label, facet.buckets.map(timeButton));
            case 'ingredients':
                return group(facet.label, [
                    <View key="typeahead" style={styles.ingredientTypeahead}>
                        {/* Full: the search would fail past the server's bound (curated U9), so the note replaces it and
                        says how to free a place. The chips below stay. */}
                        {facet.search.kind === 'full' ? (
                            <Text ref={fullNoteRef} style={styles.helperText}>
                                {fillTemplate(m.ingredientFilterFull, { max: facet.search.max })}
                            </Text>
                        ) : (
                            <>
                                <TextInput
                                    ref={searchInputRef}
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
                                {facet.search.kind === 'tooShort' && (
                                    <Text style={styles.helperText}>
                                        {fillTemplate(minimumCopy.tooShort, { minimum: facet.search.minimum })}
                                    </Text>
                                )}

                                {facet.search.kind === 'searching' && (
                                    <View collapsable={false} role="status">
                                        <Text style={styles.helperText}>{m.ingredientSearching}</Text>
                                    </View>
                                )}

                                {facet.search.kind === 'results' && facet.search.isError && (
                                    <View collapsable={false} role="alert">
                                        <Text>{m.ingredientSearchError}</Text>
                                    </View>
                                )}

                                {facet.search.kind === 'results' &&
                                    !facet.search.isError &&
                                    facet.results.length === 0 && (
                                        <Text style={styles.helperText}>{m.ingredientNoMatches}</Text>
                                    )}

                                {facet.results.length > 0 && (
                                    <View collapsable={false} role="list">
                                        {/* Named by its ACTION ("Filter by Flour"), not the bare ingredient name: the
                                    sibling search box already carries that exact string as its value, so a bare
                                    name is not uniquely addressable — see the `addIngredientFilter` message's doc
                                    for the failure that closes. The row also carries the 44pt tap-target floor
                                    every other control here has (its web peer's `py-2`); unstyled, its hit area
                                    was the intrinsic height of one line of text. */}
                                        {facet.results.map(({ ingredient, action }) => (
                                            <Pressable
                                                key={ingredient.id}
                                                accessibilityRole="button"
                                                accessibilityLabel={fillTemplate(m.addIngredientFilter, {
                                                    name: ingredient.name,
                                                })}
                                                onPress={() => pressIngredient(action)}
                                                style={styles.ingredientOption}
                                            >
                                                <Text style={styles.ingredientOptionText}>{ingredient.name}</Text>
                                            </Pressable>
                                        ))}
                                    </View>
                                )}
                            </>
                        )}

                        {facet.selected.length > 0 && (
                            <View style={styles.chipRow}>
                                {facet.selected.map(({ entry, action }) => (
                                    <Pressable
                                        key={entry.foodId}
                                        accessibilityRole="button"
                                        accessibilityLabel={fillTemplate(m.removeIngredientFilter, {
                                            name: entry.name,
                                        })}
                                        onPress={() => pressIngredient(action)}
                                        style={[styles.chip, styles.chipSelected, styles.ingredientChip]}
                                    >
                                        <Text style={styles.chipTextSelected}>{entry.name}</Text>
                                        <Text aria-hidden style={styles.chipTextSelected}>
                                            ×
                                        </Text>
                                    </Pressable>
                                ))}
                            </View>
                        )}
                    </View>,
                ]);
        }
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

    return (
        <View style={styles.bar}>
            <Pressable
                ref={triggerRef}
                accessibilityRole="button"
                accessibilityLabel={bar.triggerLabel}
                onPress={() => onOpenChange(true)}
                style={styles.trigger}
            >
                <Text style={styles.triggerText}>{m.filtersButton}</Text>
                {bar.activeCount > 0 && (
                    <View style={styles.badge}>
                        <Text style={styles.badgeText}>{bar.activeCount}</Text>
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
                    <Button
                        icon={<Feather name="check" size={16} color={palette.white} />}
                        width="fill"
                        onPress={() => onOpenChange(false)}
                    >
                        {m.filtersDone}
                    </Button>
                }
            >
                <View style={styles.container}>
                    {bar.slots.map((slot) => (
                        <View key={slot.id}>{slot.group === undefined ? null : drawGroup(slot.group)}</View>
                    ))}

                    {bar.clearAllLabel !== undefined && (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={bar.clearAllLabel}
                            onPress={() => onFilterAction({ kind: 'clearAll' })}
                            style={styles.clear}
                        >
                            <Text style={styles.clearText}>{bar.clearAllLabel}</Text>
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
    container: { gap: 12 },
    group: { gap: 6 },
    groupLabel: {
        fontSize: 11,
        fontWeight: '600',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        color: palette.slate,
    },
    // A sentence about the search, not a heading: body size and sentence case (spec §S8.1a), 5.24:1 on white.
    helperText: { fontSize: nativeTokens.fontSize.bodySm, color: palette.slate },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { borderRadius: 999, borderWidth: 1, paddingVertical: 6, paddingHorizontal: 14 },
    chipSelected: { backgroundColor: palette.seafoam, borderColor: palette.seafoam },
    chipUnselected: { backgroundColor: palette.white, borderColor: 'rgba(178, 190, 195, 0.3)' },
    chipText: { fontSize: 14, fontWeight: '500', color: palette.charcoal },
    chipTextSelected: { fontSize: 14, fontWeight: '500', color: palette.white },
    // An ingredient chip removes itself, and at the cap it is the only way forward (spec §S8.1a): a trailing × and
    // the 48 dp touch floor.
    ingredientChip: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 6 },
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
