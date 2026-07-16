/**
 * @module @commise/features-recipes — native recipe filter bar (FR-006 building block).
 *
 * The React Native leaf of {@link import('./RecipeFilterBar.js').RecipeFilterBar} — same controlled,
 * presentational, facet-driven contract, rendered with RN primitives. Each chip is a `Pressable` with
 * `accessibilityRole="button"`; its selected state is exposed both as the native `selected` trait
 * (`accessibilityState`) and as `aria-pressed` (the attribute react-native-web surfaces to the DOM, which the
 * native component tests assert on), so screen readers on-device and the test harness agree.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { fillTemplate, formatRecipeCount } from '../list/model.js';
import { filterMessages } from './messages.js';
import {
    buildFacetChips,
    countActiveFilters,
    formatFacetChipName,
    hasActiveFilters,
    TOTAL_TIME_BUCKETS_MINUTES,
    type FacetDimension,
    type RecipeFacetChip,
    type RecipeFilterBarProps,
} from './model.js';

const FACET_GROUPS: readonly { readonly dimension: FacetDimension; readonly labelKey: 'dietaryLabel' | 'tagsLabel' }[] =
    [
        { dimension: 'dietaryFlags', labelKey: 'dietaryLabel' },
        { dimension: 'tags', labelKey: 'tagsLabel' },
    ];

export const RecipeFilterBar: FC<RecipeFilterBarProps> = ({
    facets,
    filters,
    onToggleFacet,
    onSetMaxTotalTime,
    onClearAll,
}) => {
    const m = useMessages(filterMessages);
    const locale = useLocale();
    const countLabels = { one: m.chipCountOne, other: m.chipCountOther };

    const renderChip = (chip: RecipeFacetChip, dimension: FacetDimension) => {
        const name = formatFacetChipName(chip, countLabels, locale);

        return (
            <Pressable
                key={chip.value}
                accessibilityRole="button"
                accessibilityLabel={name}
                accessibilityState={{ selected: chip.selected }}
                aria-pressed={chip.selected}
                onPress={() => onToggleFacet(dimension, chip.value)}
                style={[styles.chip, chip.selected ? styles.chipSelected : styles.chipUnselected]}
            >
                <Text style={chip.selected ? styles.chipTextSelected : styles.chipText}>
                    {chip.count === undefined ? chip.value : `${chip.value} ${chip.count}`}
                </Text>
            </Pressable>
        );
    };

    return (
        <View role="group" aria-label={m.barLabel} style={styles.container}>
            {FACET_GROUPS.map(({ dimension, labelKey }) => {
                const chips = buildFacetChips(facets[dimension], filters[dimension] ?? []);

                if (chips.length === 0) {
                    return null;
                }

                return (
                    <View key={dimension} role="group" aria-label={m[labelKey]} style={styles.group}>
                        <Text style={styles.groupLabel}>{m[labelKey]}</Text>
                        <View style={styles.chipRow}>{chips.map((chip) => renderChip(chip, dimension))}</View>
                    </View>
                );
            })}

            <View role="group" aria-label={m.maxTotalTimeLabel} style={styles.group}>
                <Text style={styles.groupLabel}>{m.maxTotalTimeLabel}</Text>
                <View style={styles.chipRow}>
                    {TOTAL_TIME_BUCKETS_MINUTES.map((minutes) => {
                        const active = filters.maxTotalTime === minutes;

                        return (
                            <Pressable
                                key={minutes}
                                accessibilityRole="button"
                                accessibilityLabel={fillTemplate(m.timeBucket, { minutes })}
                                accessibilityState={{ selected: active }}
                                aria-pressed={active}
                                onPress={() => onSetMaxTotalTime(active ? undefined : minutes)}
                                style={[styles.chip, active ? styles.chipSelected : styles.chipUnselected]}
                            >
                                <Text style={active ? styles.chipTextSelected : styles.chipText}>
                                    {fillTemplate(m.timeBucket, { minutes })}
                                </Text>
                            </Pressable>
                        );
                    })}
                </View>
            </View>

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
