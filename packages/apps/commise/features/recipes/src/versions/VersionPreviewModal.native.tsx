/**
 * @module @commise/features-recipes — native version preview modal (W6 Task 3 / FR-007b).
 *
 * The React Native leaf of `VersionPreviewModal`: a
 * {@link FullScreenSheet} (the shared primitive that owns the modal window and its safe-area padding — this
 * leaf used to hand-roll both, and shipped `PullUpdatesDialog`'s system-bar occlusion bug along with them),
 * rendering the SAME controlled, presentational contract as the web leaf — same
 * state precedence, same localized copy, so the two platforms can't drift. `onRequestClose` (the Android
 * hardware-back / web-Escape path RN provides) is wired straight to `onCancel`, the same callback the
 * explicit "Keep current version" control uses — one exit path, not two.
 *
 * A discriminated three-way state (mutually exclusive, matching {@link VersionPreviewModalProps}'s JSDoc):
 * (1) a `progressbar` affordance while `isLoading`; (2) an `alert` for a failed lookup — either an explicit
 * `error` or, per B21, nothing pending and still no `version` — deliberately NOT a dead end, "Keep current
 * version" still closes the modal; (3) the loaded
 * `version` — the snapshot's title, description, servings, prep/cook/total time, and ingredient lines
 * (calorie chip only when the line carries a `userCalories` override), plus the "Changed from current"
 * summary when `diffFromCurrent` was supplied, and the Restore action.
 *
 * @pattern Composition over the shared `FullScreenSheet` Decorator, which owns the modal window and its safe-area
 *     padding, rendering the same controlled contract as the web leaf.
 */
import { useMessages } from '@commise/i18n/react';
import { nativeTokens } from '@commise/ui/native';
import { VariantPartsLine } from '@commise/ui/variant-parts-line';
import { Button } from '@commise/ui/button';
import { FullScreenSheet } from '@commise/ui/full-screen-sheet';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { formatDurationMinutes } from '../list/model.js';
import { recipeMessages } from '../messages.js';
import { recipeVersionMessages } from './messages.js';
import { fillTemplate } from '../format/fillTemplate.js';
import { previewRestoreErrorMessage, unrestorablePositionsFor } from './history.js';
import {
    type VersionPreviewModalProps,
    formatChangedFromCurrent,
    toVersionPreviewIngredientLines,
    toVersionPreviewSteps,
} from './preview.js';

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
    restoreError,
}) => {
    const { preview, conflict, versionList } = useMessages(recipeVersionMessages);
    const { ingredientLineName } = useMessages(recipeMessages);
    const { colors } = useTheme();
    const ink = { color: colors.ink };
    const muted = { color: colors.inkMuted };
    const danger = { color: colors.dangerText };

    if (!open) {
        return null;
    }

    // Loading always wins — a fetch that is genuinely in flight must not read as broken on first paint. Once
    // NOTHING is pending, though, having no version to show IS a failure (B21): this used to read "still
    // loading" whenever `version` was absent, so a caller that had settled with nothing — the shape a preview
    // target missing from the loaded history produces — was stranded on a spinner the modal had no state to
    // escape into. `error` is now one of TWO ways to reach the failure affordance, not the only one.
    const showLoading = isLoading;
    const showError = !showLoading && (error === true || version === undefined);
    const showContent = !showLoading && !showError && version !== undefined;
    const restoreErrorText =
        version === undefined
            ? undefined
            : previewRestoreErrorMessage(restoreError, version.versionNumber, versionList, preview);

    const title =
        version !== undefined
            ? fillTemplate(preview.title, { version: version.versionNumber, title: version.snapshot.title })
            : preview.titleLoading;

    return (
        <FullScreenSheet label={title} onRequestClose={onCancel}>
            <>
                <Text accessibilityRole="header" style={[styles.title, ink]}>
                    {title}
                </Text>

                {showLoading && (
                    <Text
                        accessibilityRole="progressbar"
                        accessibilityLabel={preview.loading}
                        style={[styles.body, muted]}
                    >
                        {preview.loading}
                    </Text>
                )}

                {showError && (
                    <Text accessibilityRole="alert" style={[styles.error, danger]}>
                        {preview.error}
                    </Text>
                )}

                {/* A failed restore of THIS version, shown where the cook pressed Restore (the web leaf's §5 note). */}
                {restoreErrorText !== undefined && (
                    <Text accessibilityRole="alert" style={[styles.error, danger]}>
                        {restoreErrorText}
                    </Text>
                )}

                {/* Above the scroller, not last inside it: a recipe with a real ingredient list and steps is taller than
                    the screen, and the line is what the cook came to read (Android Maestro run, `recipes/versions`). */}
                {showContent && diffFromCurrent !== undefined && (
                    <Text style={[styles.changedNote, muted]}>
                        {formatChangedFromCurrent(diffFromCurrent, preview, conflict, locale)}
                    </Text>
                )}

                {showContent && version !== undefined && (
                    <ScrollView
                        keyboardShouldPersistTaps="handled"
                        style={styles.scroll}
                        contentContainerStyle={styles.scrollContent}
                    >
                        <View style={styles.fields}>
                            <View style={styles.field}>
                                <Text style={[styles.fieldLabel, muted]}>{conflict.titleLabel}</Text>
                                <Text style={[styles.fieldValue, ink]}>{version.snapshot.title}</Text>
                            </View>
                            <View style={styles.field}>
                                <Text style={[styles.fieldLabel, muted]}>{conflict.descriptionLabel}</Text>
                                <Text style={[styles.fieldValue, ink]}>{version.snapshot.description}</Text>
                            </View>
                            <View style={styles.field}>
                                <Text style={[styles.fieldLabel, muted]}>{conflict.servingsLabel}</Text>
                                <Text style={[styles.fieldValue, ink]}>{version.snapshot.servings}</Text>
                            </View>
                            <View style={styles.field}>
                                <Text style={[styles.fieldLabel, muted]}>{conflict.prepLabel}</Text>
                                <Text style={[styles.fieldValue, ink]}>
                                    {formatDurationMinutes(version.snapshot.prepTimeMinutes, conflict.minutes)}
                                </Text>
                            </View>
                            <View style={styles.field}>
                                <Text style={[styles.fieldLabel, muted]}>{conflict.cookLabel}</Text>
                                <Text style={[styles.fieldValue, ink]}>
                                    {formatDurationMinutes(version.snapshot.cookTimeMinutes, conflict.minutes)}
                                </Text>
                            </View>
                            <View style={styles.field}>
                                <Text style={[styles.fieldLabel, muted]}>{conflict.totalLabel}</Text>
                                <Text style={[styles.fieldValue, ink]}>
                                    {formatDurationMinutes(
                                        version.snapshot.prepTimeMinutes + version.snapshot.cookTimeMinutes,
                                        conflict.minutes,
                                    )}
                                </Text>
                            </View>
                        </View>

                        <Text accessibilityRole="header" style={[styles.sectionHeading, ink]}>
                            {fillTemplate(preview.ingredientsHeading, { version: version.versionNumber })}
                        </Text>
                        <View style={styles.ingredients}>
                            {toVersionPreviewIngredientLines(
                                version.snapshot.ingredients,
                                preview,
                                locale,
                                ingredientLineName,
                                unrestorablePositionsFor(restoreError, version.versionNumber),
                            ).map((line) => (
                                <View key={line.key} style={styles.ingredientRow}>
                                    <View style={styles.ingredientLine}>
                                        <Text style={[styles.body, muted, styles.ingredientText]}>
                                            {line.text}
                                            {/* Words, never colour alone: the refused restore named this line. On a
                                                line with no details it is read with the line. */}
                                            {line.cannotRestore !== undefined && line.variantParts === undefined && (
                                                <Text style={[styles.cannotRestore, danger]}>
                                                    {' '}
                                                    {line.cannotRestore}
                                                </Text>
                                            )}
                                        </Text>
                                        {/* Curated U15 (§S1): a variant-bound line's dotted line, under it. */}
                                        {line.variantParts !== undefined && (
                                            <VariantPartsLine parts={line.variantParts} tone="secondary" />
                                        )}
                                        {/* With details, the marker ends the line after them: it is about the whole
                                            line (the web leaf's order). */}
                                        {line.cannotRestore !== undefined && line.variantParts !== undefined && (
                                            <Text style={[styles.body, styles.cannotRestore, danger]}>
                                                {line.cannotRestore}
                                            </Text>
                                        )}
                                    </View>
                                    {line.calories !== undefined && (
                                        <Text style={[styles.calories, muted]}>{line.calories}</Text>
                                    )}
                                </View>
                            ))}
                        </View>

                        {version.snapshot.steps.length > 0 && (
                            <>
                                <Text accessibilityRole="header" style={[styles.sectionHeading, ink]}>
                                    {fillTemplate(preview.stepsHeading, { version: version.versionNumber })}
                                </Text>
                                <View style={styles.ingredients}>
                                    {toVersionPreviewSteps(version.snapshot.steps).map((step) => (
                                        <View key={step.key} style={styles.stepRow}>
                                            <Text style={[styles.body, muted]}>{step.marker}</Text>
                                            <Text style={[styles.body, ink, styles.stepText]}>{step.text}</Text>
                                        </View>
                                    ))}
                                </View>
                            </>
                        )}
                    </ScrollView>
                )}

                <View style={styles.actions}>
                    <Button variant="secondary" icon="x" onPress={onCancel}>
                        {preview.keepCurrent}
                    </Button>
                    {showContent && version !== undefined && (
                        <Button icon="rotateCcw" busy={isRestoring} onPress={() => onRestore(version.versionNumber)}>
                            {isRestoring ? preview.restoringThis : preview.restoreThis}
                        </Button>
                    )}
                </View>
            </>
        </FullScreenSheet>
    );
};

const styles = StyleSheet.create({
    title: { ...nativeTokens.type.sectionTitle },
    body: { ...nativeTokens.type.body },
    error: { ...nativeTokens.type.body },
    cannotRestore: { fontWeight: '600' },
    scroll: { flex: 1 },
    scrollContent: { gap: 16 },
    fields: { gap: 6 },
    field: { flexDirection: 'row', gap: 8 },
    fieldLabel: { ...nativeTokens.type.label, minWidth: 96 },
    fieldValue: { ...nativeTokens.type.meta, flexShrink: 1 },
    sectionHeading: { ...nativeTokens.type.cardTitle },
    ingredients: { gap: 4 },
    ingredientRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
    // RN defaults `flexShrink` to 0, so a long composed line (quantity + unit + a user-supplied ingredient
    // name) used to push the calorie chip past the sheet edge. `flexShrink` is applied HERE rather than on the
    // shared `body` style, which is also used outside this row. Mirrors `fieldValue` above.
    ingredientText: { flexShrink: 1 },
    stepRow: { flexDirection: 'row', gap: 8 },
    stepText: { flexShrink: 1 },
    // The line and its dotted line stack, 4 dp apart (§S4a), and yield width to the calorie chip together.
    ingredientLine: { flexShrink: 1, gap: 4 },
    calories: { ...nativeTokens.type.meta, flexShrink: 0 },
    changedNote: { ...nativeTokens.type.meta, fontStyle: 'italic' },
    // WRAPS: two icon-and-label buttons are wider than a 360 dp phone's content box, and a row that cannot wrap
    // overflows on its START side when pushed to the end, slicing the first button at the left edge. Each button keeps
    // its own width and full label; the second takes the next line before either is squeezed.
    actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 12, marginTop: 'auto' },
});
