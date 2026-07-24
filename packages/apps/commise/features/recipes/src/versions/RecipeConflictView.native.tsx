/**
 * @module @commise/features-recipes — native concurrent-edit conflict view (T070 / C-005 / W7 building
 * block).
 *
 * The React Native leaf of {@link import('./RecipeConflictView.js').RecipeConflictView} — same FULLY
 * controlled, presentational contract for FR-007c. Mirrors the web leaf's W7 rebuild of the DEFAULT (options)
 * view (Task 3): a per-side banner (X3, server ALWAYS first — X7), three A/B/C option cards (X2), and the
 * changed-only diff panel (W7 Task 4 / X1) driven by the precomputed `ConflictDiff` (W7 Task 1) — one row
 * per changed-or-conflicting field/element, each with an accessible marker (text/role, never colour alone)
 * and Server-then-Yours values (X7), plus a legend.
 *
 * Merge mode (Option C, W7 Task 5) renders ONLY `diff.rows`, Server FIRST then Yours (X7), gated (X5) on at
 * least one EXPLICIT selection and — when the base is evicted or more than 10 versions behind (X6) — an
 * explicit stale-base confirm shared with Overwrite. Both the merge-panel toggle and the stale-confirm
 * checkbox are local UI state that resets whenever `server.versionNumber` changes (a NEW conflict on this
 * SAME instance). See the web leaf's own module doc for the full rationale; this file mirrors it exactly so
 * the two platforms cannot drift.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { useEffect, useState } from 'react';
import type { FC } from 'react';
import { palette } from '@commise/ui';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { ConflictMarker } from './conflictDiff.js';
import { recipeVersionMessages } from './messages.js';
import {
    conflictMarkerGlyph,
    conflictMarkerLabel,
    conflictRowLabel,
    fillTemplate,
    formatMergeSummary,
    formatServerBanner,
    isConflictBaseStale,
    type MergeSide,
    type RecipeConflictViewProps,
} from './model.js';

/** The three markers, in the order the legend explains them (matching the wireframe's own `[=] [→] [!!]`
 *  order). */
const LEGEND_MARKERS: readonly ConflictMarker[] = ['unchanged', 'changed', 'conflict'];

/** One A/B/C option card — a title, a description, and the choice it fires. `disabled` (W7 Task 5 / X6) is
 *  the stale-base confirm gate on Option B (Overwrite) — Option A and C are never gated this way. */
const OptionCard: FC<{
    readonly title: string;
    readonly description: string;
    readonly onChoose: () => void;
    readonly disabled?: boolean;
}> = ({ title, description, onChoose, disabled = false }) => (
    <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        disabled={disabled}
        onPress={onChoose}
        style={[styles.optionCard, disabled && styles.optionCardDisabled]}
    >
        <Text style={styles.optionTitle}>{title}</Text>
        <Text style={styles.optionDescription}>{description}</Text>
    </Pressable>
);

/** One radio option in a merge row's chooser. */
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

/**
 * The stale-base warning + explicit confirm checkbox (W7 Task 5 / X6) — shared, unchanged markup between the
 * options view (gates Overwrite) and the merge panel (gates Save merged version). `accessibilityRole="alert"`
 * mirrors `RecipeDeleteDialog.native`'s own alert-role warning surface; the checkbox mirrors
 * `RecipeVersionList.native`'s ☑/☐-glyph checkbox convention (react-native-web renders `role="checkbox"` but
 * not a reliable `aria-checked`).
 */
const StaleBaseWarning: FC<{
    readonly warning: string;
    readonly confirmLabel: string;
    readonly confirmed: boolean;
    readonly onConfirmedChange: (confirmed: boolean) => void;
}> = ({ warning, confirmLabel, confirmed, onConfirmedChange }) => (
    <View accessibilityRole="alert" style={styles.staleWarning}>
        <Text style={styles.staleWarningText}>{warning}</Text>
        <Pressable
            accessibilityRole="checkbox"
            accessibilityLabel={confirmLabel}
            accessibilityState={{ checked: confirmed }}
            onPress={() => onConfirmedChange(!confirmed)}
            style={styles.option}
        >
            <Text style={styles.optionLabel}>
                {confirmed ? '☑' : '☐'} {confirmLabel}
            </Text>
        </Pressable>
    </View>
);

export const RecipeConflictView: FC<RecipeConflictViewProps> = ({
    server,
    base,
    diff,
    versionsBehind,
    selections,
    onSelectionsChange,
    onKeepServer,
    onOverwrite,
    onMerge,
}) => {
    const { conflict } = useMessages(recipeVersionMessages);
    const locale = useLocale();
    // Whether the merge panel is showing, and the stale-base confirm checkbox, are pure UI navigation state
    // (not data the `useRecipeEditor` machine needs) — they stay local. `selections` is fully controlled by
    // the caller.
    const [merging, setMerging] = useState(false);
    const [staleConfirmed, setStaleConfirmed] = useState(false);
    // A NEW conflict (same component instance, new props) must NOT inherit the PRIOR conflict's local UI
    // state — see the web leaf's own note (X6 robustness gap). `server.versionNumber` is this conflict's
    // stable identity token.
    useEffect(() => {
        setStaleConfirmed(false);
        setMerging(false);
    }, [server.versionNumber]);
    // Reading the clock is THIS component's own side effect — see the web leaf's own note.
    const now = new Date();

    const optionLabel = (side: string, value: string): string =>
        fillTemplate(conflict.mergeOptionLabel, { side, value });

    const isStale = isConflictBaseStale(base, versionsBehind);
    const hasSelection = Object.keys(selections).length > 0;
    const staleWarning = isStale ? (
        <StaleBaseWarning
            warning={conflict.staleBaseWarning}
            confirmLabel={conflict.staleBaseConfirmLabel}
            confirmed={staleConfirmed}
            onConfirmedChange={setStaleConfirmed}
        />
    ) : null;

    if (merging) {
        // No default side: an absent key renders NEITHER radio checked — see the web leaf's own note on why
        // this is a display/gating distinction, not a data one (`composeConflictMerge` still defaults to mine).
        const sideOf = (key: string): MergeSide | undefined => selections[key];
        const choose = (key: string, side: MergeSide): void => onSelectionsChange({ ...selections, [key]: side });
        const mergeDisabled = !hasSelection || (isStale && !staleConfirmed);

        return (
            <View accessibilityLabel={conflict.mergeHeading} style={styles.container}>
                <Text accessibilityRole="header" style={styles.heading}>
                    {conflict.mergeHeading}
                </Text>
                <Text style={styles.explanation}>{conflict.mergeExplanation}</Text>
                {staleWarning}
                {diff.rows.map((row) => {
                    const label = conflictRowLabel(row, conflict);
                    const current = sideOf(row.key);

                    return (
                        <View
                            key={row.key}
                            accessibilityRole="radiogroup"
                            accessibilityLabel={label}
                            style={styles.group}
                        >
                            <Text style={styles.fieldLabel}>{label}</Text>
                            {/* Server FIRST, then Yours (X7). */}
                            <MergeOption
                                label={optionLabel(conflict.mergeServerLabel, row.theirs)}
                                checked={current === 'theirs'}
                                onSelect={() => choose(row.key, 'theirs')}
                            />
                            <MergeOption
                                label={optionLabel(conflict.mergeMineLabel, row.mine)}
                                checked={current === 'mine'}
                                onSelect={() => choose(row.key, 'mine')}
                            />
                        </View>
                    );
                })}
                <Text accessibilityLiveRegion="polite" style={styles.summary}>
                    {formatMergeSummary(selections, conflict, locale)}
                </Text>
                {!hasSelection && (
                    <Text accessibilityLiveRegion="polite" style={styles.explanation}>
                        {conflict.mergeNoSelectionHint}
                    </Text>
                )}
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={conflict.mergeSubmit}
                    disabled={mergeDisabled}
                    onPress={() => onMerge(selections)}
                    style={[styles.chooseButton, mergeDisabled && styles.chooseButtonDisabled]}
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

            {/* Stale-base warning (W7 Task 5 / X6) — gates Overwrite below. */}
            {staleWarning}

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
                disabled={isStale && !staleConfirmed}
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
    staleWarning: {
        backgroundColor: 'rgba(230, 168, 60, 0.15)',
        borderRadius: 16,
        borderWidth: 1,
        borderColor: palette.warning,
        padding: 16,
        gap: 8,
    },
    staleWarningText: { fontSize: 14, color: palette.charcoal },
    optionCard: {
        backgroundColor: palette.white,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: 'rgba(178, 190, 195, 0.3)',
        padding: 16,
        gap: 4,
    },
    optionCardDisabled: { opacity: 0.5 },
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
    summary: { fontSize: 14, fontWeight: '600', color: palette.charcoal },
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
    chooseButtonDisabled: { opacity: 0.5 },
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
