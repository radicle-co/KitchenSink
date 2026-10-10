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
 * from the accessibility hierarchy, which is how Maestro's `collectionsPull` flow caught it — and put the
 * Cancel/Pull row UNDER the navigation bar's own tap targets.
 *
 * A discriminated three-way state (mutually exclusive, matching {@link PullUpdatesDialogProps}'s JSDoc):
 * (1) a `progressbar` affordance while `isLoadingPreview`, or before any `diff` has arrived; (2) an `alert`
 * for a failed preview/commit — `'drift'` (409, the previewed diff went stale) is deliberately NOT a dead
 * end: the counts are hidden (they're no longer trustworthy) but Cancel/back still close the dialog, so the
 * composing container (W5 Task 12) can re-run the preview; (3) the loaded `diff` — added/removed/unchanged
 * COUNTS only (this block never resolves recipe titles, it only received ids), the "not overwritten" note,
 * and the count-templated Pull action, busy while `isCommitting`, disabled when there is nothing to add.
 *
 * @pattern Composition over the shared `FullScreenSheet` Decorator, which owns the modal window and its safe-area
 *     padding — the same controlled `props → JSX` contract as the web leaf.
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { FullScreenSheet } from '@commise/ui/full-screen-sheet';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

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
    const { colors } = useTheme();
    const muted = { color: colors.inkMuted };

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

    return (
        <FullScreenSheet label={pull.title} onRequestClose={onCancel}>
            <>
                <View style={styles.header}>
                    <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>
                        {pull.title}
                    </Text>
                    {attribution !== undefined && <Text style={[styles.attribution, muted]}>{attribution}</Text>}
                </View>

                {showLoading && (
                    <Text
                        accessibilityRole="progressbar"
                        accessibilityLabel={pull.loadingLabel}
                        style={[styles.body, muted]}
                    >
                        {pull.loadingLabel}
                    </Text>
                )}

                {!showLoading && error !== undefined && (
                    <Text accessibilityRole="alert" style={[styles.error, { color: colors.dangerText }]}>
                        {error === 'drift' ? pull.driftMessage : pull.genericErrorMessage}
                    </Text>
                )}

                {showDiff && diff !== undefined && (
                    <View style={styles.counts}>
                        <Text style={[styles.body, muted]}>
                            {fillTemplate(pull.addedCount, { count: diff.added.length })}
                        </Text>
                        <Text style={[styles.body, muted]}>
                            {fillTemplate(pull.removedCount, { count: diff.removed.length })}
                        </Text>
                        <Text style={[styles.body, muted]}>
                            {fillTemplate(pull.unchangedCount, { count: diff.unchanged.length })}
                        </Text>
                        <Text style={[styles.note, muted]}>{pull.ownMembersNote}</Text>
                        {diff.added.length === 0 && <Text style={[styles.body, muted]}>{pull.upToDate}</Text>}
                    </View>
                )}

                <View style={styles.actions}>
                    <Button variant="secondary" icon="x" onPress={onCancel}>
                        {pull.cancel}
                    </Button>
                    {showDiff && diff !== undefined && (
                        <Button icon="check" busy={isCommitting} disabled={diff.added.length === 0} onPress={onConfirm}>
                            {fillTemplate(pull.confirm, { count: diff.added.length })}
                        </Button>
                    )}
                </View>
            </>
        </FullScreenSheet>
    );
};

const styles = StyleSheet.create({
    header: { gap: 4 },
    title: { fontSize: 20, fontWeight: '600' },
    attribution: { fontSize: 14 },
    body: { fontSize: 15, lineHeight: 22 },
    counts: { gap: 8 },
    note: { fontSize: 13, fontStyle: 'italic' },
    error: { fontSize: 15 },
    actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 'auto' },
});
