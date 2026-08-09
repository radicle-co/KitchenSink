/**
 * @module @commise/features-cooking/CookingModeScreen — the NATIVE Cooking Mode surface (FR-032,
 * FR-032a, FR-033, FR-034, FR-034a, FR-035).
 *
 * The React Native counterpart of the web screen: the SAME orchestration (`useCookingSession`), the same
 * prop contract, the same copy, and the same surface-selection rule — only the host elements and the
 * injected wake-lock adapter differ. Keeping the orchestration in the shared hook is what stops the two
 * platforms drifting on session behaviour; a fix here that missed web (or the reverse) would have to be
 * a fix to a leaf, not to the session.
 *
 * **Pattern register.** As on web, this is the single orchestrational component (plan.md §4): it owns the
 * session, the timers and the wake lock, SELECTS the step surface through a total `switch` over the
 * hook's {@link CookingStepSurface} union, and composes pure `props → JSX` leaves. Relative imports below
 * are extensionless on purpose — Metro (and the native Vitest config's resolver) prefer the `.native`
 * sibling — except `./wakeLock.native`, which is named explicitly because there is no such export on the
 * web adapter and the platform adapter must be the Expo one here.
 *
 * The screen performs NO recipe write of any kind (REQ-CN-001).
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { palette } from '@commise/ui/colors';
import { nativeTokens } from '@commise/ui/native';
import type { RecipeStepView } from '@kitchensink/recipe-core';
import { useState, type FC, type ReactElement } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { ActiveTimers } from './ActiveTimers';
import { IngredientChecklist } from './IngredientChecklist';
import { ScaleSelector } from './ScaleSelector';
import { StepDisplay, StepDisplayEmpty, StepDisplayError, StepDisplayLoading } from './StepDisplay';
import { StepNavigation } from './StepNavigation';
import { TimerAlert } from './TimerAlert';
import { TimerBadge } from './TimerBadge';
import { VoiceControlToggle } from './VoiceControlToggle';
import { cookingMessages } from './messages';
import { formatStepPosition } from './stepPosition';
import { useCookingSession, type CookingModeScreenProps, type CookingStepSurface } from './useCookingSession';
import { startNativeVoiceControl } from './voiceControl.native';
import { formatStepAnnouncement } from './voiceControlModel';
import { acquireNativeWakeLock } from './wakeLock.native';

/** Decorative exit glyph. Hidden from assistive tech — the Button's label owns the accessible name. */
const ExitGlyph: FC = () => (
    <Text aria-hidden style={styles.glyph}>
        ←
    </Text>
);

/** Decorative basket glyph for the ingredients affordance. Hidden from assistive tech. */
const BasketGlyph: FC = () => (
    <Text aria-hidden style={styles.glyph}>
        ☰
    </Text>
);

/**
 * The Cooking Mode screen: one step at a time, its timers, its ingredients, the yield control, and the
 * opt-in voice control.
 *
 * `wakeLock` and `voiceControl` default to the Expo adapters — the ONE place the native platform bindings
 * are made, so the hook below stays platform-free. Both are named with an explicit `.native` specifier
 * because the platform adapter must be the Expo one here.
 */
export const CookingModeScreen: FC<CookingModeScreenProps> = ({
    recipeId,
    recipe,
    sessionStore,
    onRetry,
    onExit,
    onFinish,
    wakeLock = acquireNativeWakeLock,
    voiceControl = startNativeVoiceControl,
}) => {
    const messages = useMessages(cookingMessages);
    const locale = useLocale();
    // View state, not session state: never persisted, never resumed.
    const [isIngredientsOpen, setIsIngredientsOpen] = useState(false);
    const session = useCookingSession({
        recipeId,
        recipe,
        store: sessionStore,
        wakeLock,
        voiceControl,
        onExit,
        onFinish,
    });

    /**
     * The sentence the `repeat` voice command speaks: the localized position, then the instruction.
     *
     * @param step - The step currently on screen.
     * @param stepCount - How many steps the recipe has.
     * @returns The announcement text.
     */
    const repeatAnnouncement = (step: RecipeStepView, stepCount: number): string =>
        formatStepAnnouncement(
            messages.voiceRepeatAnnouncement,
            formatStepPosition(messages.stepPosition, { current: step.stepNumber, total: stepCount }, locale),
            step.instruction,
        );

    /**
     * Chooses the step surface. A total switch over the union — adding a surface makes this fail to
     * compile rather than silently rendering nothing.
     *
     * @param surface - The surface the session hook derived.
     * @returns The leaf that renders it.
     */
    const renderStepSurface = (surface: CookingStepSurface): ReactElement => {
        switch (surface.kind) {
            case 'loading':
                return <StepDisplayLoading />;
            case 'error':
                return <StepDisplayError onRetry={onRetry} />;
            case 'empty':
                return <StepDisplayEmpty />;
            case 'step':
                return <StepDisplay step={surface.step} stepCount={surface.stepCount} />;
        }
    };

    const { surface } = session;

    return (
        <View accessibilityLabel={messages.modeLabel} style={styles.screen}>
            <View style={styles.header}>
                <Button variant="secondary" icon={<ExitGlyph />} onPress={session.exit}>
                    {messages.exitLabel}
                </Button>
                {surface.kind === 'step' && (
                    <View style={styles.headerActions}>
                        {/* The press IS the microphone consent — nothing here listens until it happens. */}
                        <VoiceControlToggle state={session.voiceState} onToggle={session.toggleVoice} />
                        <Button
                            variant="secondary"
                            icon={<BasketGlyph />}
                            onPress={() => setIsIngredientsOpen((open) => !open)}
                        >
                            {messages.ingredientsLabel}
                        </Button>
                    </View>
                )}
            </View>

            {/* Above the step on purpose: a finished timer must interrupt, not wait to be scrolled to. */}
            <TimerAlert completedTimer={session.completedTimer} onDismiss={session.dismissTimerAlert} />

            <ScrollView contentContainerStyle={styles.body}>
                {renderStepSurface(surface)}

                {surface.kind === 'step' && (
                    <View style={styles.body}>
                        {/* Where the `repeat` command speaks (US-006). The region is MOUNTED for the whole
                            step so the screen reader is already observing it, and the sentence is keyed by
                            the request count so asking twice for the SAME step still announces. Clipped
                            rather than hidden: `display: none` would remove it from the accessibility tree,
                            and repeating the instruction visibly would just duplicate the step. */}
                        <View role="status" aria-live="assertive" aria-atomic style={styles.announcement}>
                            {session.repeatAnnouncementId > 0 && (
                                <Text key={session.repeatAnnouncementId}>
                                    {repeatAnnouncement(surface.step, surface.stepCount)}
                                </Text>
                            )}
                        </View>
                        <TimerBadge step={surface.step} onStart={session.startStepTimer} />
                        <StepNavigation
                            currentStep={surface.stepIndex}
                            totalSteps={surface.stepCount}
                            onPrevious={session.goToPreviousStep}
                            onNext={session.goToNextStep}
                            onFinish={session.finish}
                        />
                        <ActiveTimers
                            timers={session.activeTimers}
                            onPause={session.pauseStepTimer}
                            onResume={session.resumeStepTimer}
                            onCancel={session.cancelStepTimer}
                        />
                        <ScaleSelector scaleFactor={session.scaleFactor} onScaleChange={session.changeScaleFactor} />
                        <IngredientChecklist
                            ingredients={recipe.status === 'ready' ? recipe.ingredients : []}
                            checkedIngredientIds={session.checkedIngredientIds}
                            scaleFactor={session.scaleFactor}
                            isOpen={isIngredientsOpen}
                            onToggleIngredient={session.toggleIngredient}
                            onDismiss={() => setIsIngredientsOpen(false)}
                        />
                    </View>
                )}
            </ScrollView>
        </View>
    );
};

const styles = StyleSheet.create({
    screen: { flex: 1, gap: nativeTokens.spacing[3] },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: nativeTokens.spacing[3],
        paddingHorizontal: nativeTokens.spacing[4],
        paddingTop: nativeTokens.spacing[4],
    },
    headerActions: { flexDirection: 'row', alignItems: 'flex-start', gap: nativeTokens.spacing[3] },
    body: { gap: nativeTokens.spacing[4], paddingHorizontal: nativeTokens.spacing[4] },
    // Clipped to a point: still in the accessibility tree (so the live region works), invisible on screen.
    announcement: { position: 'absolute', width: 1, height: 1, overflow: 'hidden' },
    glyph: { fontSize: nativeTokens.fontSize.bodyLg, color: palette.coral },
});
