/**
 * @module @commise/features-recipes — native two-version compare sheet (W6 Task 4 / FR-007b, FR-007c).
 *
 * The React Native leaf of {@link import('./VersionCompareView.js').VersionCompareView}: a full-screen RN
 * `Modal` sheet (`presentationStyle="fullScreen"`, `animationType="slide"`), MIRRORING
 * `VersionPreviewModal.native.tsx` (W6 Task 3) and rendering the SAME controlled, presentational contract as
 * the web leaf — same state precedence, same localized copy, so the two platforms can't drift.
 * `onRequestClose` (the Android hardware-back path RN provides) is wired straight to `onClose`, the same
 * callback the explicit close control uses — one exit path, not two. Per CR-004 ("Native adaptation: the
 * compare/diff sidebar … become[s a] full-screen sheet"), the web's right-side panel becomes this full-screen
 * takeover, and the web's two-column A/B grid becomes version B stacked over version A per field — matching
 * the web columns' left-to-right order, both driven by the "Compare v{B} vs v{A}" heading order.
 *
 * A three-way state ({@link import('./model.js').compareViewState}, discriminated — see the web leaf's
 * module docs for the full semantics): `'selecting'` (fewer than two versions/diff supplied yet),
 * `'unchanged'` (identical snapshots), `'changed'` (the Diff Summary + changed-only A/B rows).
 * `steps`/`ingredients` rows show a COUNT ONLY by default (never a per-line explosion — the Task 1 reorder
 * sanity note); their own Added/Removed/Modified tally is opt-in detail behind "Show full diff".
 */
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { useState } from 'react';
import type { FC } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { recipeVersionMessages } from './messages.js';
import {
    buildCompareFieldRows,
    compareViewState,
    fillTemplate,
    formatCollectionTally,
    type VersionCompareViewProps,
} from './model.js';

export const VersionCompareView: FC<VersionCompareViewProps> = ({
    open,
    versionA,
    versionB,
    diff,
    onClose,
    locale,
}) => {
    const { compare, conflict, versionList } = useMessages(recipeVersionMessages);
    const [showFullDiff, setShowFullDiff] = useState(false);

    if (!open) {
        return null;
    }

    const state = compareViewState(versionA, versionB, diff);
    const heading =
        state !== 'selecting' && versionA !== undefined && versionB !== undefined
            ? fillTemplate(compare.title, { versionA: versionA.versionNumber, versionB: versionB.versionNumber })
            : compare.selectTwoVersions;
    const rows =
        diff !== undefined && versionA !== undefined && versionB !== undefined
            ? buildCompareFieldRows(diff, versionA, versionB, conflict, locale)
            : [];
    const hasCollectionRow = rows.some((row) => row.tally !== undefined);

    return (
        <Modal visible={open} onRequestClose={onClose} animationType="slide" presentationStyle="fullScreen">
            <View style={styles.container}>
                <View style={styles.headerRow}>
                    <Text accessibilityRole="header" style={styles.title}>
                        {heading}
                    </Text>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={compare.close}
                        onPress={onClose}
                        style={styles.closeButton}
                    >
                        <Text style={styles.closeLabel}>×</Text>
                    </Pressable>
                </View>

                {state !== 'selecting' && diff !== undefined && (
                    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
                        <View accessibilityLabel={compare.diffSummaryHeading} style={styles.summary}>
                            <Text accessibilityRole="header" style={styles.summaryHeading}>
                                {compare.diffSummaryHeading}
                            </Text>
                            <Text style={styles.body}>
                                {fillTemplate(compare.added, { count: diff.summary.added })}
                            </Text>
                            <Text style={styles.body}>
                                {fillTemplate(compare.removed, { count: diff.summary.removed })}
                            </Text>
                            <Text style={styles.body}>
                                {fillTemplate(compare.modified, { count: diff.summary.modified })}
                            </Text>
                        </View>

                        {state === 'unchanged' ? (
                            <Text style={styles.body}>{compare.noChanges}</Text>
                        ) : (
                            versionA !== undefined &&
                            versionB !== undefined && (
                                <View style={styles.rows}>
                                    {rows.map((row) => (
                                        <View key={row.key} style={styles.row}>
                                            <Text style={styles.fieldLabel}>{row.label}</Text>
                                            <View style={styles.side}>
                                                <Text style={styles.sideLabel}>
                                                    {fillTemplate(versionList.versionLabel, {
                                                        version: versionB.versionNumber,
                                                    })}
                                                </Text>
                                                <Text style={styles.fieldValue}>{row.valueB}</Text>
                                            </View>
                                            <View style={styles.side}>
                                                <Text style={styles.sideLabel}>
                                                    {fillTemplate(versionList.versionLabel, {
                                                        version: versionA.versionNumber,
                                                    })}
                                                </Text>
                                                <Text style={styles.fieldValue}>{row.valueA}</Text>
                                            </View>
                                            {row.tally !== undefined && showFullDiff && (
                                                <Text style={styles.tally}>
                                                    {formatCollectionTally(row.tally, compare)}
                                                </Text>
                                            )}
                                        </View>
                                    ))}
                                    {hasCollectionRow && (
                                        <Pressable
                                            accessibilityRole="button"
                                            accessibilityLabel={
                                                showFullDiff ? compare.hideFullDiff : compare.showFullDiff
                                            }
                                            onPress={() => setShowFullDiff((current) => !current)}
                                            style={styles.toggleButton}
                                        >
                                            <Text style={styles.toggleLabel}>
                                                {showFullDiff ? compare.hideFullDiff : compare.showFullDiff}
                                            </Text>
                                        </Pressable>
                                    )}
                                </View>
                            )
                        )}
                    </ScrollView>
                )}
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: palette.white, padding: 20, gap: 16 },
    headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    title: { flexShrink: 1, fontSize: 20, fontWeight: '600', color: palette.charcoal },
    closeButton: { borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 },
    closeLabel: { fontSize: 20, color: palette.slate },
    body: { fontSize: 15, lineHeight: 22, color: palette.slate },
    scroll: { flex: 1 },
    scrollContent: { gap: 16 },
    summary: { gap: 4, borderRadius: 16, backgroundColor: 'rgba(178, 190, 195, 0.15)', padding: 16 },
    summaryHeading: { fontSize: 16, fontWeight: '600', color: palette.charcoal },
    rows: { gap: 12 },
    row: { gap: 6, borderRadius: 16, backgroundColor: 'rgba(178, 190, 195, 0.15)', padding: 12 },
    fieldLabel: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: palette.slate },
    side: { gap: 2 },
    sideLabel: { fontSize: 11, fontWeight: '600', color: palette.slate },
    fieldValue: { fontSize: 15, color: palette.charcoal },
    tally: { fontSize: 12, color: palette.slate },
    toggleButton: { alignSelf: 'flex-start', borderRadius: 999, paddingVertical: 8, paddingHorizontal: 16 },
    toggleLabel: { color: palette.seafoam, fontWeight: '600', fontSize: 14 },
});
