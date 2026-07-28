/**
 * @module @commise/features-recipes — native version preview modal (W6 Task 3 / FR-007b).
 *
 * The React Native leaf of {@link import('./VersionPreviewModal.js').VersionPreviewModal}: a
 * {@link FullScreenSheet} (the shared primitive that owns the modal window and its safe-area padding — this
 * leaf used to hand-roll both, and shipped `PullUpdatesDialog`'s system-bar occlusion bug along with them),
 * rendering the SAME controlled, presentational contract as the web leaf — same
 * state precedence, same localized copy, so the two platforms can't drift. `onRequestClose` (the Android
 * hardware-back / web-Escape path RN provides) is wired straight to `onCancel`, the same callback the
 * explicit "Keep current version" control uses — one exit path, not two.
 *
 * A discriminated three-way state (mutually exclusive, matching {@link VersionPreviewModalProps}'s JSDoc):
 * (1) a `progressbar` affordance while `isLoading`, or before any `version` has arrived; (2) an `alert` for a
 * failed fetch — deliberately NOT a dead end, "Keep current version" still closes the modal; (3) the loaded
 * `version` — the snapshot's title, description, servings, prep/cook/total time, and ingredient lines
 * (calorie chip only when the line carries a `userCalories` override), plus the "Changed from current"
 * summary when `diffFromCurrent` was supplied, and the Restore action.
 */
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import type { FC } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { FullScreenSheet } from '../components/FullScreenSheet.native.js';
import { formatDurationMinutes } from '../list/model.js';
import { recipeVersionMessages } from './messages.js';
import {
    fillTemplate,
    formatChangedFromCurrent,
    toVersionPreviewIngredientLines,
    type VersionPreviewModalProps,
} from './model.js';

export const VersionPreviewModal: FC<VersionPreviewModalProps> = ({
    open,
    version,
    isLoading,
    error,
    diffFromCurrent,
    onCancel,
    onRestore,
    isRestoring = false,
    locale,
}) => {
    const { preview, conflict } = useMessages(recipeVersionMessages);

    if (!open) {
        return null;
    }

    // Never trust an in-flight fetch: loading always wins, and no version at all reads as "still loading"
    // rather than risking a blank/misleading modal before the first fetch resolves.
    const showLoading = isLoading || (version === undefined && error !== true);
    const showError = !showLoading && error === true;
    const showContent = !showLoading && !showError && version !== undefined;

    const title =
        version !== undefined
            ? fillTemplate(preview.title, { version: version.versionNumber, title: version.snapshot.title })
            : preview.titleLoading;

    return (
        <FullScreenSheet label={title} onRequestClose={onCancel}>
            <>
                <Text accessibilityRole="header" style={styles.title}>
                    {title}
                </Text>

                {showLoading && (
                    <Text accessibilityRole="progressbar" accessibilityLabel={preview.loading} style={styles.body}>
                        {preview.loading}
                    </Text>
                )}

                {showError && (
                    <Text accessibilityRole="alert" style={styles.error}>
                        {preview.error}
                    </Text>
                )}

                {showContent && version !== undefined && (
                    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
                        <View style={styles.fields}>
                            <View style={styles.field}>
                                <Text style={styles.fieldLabel}>{conflict.titleLabel}</Text>
                                <Text style={styles.fieldValue}>{version.snapshot.title}</Text>
                            </View>
                            <View style={styles.field}>
                                <Text style={styles.fieldLabel}>{conflict.descriptionLabel}</Text>
                                <Text style={styles.fieldValue}>{version.snapshot.description}</Text>
                            </View>
                            <View style={styles.field}>
                                <Text style={styles.fieldLabel}>{conflict.servingsLabel}</Text>
                                <Text style={styles.fieldValue}>{version.snapshot.servings}</Text>
                            </View>
                            <View style={styles.field}>
                                <Text style={styles.fieldLabel}>{conflict.prepLabel}</Text>
                                <Text style={styles.fieldValue}>
                                    {formatDurationMinutes(version.snapshot.prepTimeMinutes, conflict.minutes)}
                                </Text>
                            </View>
                            <View style={styles.field}>
                                <Text style={styles.fieldLabel}>{conflict.cookLabel}</Text>
                                <Text style={styles.fieldValue}>
                                    {formatDurationMinutes(version.snapshot.cookTimeMinutes, conflict.minutes)}
                                </Text>
                            </View>
                            <View style={styles.field}>
                                <Text style={styles.fieldLabel}>{conflict.totalLabel}</Text>
                                <Text style={styles.fieldValue}>
                                    {formatDurationMinutes(
                                        version.snapshot.prepTimeMinutes + version.snapshot.cookTimeMinutes,
                                        conflict.minutes,
                                    )}
                                </Text>
                            </View>
                        </View>

                        <Text accessibilityRole="header" style={styles.sectionHeading}>
                            {fillTemplate(preview.ingredientsHeading, { version: version.versionNumber })}
                        </Text>
                        <View style={styles.ingredients}>
                            {toVersionPreviewIngredientLines(version.snapshot.ingredients, preview, locale).map(
                                (line) => (
                                    <View key={line.key} style={styles.ingredientRow}>
                                        <Text style={styles.body}>{line.text}</Text>
                                        {line.calories !== undefined && (
                                            <Text style={styles.calories}>{line.calories}</Text>
                                        )}
                                    </View>
                                ),
                            )}
                        </View>

                        {diffFromCurrent !== undefined && (
                            <Text style={styles.changedNote}>
                                {formatChangedFromCurrent(diffFromCurrent, preview, conflict, locale)}
                            </Text>
                        )}
                    </ScrollView>
                )}

                <View style={styles.actions}>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={preview.keepCurrent}
                        onPress={onCancel}
                        style={styles.cancelButton}
                    >
                        <Text style={styles.cancelLabel}>{preview.keepCurrent}</Text>
                    </Pressable>
                    {showContent && version !== undefined && (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={isRestoring ? preview.restoringThis : preview.restoreThis}
                            accessibilityState={{ disabled: isRestoring, busy: isRestoring }}
                            disabled={isRestoring}
                            onPress={() => onRestore(version.versionNumber)}
                            style={styles.restoreButton}
                        >
                            <Text style={styles.restoreLabel}>
                                {isRestoring ? preview.restoringThis : preview.restoreThis}
                            </Text>
                        </Pressable>
                    )}
                </View>
            </>
        </FullScreenSheet>
    );
};

const styles = StyleSheet.create({
    title: { fontSize: 20, fontWeight: '600', color: palette.charcoal },
    body: { fontSize: 15, lineHeight: 22, color: palette.slate },
    error: { fontSize: 15, color: palette.error },
    scroll: { flex: 1 },
    scrollContent: { gap: 16 },
    fields: { gap: 6 },
    field: { flexDirection: 'row', gap: 8 },
    fieldLabel: { fontSize: 14, fontWeight: '600', color: palette.slate, minWidth: 96 },
    fieldValue: { fontSize: 14, color: palette.charcoal, flexShrink: 1 },
    sectionHeading: { fontSize: 16, fontWeight: '600', color: palette.charcoal },
    ingredients: { gap: 4 },
    ingredientRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
    calories: { fontSize: 14, color: palette.slate },
    changedNote: { fontSize: 13, fontStyle: 'italic', color: palette.slate },
    actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 'auto' },
    cancelButton: { borderRadius: 999, paddingVertical: 10, paddingHorizontal: 18 },
    cancelLabel: { color: palette.slate, fontWeight: '500', fontSize: 14 },
    restoreButton: { backgroundColor: palette.seafoam, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 22 },
    restoreLabel: { color: palette.white, fontWeight: '600', fontSize: 14 },
});
