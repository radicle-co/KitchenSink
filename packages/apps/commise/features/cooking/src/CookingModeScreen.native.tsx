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
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { palette } from '@commise/ui/colors';
import { nativeTokens } from '@commise/ui/native';
import { useState, type FC, type ReactElement } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { ActiveTimers } from './ActiveTimers';
import { IngredientChecklist } from './IngredientChecklist';
import { ScaleSelector } from './ScaleSelector';
import { StepDisplay, StepDisplayEmpty, StepDisplayError, StepDisplayLoading } from './StepDisplay';
import { StepNavigation } from './StepNavigation';
import { TimerAlert } from './TimerAlert';
import { TimerBadge } from './TimerBadge';
import { cookingMessages } from './messages';
import { useCookingSession, type CookingModeScreenProps, type CookingStepSurface } from './useCookingSession';
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
 * The Cooking Mode screen: one step at a time, its timers, its ingredients, and the yield control.
 *
 * `wakeLock` defaults to the Expo keep-awake adapter — the ONE place the native platform binding is
 * made, so the hook below it stays platform-free.
 */
export const CookingModeScreen: FC<CookingModeScreenProps> = ({
    recipeId,
    recipe,
    sessionStore,
    onRetry,
    onExit,
    onFinish,
    wakeLock = acquireNativeWakeLock,
}) => {
    const messages = useMessages(cookingMessages);
    // View state, not session state: never persisted, never resumed.
    const [isIngredientsOpen, setIsIngredientsOpen] = useState(false);
    const session = useCookingSession({ recipeId, recipe, store: sessionStore, wakeLock, onExit, onFinish });

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
                    <Button
                        variant="secondary"
                        icon={<BasketGlyph />}
                        onPress={() => setIsIngredientsOpen((open) => !open)}
                    >
                        {messages.ingredientsLabel}
                    </Button>
                )}
            </View>

            {/* Above the step on purpose: a finished timer must interrupt, not wait to be scrolled to. */}
            <TimerAlert completedTimer={session.completedTimer} onDismiss={session.dismissTimerAlert} />

            <ScrollView contentContainerStyle={styles.body}>
                {renderStepSurface(surface)}

                {surface.kind === 'step' && (
                    <View style={styles.body}>
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
    body: { gap: nativeTokens.spacing[4], paddingHorizontal: nativeTokens.spacing[4] },
    glyph: { fontSize: nativeTokens.fontSize.bodyLg, color: palette.coral },
});
