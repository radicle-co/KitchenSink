'use client';

/**
 * @module @commise/features-cooking/CookingModeScreen — the WEB Cooking Mode surface (FR-032, FR-032a,
 * FR-033, FR-034, FR-034a, FR-035).
 *
 * **Pattern register.** This is the single ORCHESTRATIONAL component of feature 008 (plan.md §4). It owns
 * `useCookingSession` — and through it the session statechart, the timers and the screen wake lock — and
 * composes the pure leaves, which stay `props → JSX` with no fetching, no mutation and no refs. Two
 * consequences are structural rather than merely conventional:
 *
 *  - **The screen SELECTS the step surface**; it never passes a mode into one component. Loading, empty,
 *    error and populated are four separate leaves, chosen by a total `switch` over the hook's
 *    {@link CookingStepSurface} union (a discriminated union + exhaustive switch IS the Visitor pattern —
 *    no dispatch table is added on top of it).
 *  - **The platform adapter is injected at this boundary, not imported by the hook.** This module supplies
 *    the browser wake lock; `CookingModeScreen.native.tsx` supplies the Expo one; a test supplies a fake.
 *    The `wakeLock` prop is what makes all three the same code path.
 *
 * The screen performs NO recipe write of any kind (REQ-CN-001): it is handed the recipe as data and holds
 * no writer, so there is nothing here that could mutate it. All copy comes from `cookingMessages`.
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { useState, type FC, type ReactElement } from 'react';

import { ActiveTimers } from './ActiveTimers';
import { IngredientChecklist } from './IngredientChecklist';
import { ScaleSelector } from './ScaleSelector';
import { StepDisplay, StepDisplayEmpty, StepDisplayError, StepDisplayLoading } from './StepDisplay';
import { StepNavigation } from './StepNavigation';
import { TimerAlert } from './TimerAlert';
import { TimerBadge } from './TimerBadge';
import { cookingMessages } from './messages';
import { useCookingSession, type CookingModeScreenProps, type CookingStepSurface } from './useCookingSession';
import { acquireWebWakeLock } from './wakeLock';

/** Decorative exit glyph. `aria-hidden`, so the control's accessible name stays the localized label. */
const ExitGlyph: FC = () => (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" aria-hidden="true" focusable="false">
        <path
            d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
        />
        <path
            d="M10 8 6 12l4 4M6 12h9"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        />
    </svg>
);

/** Decorative basket glyph for the ingredients affordance. Hidden from assistive tech. */
const BasketGlyph: FC = () => (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" aria-hidden="true" focusable="false">
        <path d="M4 9h16l-1.5 10.5H5.5L4 9Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        <path d="m8.5 9 2-5m5 5-2-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
);

/**
 * The Cooking Mode screen: one step at a time, its timers, its ingredients, and the yield control.
 *
 * `wakeLock` defaults to the browser Screen Wake Lock adapter — the ONE place the web platform binding
 * is made, so the hook below it stays platform-free.
 */
export const CookingModeScreen: FC<CookingModeScreenProps> = ({
    recipeId,
    recipe,
    sessionStore,
    onRetry,
    onExit,
    onFinish,
    wakeLock = acquireWebWakeLock,
}) => {
    const messages = useMessages(cookingMessages);
    // Panel visibility is view state, not session state: it is never persisted and never resumed, so it
    // stays here rather than widening the session the hook has to keep JSON-round-trippable.
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
        <section aria-label={messages.modeLabel} className="flex w-full flex-col gap-4 px-4 py-4">
            <header className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3">
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
            </header>

            {/* Above the step on purpose: a finished timer must interrupt, not wait to be scrolled to. */}
            <div className="mx-auto w-full max-w-3xl">
                <TimerAlert completedTimer={session.completedTimer} onDismiss={session.dismissTimerAlert} />
            </div>

            {renderStepSurface(surface)}

            {surface.kind === 'step' && (
                <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
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
                </div>
            )}
        </section>
    );
};
