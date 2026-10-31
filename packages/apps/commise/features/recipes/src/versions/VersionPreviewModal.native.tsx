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
 * The order, top to bottom, is the web leaf's: the title; the load state or load error, then the restore error; the
 * "Changed from current" line, pinned above the scroller; the recipe body, the ONLY part that scrolls; the two actions,
 * pinned under it through the design-system `DialogActions`, which stacks them full width on a phone.
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
import { DialogActions } from '@commise/ui/dialog-actions';
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

/**
 * The width of the action row from which Keep and Restore sit side by side: the longest label pair in the product
 * ("Keep current version", "Restore this version") at +35% for a translation, measured at about 578 px (see
 * `DialogActionsSideBySideFrom`). Every phone stacks them; a tablet sheet sits in a row. Two icon-and-label buttons are
 * wider than a 360 dp phone's content box, and a row that cannot wrap overflows on its START side, so stacking is the
 * re-layout, not a wrap.
 */
const SIDE_BY_SIDE_FROM = 600;

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

                {/* Pinned under the scroller (`marginTop: 'auto'` keeps them at the foot when there is none, in the
                    loading and error states). `DialogActions` STACKS them full width on a phone, Restore on top, and
                    sets them in one row from 600 dp. */}
                <View style={styles.actions}>
                    <DialogActions sideBySideFrom={SIDE_BY_SIDE_FROM}>
                        <Button variant="secondary" icon="x" width="fill" onPress={onCancel}>
                            {preview.keepCurrent}
                        </Button>
                        {showContent && version !== undefined && (
                            <Button
                                icon="rotateCcw"
                                busy={isRestoring}
                                width="fill"
                                onPress={() => onRestore(version.versionNumber)}
                            >
                                {isRestoring ? preview.restoringThis : preview.restoreThis}
                            </Button>
                        )}
                    </DialogActions>
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
    actions: { marginTop: 'auto' },
});
