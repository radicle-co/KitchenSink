'use client';

/**
 * @module @commise/features-cooking — the WEB {@link StepNavigation} render component (FR-033).
 *
 * Pattern: a pure **presentational leaf** (`props → JSX`) over the {@link stepNavigationModel} policy
 * module. It holds no step state, fetches nothing, mutates nothing and takes no refs — the current position
 * arrives as a prop and every intent leaves as a callback, exactly as plan.md §4 prescribes for the children
 * of `CookingModeScreen`.
 *
 * The design is driven by the use case: a cook with wet or occupied hands, looking at a propped-up phone.
 *  - **Big targets.** Each tap zone is ~40% of the width with a 48px (`min-h-12`) floor — well past WCAG
 *    2.5.5's 44px — so the forward/back gesture does not require aim.
 *  - **Boundaries are stated, not hidden.** On the first step the previous zone stays rendered and focusable
 *    but is marked `aria-disabled` and wired to NO handler, and an explanation (`atFirstStepLabel`) is
 *    announced and linked to it via `aria-describedby`. Removing a control at a boundary would silently
 *    reflow the whole row under the cook's thumb; announcing "unavailable" is honest and stable.
 *    `aria-disabled` (rather than the `disabled` attribute) is deliberate: the control keeps its place in
 *    the tab order and stays discoverable to a screen reader, which a `disabled` button does not.
 *  - **The last step is a different act.** The forward zone is REPLACED by the design-system {@link Button}
 *    finish affordance, which reports `onFinish` — a smaller, deliberate target, because ending a cooking
 *    session by fumbling a 40%-wide zone is a real failure (HAZ-006). `onNext` is unreachable there.
 *  - **Progress is never colour-only** (NFR-004). The dot row is decorative (`aria-hidden`) and the position
 *    is carried by a real `progressbar` (accessibly named with `stepPosition`) AND by visible text, so the
 *    same fact reaches sighted, low-vision and screen-reader users through three independent channels.
 *
 * A recipe with zero steps renders NOTHING here — that state belongs to the screen's empty surface
 * (`emptyTitle`/`emptyBody`), not to a navigation bar promising steps that do not exist.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { PressScale } from '@commise/ui/press-scale';
import { useId, type FC } from 'react';

import { cookingMessages } from './messages';
import {
    formatStepPosition,
    hasSteps,
    isAtFirstStep,
    isAtLastStep,
    stepDotStates,
    stepNumber,
    type StepDotState,
    type StepNavigationProps,
} from './stepNavigationModel';

/**
 * The tap-zone surface: ~40% of the row, a 48px minimum height (kitchen-grade target, above WCAG 2.5.5's
 * 44px), and a visible card so the zone reads as pressable rather than as empty space.
 */
const TAP_ZONE =
    'flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-mist bg-white ' +
    'px-4 py-3 text-body-md font-semibold text-charcoal aria-disabled:cursor-not-allowed aria-disabled:opacity-50';

/**
 * Per-state dot styling. The CURRENT dot differs in SIZE and ring as well as tone, so the row is still
 * readable without colour perception — and the row is redundant with the visible position text regardless.
 */
const DOT_TONE: Record<StepDotState, string> = {
    completed: 'h-2.5 w-2.5 bg-seafoam',
    current: 'h-3.5 w-3.5 bg-charcoal ring-2 ring-seafoam',
    upcoming: 'h-2.5 w-2.5 bg-mist',
};

/** Decorative directional chevron. Hidden from the accessibility tree — the label owns the name. */
const Chevron: FC<{ direction: 'left' | 'right' }> = ({ direction }) => (
    <svg aria-hidden="true" focusable="false" className="h-5 w-5 shrink-0" viewBox="0 0 20 20" fill="currentColor">
        <path
            d={
                direction === 'left'
                    ? 'M12.7 15.3a1 1 0 0 1-1.4 0L6 10l5.3-5.3a1 1 0 1 1 1.4 1.4L8.8 10l3.9 3.9a1 1 0 0 1 0 1.4z'
                    : 'M7.3 4.7a1 1 0 0 1 1.4 0L14 10l-5.3 5.3a1 1 0 0 1-1.4-1.4l3.9-3.9-3.9-3.9a1 1 0 0 1 0-1.4z'
            }
        />
    </svg>
);

/** Decorative check glyph for the finish affordance. The {@link Button} label owns the accessible name. */
const CheckGlyph: FC = () => (
    <svg aria-hidden="true" focusable="false" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
        <path d="M8.1 14.5 3.6 10l1.4-1.4 3.1 3.1 6.9-6.9L16.4 6z" />
    </svg>
);

/** Forward/backward traversal for Cooking Mode: two large tap zones, a progress row, and stated boundaries. */
export const StepNavigation: FC<StepNavigationProps> = ({ currentStep, totalSteps, onPrevious, onNext, onFinish }) => {
    const messages = useMessages(cookingMessages);
    const locale = useLocale();
    const firstHintId = useId();
    const lastHintId = useId();

    if (!hasSteps(totalSteps)) {
        return null;
    }

    const atFirst = isAtFirstStep(currentStep, totalSteps);
    const atLast = isAtLastStep(currentStep, totalSteps);
    const position = formatStepPosition(messages.stepPosition, currentStep, totalSteps, locale);
    const dots = stepDotStates(currentStep, totalSteps);

    return (
        <div className="flex w-full flex-col items-center gap-3">
            <div className="flex flex-col items-center gap-2">
                <div
                    role="progressbar"
                    aria-label={position}
                    aria-valuemin={1}
                    aria-valuemax={dots.length}
                    aria-valuenow={stepNumber(currentStep, totalSteps)}
                    aria-valuetext={position}
                    className="flex flex-wrap items-center justify-center gap-2"
                >
                    {dots.map((state, index) => (
                        <span key={index} aria-hidden="true" className={`rounded-full ${DOT_TONE[state]}`} />
                    ))}
                </div>
                {/* NFR-004 — the dots are never the sole conveyor of position; the same fact is stated in text. */}
                <p className="text-body-sm font-medium text-charcoal">{position}</p>
            </div>

            <div className="flex w-full items-stretch justify-between gap-3">
                {/* `grid` blockifies PressScale's inline-flex span so the zone fills its 40% column. */}
                <div className="grid w-2/5">
                    <PressScale>
                        <button
                            type="button"
                            aria-disabled={atFirst || undefined}
                            aria-describedby={atFirst ? firstHintId : undefined}
                            // No handler at the boundary: the no-op is STRUCTURAL, not a runtime `if` that a
                            // later edit can drop while the control still looks disabled.
                            onClick={atFirst ? undefined : onPrevious}
                            className={TAP_ZONE}
                        >
                            <Chevron direction="left" />
                            <span>{messages.previousLabel}</span>
                        </button>
                    </PressScale>
                </div>

                {atLast ? (
                    <div className="grid w-2/5 place-items-center" aria-describedby={lastHintId}>
                        <Button icon={<CheckGlyph />} onPress={onFinish}>
                            {messages.finishLabel}
                        </Button>
                    </div>
                ) : (
                    <div className="grid w-2/5">
                        <PressScale>
                            <button type="button" onClick={onNext} className={TAP_ZONE}>
                                <span>{messages.nextLabel}</span>
                                <Chevron direction="right" />
                            </button>
                        </PressScale>
                    </div>
                )}
            </div>

            {atFirst && (
                <p id={firstHintId} role="status" className="text-body-sm text-slate">
                    {messages.atFirstStepLabel}
                </p>
            )}
            {atLast && (
                <p id={lastHintId} role="status" className="text-body-sm text-slate">
                    {messages.atLastStepLabel}
                </p>
            )}
        </div>
    );
};
