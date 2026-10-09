/**
 * @module @commise/features-recipes — native concurrent-edit conflict view (T070 / C-005 / W7 building
 * block).
 *
 * The React Native leaf of `RecipeConflictView` — same FULLY
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
 * SAME instance), held by `useConflictView`, which the web leaf shares. See the web leaf's own module doc for
 * the full rationale.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import type { FC } from 'react';
import { palette } from '@commise/ui';
import { Button } from '@commise/ui/button';
import { VariantPartsLine, type VariantPartsLineProps } from '@commise/ui/variant-parts-line';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { conflictSideParts } from './conflictDiff.js';
import { recipeVersionMessages } from './messages.js';
import { fillTemplate } from '../list/model.js';
import {
    LEGEND_MARKERS,
    type ConflictOptionCardProps,
    type DiscardAndCloseProps,
    type RecipeConflictViewProps,
    type SideValueProps,
    type StaleBaseWarningProps,
    type VersionSideCardProps,
    conflictCopyOf,
    formatMergeSummary,
    formatServerBanner,
    formatServerCardHeading,
    formatVersionCardSavedLine,
    formatYourCardHeading,
} from './conflictView.js';
import {
    conflictMarkerGlyph,
    conflictMarkerLabel,
    conflictOptionLabel,
    conflictOptionName,
    conflictRowLabel,
    conflictRowName,
} from './diffLabels.js';
import { useConflictView } from './useConflictView.js';

/** One A/B/C option card — a title, a description, and the choice it fires. `disabled` (W7 Task 5 / X6) is
 *  the stale-base confirm gate on Option B (Overwrite) — Option A and C are never gated this way. */
const OptionCard: FC<ConflictOptionCardProps> = ({ title, description, onChoose, disabled = false }) => (
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

/**
 * The header "Discard and close" exit (wireframe gap #1 — `conflict-resolution.md:34`). Rendered identically
 * in BOTH the default (options) view and the merge panel, and — UNLIKE every other control on this view —
 * NEVER disabled: it is the escape hatch a hung `onOverwrite`/`onMerge` resolve must not be able to trap the
 * user behind (`useRecipeEditor`'s `discardAndClose` stays callable regardless of `isResolving`).
 */
const DiscardAndCloseButton: FC<DiscardAndCloseProps> = ({ label, onDiscardAndClose }) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onDiscardAndClose} style={styles.option}>
        <Text style={styles.discardLabel}>
            {'‹ '}
            {label}
        </Text>
    </Pressable>
);

/**
 * One two-column per-side summary card (wireframe gap #2 — `conflict-resolution.md:46-50`) — a heading plus
 * an optional "Saved:" line and an optional "Device:" line, omitted (never fabricated) when the underlying
 * side carries no such data. Rendered ONLY in the default (options) view.
 */
const VersionSideCard: FC<VersionSideCardProps> = ({ heading, savedLine }) => (
    <View style={styles.versionCard}>
        <Text style={styles.versionCardHeading}>{heading}</Text>
        {savedLine !== undefined && <Text style={styles.versionCardLine}>{savedLine}</Text>}
    </View>
);

/**
 * One side's value and, when that side is variant-bound, its dotted line under it (curated U15, R25), in a block of
 * their own so the line reads with its side rather than the next one. See the web leaf's `SideValue`.
 */
const SideValue: FC<SideValueProps> = ({ children, parts }) => (
    <View style={styles.side}>
        {children}
        {parts !== undefined && <VariantPartsLine parts={parts} tone="secondary" />}
    </View>
);

/**
 * One radio option in a merge row's chooser. `name` is its accessible name, which carries a variant's parts (R27);
 * the Pressable's label hides its children from a screen reader, so the visible dotted line cannot say them.
 */
const MergeOption: FC<{
    readonly label: string;
    readonly name: string;
    readonly parts: VariantPartsLineProps['parts'] | undefined;
    readonly checked: boolean;
    readonly onSelect: () => void;
}> = ({ label, name, parts, checked, onSelect }) => (
    <Pressable
        accessibilityRole="radio"
        accessibilityLabel={name}
        aria-checked={checked}
        onPress={onSelect}
        style={styles.option}
    >
        <View style={[styles.radioDot, checked && styles.radioDotChecked]} />
        <SideValue parts={parts}>
            <Text style={styles.optionLabel}>{label}</Text>
        </SideValue>
    </Pressable>
);

/**
 * The stale-base warning + explicit confirm checkbox (W7 Task 5 / X6) — shared, unchanged markup between the
 * options view (gates Overwrite) and the merge panel (gates Save merged version). `accessibilityRole="alert"`
 * mirrors `RecipeDeleteDialog.native`'s own alert-role warning surface; the checkbox mirrors
 * `RecipeVersionList.native`'s convention — a ☑/☐ glyph for sighted readers PLUS an explicit `aria-checked`
 * for assistive tech, since react-native-web projects `accessibilityState` to nothing (#123).
 */
const StaleBaseWarning: FC<StaleBaseWarningProps> = ({ warning, confirmLabel, confirmed, onConfirmedChange }) => (
    <View collapsable={false} accessibilityRole="alert" style={styles.staleWarning}>
        <Text style={styles.staleWarningText}>{warning}</Text>
        <Pressable
            accessibilityRole="checkbox"
            accessibilityLabel={confirmLabel}
            // Device trait + the DOM-observable checked state; both are load-bearing (#123) — react-native-web
            // projects `accessibilityState` to no attribute, and RN reverse-maps `aria-checked` back into it,
            // so neither form is redundant. `aria-checked` is `role="checkbox"`'s own attribute (the sibling
            // `MergeOption` radios already carry it), unlike `aria-selected`/`aria-pressed`.
            accessibilityState={{ checked: confirmed }}
            aria-checked={confirmed}
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
    isResolving,
    selections,
    onSelectionsChange,
    onKeepServer,
    onOverwrite,
    onMerge,
    onDiscardAndClose,
    neverPublished = false,
}) => {
    const conflict = conflictCopyOf(useMessages(recipeVersionMessages).conflict, neverPublished);
    const locale = useLocale();
    const view = useConflictView({ server, base, versionsBehind, neverPublished, selections, onSelectionsChange });

    // Reading the clock is THIS component's own side effect — see the web leaf's own note.
    const now = new Date();

    const staleWarning = view.isStale ? (
        <StaleBaseWarning
            warning={conflict.staleBaseWarning}
            confirmLabel={conflict.staleBaseConfirmLabel}
            confirmed={view.staleConfirmed}
            onConfirmedChange={view.setStaleConfirmed}
        />
    ) : null;

    if (view.merging) {
        return (
            <View style={styles.container}>
                <DiscardAndCloseButton label={conflict.discardAndClose} onDiscardAndClose={onDiscardAndClose} />
                <Text accessibilityRole="header" style={styles.heading}>
                    {conflict.mergeHeading}
                </Text>
                <Text style={styles.explanation}>{conflict.mergeExplanation}</Text>
                {staleWarning}
                {diff.rows.map((row) => {
                    const label = conflictRowLabel(row, conflict);
                    const current = view.sideOf(row.key);

                    return (
                        <View
                            collapsable={false}
                            key={row.key}
                            accessibilityRole="radiogroup"
                            // The name carries a variant's parts (R27); the visible label stays plain (R25).
                            accessibilityLabel={conflictRowName(row, conflict)}
                            style={styles.group}
                        >
                            <Text style={styles.fieldLabel}>{label}</Text>
                            {/* Server FIRST, then Yours (X7). */}
                            {(['theirs', 'mine'] as const).map((side) => (
                                <MergeOption
                                    key={side}
                                    label={conflictOptionLabel(row, side, conflict)}
                                    name={conflictOptionName(row, side, conflict)}
                                    parts={conflictSideParts(row, side)}
                                    checked={current === side}
                                    onSelect={() => view.choose(row.key, side)}
                                />
                            ))}
                        </View>
                    );
                })}
                <Text accessibilityLiveRegion="polite" style={styles.summary}>
                    {formatMergeSummary(selections, conflict, locale)}
                </Text>
                {!view.hasSelection && (
                    <Text accessibilityLiveRegion="polite" style={styles.explanation}>
                        {conflict.mergeNoSelectionHint}
                    </Text>
                )}
                {/* `isResolving` is combined with, not a replacement for, the selection + stale-base gates: any one of
                    the three blocks the submit (the Button's busy also refuses the press). */}
                <View style={styles.action}>
                    <Button
                        icon="check"
                        busy={isResolving}
                        disabled={view.mergeBlocked}
                        onPress={() => onMerge(selections)}
                    >
                        {conflict.mergeSubmit}
                    </Button>
                </View>
                <View style={styles.action}>
                    <Button variant="secondary" icon="chevronLeft" onPress={view.leaveMerge}>
                        {conflict.mergeBack}
                    </Button>
                </View>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <DiscardAndCloseButton label={conflict.discardAndClose} onDiscardAndClose={onDiscardAndClose} />
            <Text accessibilityRole="header" style={styles.heading}>
                {conflict.heading}
            </Text>
            <Text style={styles.explanation}>{conflict.explanation}</Text>

            {/* Per-side banner (X3) — server is ALWAYS first (X7). */}
            <View style={styles.banner}>
                <Text style={styles.bannerLine}>{formatServerBanner(server, now, conflict, locale)}</Text>
                <Text style={styles.bannerLine}>{conflict.mineBanner}</Text>
            </View>

            {/* Two-column per-side summary cards (wireframe gap #2) — server ALWAYS first (X7). */}
            <View style={styles.versionCardRow}>
                <VersionSideCard
                    heading={formatServerCardHeading(server, conflict)}
                    savedLine={formatVersionCardSavedLine(server, locale, conflict)}
                />
                <VersionSideCard
                    heading={formatYourCardHeading(base, conflict)}
                    {...(base === undefined
                        ? {}
                        : {
                              savedLine: formatVersionCardSavedLine(base, locale, conflict),
                          })}
                />
            </View>

            {/* Stale-base warning (W7 Task 5 / X6) — gates Overwrite below. */}
            {staleWarning}

            {/* Three A/B/C option cards (X2). `isResolving` (concurrency/double-submit fix) disables ALL three
                — combined with, not replacing, Overwrite's existing stale-base gate — while a resolve is in
                flight, so a rapid double-tap cannot fire a second resolve before the first settles. */}
            <OptionCard
                title={conflict.optionServerTitle}
                description={conflict.optionServerDescription}
                onChoose={onKeepServer}
                disabled={isResolving}
            />
            <OptionCard
                title={conflict.optionOverwriteTitle}
                description={conflict.optionOverwriteDescription}
                onChoose={onOverwrite}
                disabled={isResolving || view.overwriteBlocked}
            />
            <OptionCard
                title={conflict.optionMergeTitle}
                description={conflict.optionMergeDescription}
                onChoose={view.startMerge}
                disabled={isResolving}
            />

            {/* Changed-only diff panel with per-row markers + legend (W7 Task 4 / X1). */}
            {diff.rows.length > 0 ? (
                <View style={styles.changedFields}>
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
                                <SideValue parts={conflictSideParts(row, 'base')}>
                                    <Text style={styles.changedFieldValue}>
                                        {fillTemplate(conflict.wasValueLabel, { value: row.base })}
                                    </Text>
                                </SideValue>
                            )}
                            {/* Server value FIRST, then Yours (X7). */}
                            {(['theirs', 'mine'] as const).map((side) => (
                                <SideValue key={side} parts={conflictSideParts(row, side)}>
                                    <Text style={styles.changedFieldValue}>
                                        {conflictOptionLabel(row, side, conflict)}
                                    </Text>
                                </SideValue>
                            ))}
                        </View>
                    ))}
                    <View collapsable={false} accessibilityLabel={conflict.legendHeading} style={styles.legend}>
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
    discardLabel: { fontSize: 14, fontWeight: '600', color: palette.slate },
    versionCardRow: { flexDirection: 'row', gap: 12 },
    versionCard: {
        flex: 1,
        backgroundColor: palette.white,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: 'rgba(178, 190, 195, 0.3)',
        padding: 16,
        gap: 4,
    },
    versionCardHeading: {
        fontSize: 11,
        fontWeight: '600',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        color: palette.charcoal,
    },
    versionCardLine: { fontSize: 14, color: palette.slate },
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
        gap: 8,
    },
    changedFieldRowHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    marker: { fontSize: 13, fontVariant: ['tabular-nums'], color: palette.slate },
    changedFieldValue: { fontSize: 14, color: palette.charcoal },
    legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 4 },
    legendEntry: { fontSize: 12, color: palette.slate },
    // `flex-start`: the dot sits on the first line when the value wraps or a dotted line follows it.
    option: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 4 },
    // `flexShrink: 1`: React Native defaults it to 0, so beside the dot the text would not wrap inside the row.
    side: { flexShrink: 1, gap: 4 },
    radioDot: {
        width: 18,
        height: 18,
        borderRadius: 9,
        borderWidth: 2,
        borderColor: palette.slate,
    },
    radioDotChecked: { borderColor: palette.seafoam, backgroundColor: palette.seafoam },
    optionLabel: { fontSize: 15, color: palette.charcoal, flexShrink: 1 },
    action: { alignSelf: 'flex-start', marginTop: 4 },
});
