/**
 * @module @commise/features-recipes — native Pull-Updates preview dialog (W5 Task 10, C2 / FR-011).
 *
 * The React Native leaf of `PullUpdatesDialog`: a
 * {@link FullScreenSheet} rendering the SAME controlled, presentational contract as the web leaf — same
 * state precedence, same localized copy, so the two platforms can't drift. `onRequestClose` (the Android
 * hardware-back / web-Escape path RN provides) is wired straight to `onCancel`, the same callback the
 * explicit Cancel control uses — one exit path, not two, mirroring the web leaf's `onOpenChange`→`onCancel`
 * wiring.
 *
 * The modal window and its safe-area padding belong to `FullScreenSheet`, not here. This leaf previously
 * hand-rolled `<Modal presentationStyle="fullScreen">` over a flat `padding: 20` surface, which on an
 * edge-to-edge Android device drew the heading UNDER the status bar — fully occluded, and therefore absent
 * from the accessibility hierarchy, which is how Maestro's `collections-pull` flow caught it — and put the
 * Cancel/Pull row UNDER the navigation bar's own tap targets.
 *
 * A discriminated three-way state (mutually exclusive, matching {@link PullUpdatesDialogProps}'s JSDoc):
 * (1) a `progressbar` affordance while `isLoadingPreview`, or before any `diff` has arrived; (2) an `alert`
 * for a failed preview/commit — `'drift'` (409, the previewed diff went stale) is deliberately NOT a dead
 * end: the counts are hidden (they're no longer trustworthy) but Cancel/back still close the dialog, so the
 * composing container (W5 Task 12) can re-run the preview; (3) the loaded `diff` — added/removed/unchanged
 * COUNTS only (this block never resolves recipe titles, it only received ids), the "not overwritten" note,
 * and the count-templated Pull action, disabled while `isCommitting` or when there is nothing to add.
 *
 * @pattern Composition over the shared `FullScreenSheet` Decorator, which owns the modal window and its safe-area
 *     padding — the same controlled `props → JSX` contract as the web leaf.
 */
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { FullScreenSheet } from '../components/FullScreenSheet.native.js';
import { fillTemplate } from '../list/model.js';
import { collectionMessages } from './messages.js';
import type { PullUpdatesDialogProps } from './model.js';

export const PullUpdatesDialog: FC<PullUpdatesDialogProps> = ({
    open,
    diff,
    isLoadingPreview,
    isCommitting,
    error,
    sourceOwnerHandle,
    sourceCollectionName,
    onCancel,
    onConfirm,
}) => {
    const { pull } = useMessages(collectionMessages);

    if (!open) {
        return null;
    }

    const attribution =
        sourceOwnerHandle !== undefined && sourceCollectionName !== undefined
            ? fillTemplate(pull.attribution, { handle: sourceOwnerHandle, name: sourceCollectionName })
            : sourceCollectionName !== undefined
              ? fillTemplate(pull.attributionNoHandle, { name: sourceCollectionName })
              : undefined;

    // Never trust an in-flight or stale diff: loading always wins, and no diff at all reads as "still
    // loading" rather than risking a misleading zero-count flash before the first preview resolves.
    const showLoading = isLoadingPreview || (diff === undefined && error === undefined);
    const showDiff = !showLoading && error === undefined && diff !== undefined;
    const canConfirm = diff !== undefined && diff.added.length > 0 && !isCommitting;

    return (
        <FullScreenSheet label={pull.title} onRequestClose={onCancel}>
            <>
                <View style={styles.header}>
                    <Text accessibilityRole="header" style={styles.title}>
                        {pull.title}
                    </Text>
                    {attribution !== undefined && <Text style={styles.attribution}>{attribution}</Text>}
                </View>

                {showLoading && (
                    <Text accessibilityRole="progressbar" accessibilityLabel={pull.loadingLabel} style={styles.body}>
                        {pull.loadingLabel}
                    </Text>
                )}

                {!showLoading && error !== undefined && (
                    <Text accessibilityRole="alert" style={styles.error}>
                        {error === 'drift' ? pull.driftMessage : pull.genericErrorMessage}
                    </Text>
                )}

                {showDiff && diff !== undefined && (
                    <View style={styles.counts}>
                        <Text style={styles.body}>{fillTemplate(pull.addedCount, { count: diff.added.length })}</Text>
                        <Text style={styles.body}>
                            {fillTemplate(pull.removedCount, { count: diff.removed.length })}
                        </Text>
                        <Text style={styles.body}>
                            {fillTemplate(pull.unchangedCount, { count: diff.unchanged.length })}
                        </Text>
                        <Text style={styles.note}>{pull.ownMembersNote}</Text>
                        {diff.added.length === 0 && <Text style={styles.body}>{pull.upToDate}</Text>}
                    </View>
                )}

                <View style={styles.actions}>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={pull.cancel}
                        onPress={onCancel}
                        style={styles.cancelButton}
                    >
                        <Text style={styles.cancelLabel}>{pull.cancel}</Text>
                    </Pressable>
                    {showDiff && diff !== undefined && (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={fillTemplate(pull.confirm, { count: diff.added.length })}
                            aria-busy={isCommitting || undefined}
                            disabled={!canConfirm}
                            onPress={onConfirm}
                            style={[styles.confirmButton, !canConfirm && styles.confirmButtonDisabled]}
                        >
                            <Text style={styles.confirmLabel}>
                                {fillTemplate(pull.confirm, { count: diff.added.length })}
                            </Text>
                        </Pressable>
                    )}
                </View>
            </>
        </FullScreenSheet>
    );
};

const styles = StyleSheet.create({
    header: { gap: 4 },
    title: { fontSize: 20, fontWeight: '600', color: palette.charcoal },
    attribution: { fontSize: 14, color: palette.slate },
    body: { fontSize: 15, lineHeight: 22, color: palette.slate },
    counts: { gap: 8 },
    note: { fontSize: 13, fontStyle: 'italic', color: palette.slate },
    error: { fontSize: 15, color: palette['error-dark'] },
    actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 'auto' },
    cancelButton: { borderRadius: 999, paddingVertical: 10, paddingHorizontal: 18 },
    cancelLabel: { color: palette.slate, fontWeight: '500', fontSize: 14 },
    confirmButton: { backgroundColor: palette.seafoam, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 22 },
    confirmButtonDisabled: { opacity: 0.6 },
    confirmLabel: { color: palette.white, fontWeight: '600', fontSize: 14 },
});
