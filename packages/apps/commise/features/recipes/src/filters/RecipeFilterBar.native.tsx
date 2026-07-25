/**
 * @module @commise/features-recipes — native recipe filter bar (FR-006 / W4 S2).
 *
 * The React Native leaf of {@link import('./RecipeFilterBar.js').RecipeFilterBar} — the same P9
 * descriptor-driven contract (facets are DATA dispatched through a `kind → renderer` map), rendered with RN
 * primitives. Dietary + Tags are multi-select chips, Cuisine is single-select (the search API filters by ONE
 * cuisine), and Prep-time + Cook-time (REQ-030f) + Total-time are bucket ladders. Each chip is a
 * `Pressable` exposing its selected state as both the native `selected` trait and `aria-pressed` (what
 * react-native-web surfaces to the DOM for the tests), so on-device readers and the harness agree.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import type { FC, ReactElement } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { fillTemplate, formatRecipeCount } from '../list/model.js';
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
type FacetKind = 'multiChip' | 'singleChip' | 'timeBucket';

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
];

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
    onClearAll,
}) => {
    const m = useMessages(filterMessages);
    const locale = useLocale();
    const countLabels = { one: m.chipCountOne, other: m.chipCountOther };

    const chipButton = (chip: RecipeFacetChip, onSelect: () => void): ReactElement => (
        <Pressable
            key={chip.value}
            accessibilityRole="button"
            accessibilityLabel={formatFacetChipName(chip, countLabels, locale)}
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
    };

    return (
        <View role="group" aria-label={m.barLabel} style={styles.container}>
            {FACET_DESCRIPTORS.map((descriptor) => (
                <View key={descriptor.id}>{renderers[descriptor.kind](descriptor)}</View>
            ))}

            {hasActiveFilters(filters) && (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={formatRecipeCount(
                        countActiveFilters(filters),
                        { one: m.clearOne, other: m.clearOther },
                        locale,
                    )}
                    onPress={onClearAll}
                    style={styles.clear}
                >
                    <Text style={styles.clearText}>
                        {formatRecipeCount(
                            countActiveFilters(filters),
                            { one: m.clearOne, other: m.clearOther },
                            locale,
                        )}
                    </Text>
                </Pressable>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
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
    clearText: { fontSize: 14, fontWeight: '600', color: palette.seafoam },
});
