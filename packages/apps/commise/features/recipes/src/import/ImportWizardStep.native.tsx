/**
 * @module @commise/features-recipes/import — `ImportWizardStep` (native): the React Native leaf of
 * `./ImportWizardStep.tsx`, on the same props and words (`wizardCopy.ts`). A frame of its own: Save and leave, the
 * recipe heading, the progress and the lines scroll; Back, Skip and Next recipe sit in a bar OUTSIDE the scroll region,
 * at the bottom, within thumb reach. At the wide container class (1194) the recipe rail stands beside the step.
 *
 * At large text or on a short screen the bar would take the frame: past half of it the bar becomes the scroll region's
 * last item instead (`usePinnedFooter`, `docs/design/compactHeightLayout.md` §3.1), the house rule the Sheet and the
 * recipe wizard share.
 *
 * When a pick leaves nothing open, the host asks Next recipe to take focus (`nextFocus`), so focus is never dropped to
 * the top of the page (staff-ux 2026-10-25).
 *
 * Presentational: the host decides what each action does.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { useContainerClass, usePinnedFooter } from '@commise/ui/layout';
import { nativeTokens } from '@commise/ui/native';
import { ProgressBar } from '@commise/ui/progress-bar';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { fillTemplate } from '../format/fillTemplate.js';
import { importMessages } from './messages.js';
import type { ImportWizardStepProps } from './props.js';
import { backTargetOf, progressTextOf } from './wizardCopy.js';

/** The rail's width beside the step at the wide class, dp. */
const RAIL_WIDTH = 256;

/** One step of the import review. */
export const ImportWizardStep: FC<ImportWizardStepProps> = ({
    recipeTitle,
    position,
    total,
    openLines,
    checkingLines,
    children,
    rail,
    onBack,
    onSkip,
    onNext,
    onSaveAndLeave,
    nextFocus,
}) => {
    const { wizard: w } = useMessages(importMessages);
    const locale = useLocale();
    const { colors } = useTheme();
    const wide = useContainerClass() === 'wide';
    const pinning = usePinnedFooter();
    const backTo = backTargetOf(position);

    const bar = (
        <View
            collapsable={false}
            role="group"
            aria-label={w.actionsLabel}
            onLayout={pinning.onFooterLayout}
            style={[styles.bar, { borderTopColor: colors.lineDivider, backgroundColor: colors.paper }]}
        >
            {backTo === undefined ? null : (
                <Button
                    variant="secondary"
                    icon="chevronLeft"
                    accessibilityLabel={fillTemplate(w.backName, { n: backTo })}
                    onPress={onBack}
                >
                    {w.back}
                </Button>
            )}
            <Button variant="ghost" onPress={onSkip}>
                {w.skip}
            </Button>
            <View style={styles.grow} />
            <Button
                icon="chevronRight"
                iconPlacement="end"
                focusRequested={nextFocus.requested}
                onFocusRequestHandled={nextFocus.onHandled}
                onPress={onNext}
            >
                {w.next}
            </Button>
        </View>
    );

    return (
        <View style={styles.frame} onLayout={pinning.onFrameLayout}>
            <View style={styles.body}>
                {wide && rail !== undefined ? <View style={styles.rail}>{rail}</View> : null}
                <ScrollView
                    style={styles.grow}
                    contentContainerStyle={styles.content}
                    keyboardShouldPersistTaps="handled"
                >
                    <View style={styles.saveLeave}>
                        <Button variant="ghost" size="sm" onPress={onSaveAndLeave}>
                            {w.saveLeave}
                        </Button>
                    </View>
                    <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>
                        {recipeTitle}
                    </Text>
                    <View style={styles.progress}>
                        <Text style={[styles.meta, { color: colors.inkMuted }]}>
                            {progressTextOf({ position, total, openLines, checkingLines }, w, locale)}
                        </Text>
                        <ProgressBar label={w.progressLabel} value={position} max={total} />
                    </View>
                    {children}
                    {pinning.unpinned ? bar : null}
                </ScrollView>
            </View>
            {pinning.unpinned ? null : bar}
        </View>
    );
};

const styles = StyleSheet.create({
    frame: { flex: 1 },
    body: { flex: 1, flexDirection: 'row', gap: nativeTokens.spacing[6] },
    rail: { width: RAIL_WIDTH },
    grow: { flex: 1 },
    content: { gap: nativeTokens.spacing[4], paddingBottom: nativeTokens.spacing[4] },
    saveLeave: { flexDirection: 'row', justifyContent: 'flex-end' },
    title: nativeTokens.type.largeTitle.narrow,
    progress: { gap: nativeTokens.spacing[2] },
    meta: nativeTokens.type.meta,
    bar: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: nativeTokens.spacing[3],
        paddingVertical: nativeTokens.spacing[3],
        borderTopWidth: StyleSheet.hairlineWidth,
    },
});
