/**
 * @module @commise/features-recipes — native concurrent-edit conflict view (T070 / C-005 / W7 building
 * block).
 *
 * The React Native leaf of {@link import('./RecipeConflictView.js').RecipeConflictView} — same FULLY
 * controlled, presentational contract for FR-007c. Mirrors the web leaf's W7 rebuild of the DEFAULT (options)
 * view (Task 3): a per-side banner (X3, server ALWAYS first — X7), three A/B/C option cards (X2), and the
 * changed-only diff panel (W7 Task 4 / X1) driven by the precomputed `ConflictDiff` (W7 Task 1) — one row
 * per changed-or-conflicting field/element, each with an accessible marker (text/role, never colour alone)
 * and Server-then-Yours values (X7), plus a legend. The merge panel (Option C) is unchanged from the pre-W7
 * shape.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { useState } from 'react';
import type { FC } from 'react';
import { palette } from '@commise/ui';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { ConflictMarker } from './conflictDiff.js';
import { recipeVersionMessages } from './messages.js';
import {
    buildRecipeMergeFields,
    conflictMarkerGlyph,
    conflictMarkerLabel,
    conflictRowLabel,
    fillTemplate,
    formatServerBanner,
    type MergeSide,
    type RecipeConflictViewProps,
} from './model.js';

/** The three markers, in the order the legend explains them (matching the wireframe's own `[=] [→] [!!]`
 *  order). */
const LEGEND_MARKERS: readonly ConflictMarker[] = ['unchanged', 'changed', 'conflict'];

/** One A/B/C option card — a title, a description, and the choice it fires. */
const OptionCard: FC<{
    readonly title: string;
    readonly description: string;
    readonly onChoose: () => void;
}> = ({ title, description, onChoose }) => (
    <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onChoose} style={styles.optionCard}>
        <Text style={styles.optionTitle}>{title}</Text>
        <Text style={styles.optionDescription}>{description}</Text>
    </Pressable>
);

/** One radio option in a field's merge chooser. */
const MergeOption: FC<{
    readonly label: string;
    readonly checked: boolean;
    readonly onSelect: () => void;
}> = ({ label, checked, onSelect }) => (
    <Pressable
        accessibilityRole="radio"
        accessibilityLabel={label}
        aria-checked={checked}
        onPress={onSelect}
        style={styles.option}
    >
        <View style={[styles.radioDot, checked && styles.radioDotChecked]} />
        <Text style={styles.optionLabel}>{label}</Text>
    </Pressable>
);

export const RecipeConflictView: FC<RecipeConflictViewProps> = ({
    server,
    diff,
    mineValues,
    theirsValues,
    selections,
    onSelectionsChange,
    onKeepServer,
    onOverwrite,
    onMerge,
}) => {
    const { conflict } = useMessages(recipeVersionMessages);
    const locale = useLocale();
    // Whether the merge panel is showing is pure UI navigation — stays local. `selections` is fully
    // controlled by the caller (the `useRecipeEditor` machine).
    const [merging, setMerging] = useState(false);
    // Reading the clock is THIS component's own side effect — see the web leaf's own note.
    const now = new Date();

    const optionLabel = (side: string, value: string): string =>
        fillTemplate(conflict.mergeOptionLabel, { side, value });

    if (merging) {
        const fields = buildRecipeMergeFields(mineValues, theirsValues, conflict, locale);
        // Sparse per-field resolution: an absent field defaults to "mine", matching `composeMergedRecipe`.
        const sideOf = (key: string): MergeSide => selections[key] ?? 'mine';
        const choose = (key: string, side: MergeSide): void => onSelectionsChange({ ...selections, [key]: side });

        return (
            <View accessibilityLabel={conflict.mergeHeading} style={styles.container}>
                <Text accessibilityRole="header" style={styles.heading}>
                    {conflict.mergeHeading}
                </Text>
                <Text style={styles.explanation}>{conflict.mergeExplanation}</Text>
                {fields.map((field) => (
                    <View
                        key={field.key}
                        accessibilityRole="radiogroup"
                        accessibilityLabel={field.label}
                        style={styles.group}
                    >
                        <Text style={styles.fieldLabel}>{field.label}</Text>
                        <MergeOption
                            label={optionLabel(conflict.mergeMineLabel, field.mineValue)}
                            checked={sideOf(field.key) === 'mine'}
                            onSelect={() => choose(field.key, 'mine')}
                        />
                        <MergeOption
                            label={optionLabel(conflict.mergeServerLabel, field.theirsValue)}
                            checked={sideOf(field.key) === 'theirs'}
                            onSelect={() => choose(field.key, 'theirs')}
                        />
                    </View>
                ))}
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={conflict.mergeSubmit}
                    onPress={() => onMerge(selections)}
                    style={styles.chooseButton}
                >
                    <Text style={styles.chooseLabel}>{conflict.mergeSubmit}</Text>
                </Pressable>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={conflict.mergeBack}
                    onPress={() => {
                        onSelectionsChange({});
                        setMerging(false);
                    }}
                    style={styles.secondaryButton}
                >
                    <Text style={styles.secondaryLabel}>{conflict.mergeBack}</Text>
                </Pressable>
            </View>
        );
    }

    return (
        <View accessibilityLabel={conflict.heading} style={styles.container}>
            <Text accessibilityRole="header" style={styles.heading}>
                {conflict.heading}
            </Text>
            <Text style={styles.explanation}>{conflict.explanation}</Text>

            {/* Per-side banner (X3) — server is ALWAYS first (X7). */}
            <View style={styles.banner}>
                <Text style={styles.bannerLine}>{formatServerBanner(server, now, conflict, locale)}</Text>
                <Text style={styles.bannerLine}>{conflict.mineBanner}</Text>
            </View>

            {/* Three A/B/C option cards (X2). */}
            <OptionCard
                title={conflict.optionServerTitle}
                description={conflict.optionServerDescription}
                onChoose={onKeepServer}
            />
            <OptionCard
                title={conflict.optionOverwriteTitle}
                description={conflict.optionOverwriteDescription}
                onChoose={onOverwrite}
            />
            <OptionCard
                title={conflict.optionMergeTitle}
                description={conflict.optionMergeDescription}
                onChoose={() => setMerging(true)}
            />

            {/* Changed-only diff panel with per-row markers + legend (W7 Task 4 / X1). */}
            {diff.rows.length > 0 ? (
                <View accessibilityLabel={conflict.changedFieldsHeading} style={styles.changedFields}>
                    <Text accessibilityRole="header" style={styles.subheading}>
                        {conflict.changedFieldsHeading}
                    </Text>
                    {diff.rows.map((row) => (
                        <View key={row.key} style={styles.changedFieldRow}>
                            <View style={styles.changedFieldRowHeader}>
                                <View
                                    accessible
                                    accessibilityRole="image"
                                    accessibilityLabel={conflictMarkerLabel(row.marker, conflict)}
                                >
                                    <Text style={styles.marker}>{conflictMarkerGlyph(row.marker, conflict)}</Text>
                                </View>
                                <Text style={styles.fieldLabel}>{conflictRowLabel(row, conflict)}</Text>
                            </View>
                            {row.base !== undefined && (
                                <Text style={styles.changedFieldValue}>
                                    {fillTemplate(conflict.wasValueLabel, { value: row.base })}
                                </Text>
                            )}
                            {/* Server value FIRST, then Yours (X7). */}
                            <Text style={styles.changedFieldValue}>
                                {optionLabel(conflict.mergeServerLabel, row.theirs)}
                            </Text>
                            <Text style={styles.changedFieldValue}>
                                {optionLabel(conflict.mergeMineLabel, row.mine)}
                            </Text>
                        </View>
                    ))}
                    <View accessibilityLabel={conflict.legendHeading} style={styles.legend}>
                        {LEGEND_MARKERS.map((marker) => (
                            <Text key={marker} style={styles.legendEntry}>
                                {fillTemplate(conflict.legendEntryTemplate, {
                                    glyph: conflictMarkerGlyph(marker, conflict),
                                    label: conflictMarkerLabel(marker, conflict),
                                })}
                            </Text>
                        ))}
                    </View>
                </View>
            ) : (
                // Defensive — Task 2 already fast-paths a genuinely phantom-empty diff away from this view,
                // so this should not normally be reached; a blank panel is never an acceptable fallback.
                <Text style={styles.explanation}>{conflict.noDifferencesMessage}</Text>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    container: { gap: 12, paddingHorizontal: 16, paddingVertical: 16 },
    heading: { fontSize: 20, fontWeight: '600', color: palette.charcoal },
    explanation: { fontSize: 14, color: palette.slate },
    banner: {
        backgroundColor: palette.white,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: 'rgba(178, 190, 195, 0.3)',
        padding: 16,
        gap: 4,
    },
    bannerLine: { fontSize: 15, color: palette.charcoal },
    optionCard: {
        backgroundColor: palette.white,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: 'rgba(178, 190, 195, 0.3)',
        padding: 16,
        gap: 4,
    },
    optionTitle: { fontSize: 17, fontWeight: '600', color: palette.charcoal },
    optionDescription: { fontSize: 13, color: palette.slate },
    group: {
        backgroundColor: palette.white,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: 'rgba(178, 190, 195, 0.3)',
        padding: 16,
        gap: 8,
    },
    fieldLabel: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: palette.slate },
    subheading: { fontSize: 15, fontWeight: '600', color: palette.charcoal },
    changedFields: { gap: 8 },
    changedFieldRow: {
        backgroundColor: palette.white,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: 'rgba(178, 190, 195, 0.3)',
        padding: 12,
        gap: 2,
    },
    changedFieldRowHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    marker: { fontSize: 13, fontVariant: ['tabular-nums'], color: palette.slate },
    changedFieldValue: { fontSize: 14, color: palette.charcoal },
    legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 4 },
    legendEntry: { fontSize: 12, color: palette.slate },
    option: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
    radioDot: {
        width: 18,
        height: 18,
        borderRadius: 9,
        borderWidth: 2,
        borderColor: palette.slate,
    },
    radioDotChecked: { borderColor: palette.seafoam, backgroundColor: palette.seafoam },
    optionLabel: { fontSize: 15, color: palette.charcoal, flexShrink: 1 },
    chooseButton: {
        alignSelf: 'flex-start',
        backgroundColor: palette.seafoam,
        borderRadius: 999,
        paddingVertical: 10,
        paddingHorizontal: 20,
        marginTop: 4,
    },
    chooseLabel: { color: palette.white, fontWeight: '600', fontSize: 14 },
    secondaryButton: {
        alignSelf: 'flex-start',
        borderRadius: 999,
        borderWidth: 1,
        borderColor: 'rgba(178, 190, 195, 0.5)',
        paddingVertical: 10,
        paddingHorizontal: 20,
        marginTop: 4,
    },
    secondaryLabel: { color: palette.charcoal, fontWeight: '600', fontSize: 14 },
});
