/**
 * @module @commise/features-cooking/stepNavigationModel — the platform-neutral CONTRACT and the pure
 * decision logic behind {@link StepNavigation} (FR-033).
 *
 * Pattern: **Policy module** (a.k.a. pure decision core) paired with the two render leaves. Every rule the
 * navigation surface enforces — where the boundaries are, what each progress dot means, what a swipe
 * displacement means — lives here as a pure function, so the rule has ONE authoritative representation the
 * web (`StepNavigation.tsx`) and native (`StepNavigation.native.tsx`) leaves both consume. Neither leaf may
 * re-derive a boundary inline; that is exactly how two platforms drift on which step is "last".
 *
 * The step index is OWNED by the orchestrator (`CookingModeScreen` + `useCookingSession`); nothing here and
 * nothing in either leaf holds step state. These functions are total and defensive on purpose: they are fed
 * a number that crossed a component boundary, and a cook reading "Step 0 of 5" — or a `NaN` — on a phone
 * propped against a mixing bowl is a worse failure than silently clamping to a representable position.
 */

import type { Locale } from '@commise/i18n';

import { formatStepPosition as formatPosition } from './stepPosition';

/** The visual/semantic state of a single progress dot. */
export type StepDotState = 'completed' | 'current' | 'upcoming';

/** What a released swipe gesture means once thresholded. `none` = below threshold, or not horizontal. */
export type SwipeIntent = 'next' | 'previous' | 'none';

/**
 * Minimum horizontal displacement (px) before a drag counts as a navigation swipe. The threshold is
 * EXCLUSIVE (`|dx|` must exceed it) and exists to mitigate HAZ-006 — a wet or incidental touch skipping a
 * step the cook never read.
 */
export const SWIPE_THRESHOLD_PX = 50;

/**
 * The props both {@link StepNavigation} leaves accept.
 *
 * Purely CONTROLLED: the current position arrives as a prop and every intent leaves as a callback, so the
 * component owns no step state (plan.md §4 — `<StepNavigation>` is a pure `props → JSX` leaf).
 *
 * `onFinish` is deliberately SEPARATE from `onNext`: on the last step the forward control is replaced by a
 * finish affordance, and "end the cooking session" is a different intent from "advance a step". Folding it
 * into `onNext` would make the orchestrator infer intent from an index it already handed down — the kind of
 * implicit contract that breaks silently the first time the step list changes length.
 */
export interface StepNavigationProps {
    /** Zero-based index of the step currently shown. Clamped for display; never written back. */
    readonly currentStep: number;
    /** Total number of steps in the recipe. `< 1` means there is nothing to navigate. */
    readonly totalSteps: number;
    /** Requests the previous step. Never invoked on the first step. */
    readonly onPrevious: () => void;
    /** Requests the next step. Never invoked on the last step (the finish affordance stands there instead). */
    readonly onNext: () => void;
    /** Ends the cooking session from the last step's finish affordance. */
    readonly onFinish: () => void;
}

/** The step count as a whole, non-negative number — the only form the rest of this module reasons about. */
function normalizedTotal(totalSteps: number): number {
    return Number.isFinite(totalSteps) ? Math.max(0, Math.trunc(totalSteps)) : 0;
}

/** The current index clamped into `[0, total - 1]`, or `0` when there are no steps. */
function normalizedIndex(currentStep: number, total: number): number {
    if (!Number.isFinite(currentStep)) {
        return 0;
    }

    return Math.min(Math.max(0, Math.trunc(currentStep)), Math.max(0, total - 1));
}

/**
 * Whether there is anything to navigate at all. A recipe with no steps gets the screen's empty state
 * (FR-032 `emptyTitle`/`emptyBody`), not a navigation bar promising steps that do not exist.
 */
export function hasSteps(totalSteps: number): boolean {
    return normalizedTotal(totalSteps) > 0;
}

/** Whether the viewer is on the FIRST step, where the previous control must not act. */
export function isAtFirstStep(currentStep: number, totalSteps: number): boolean {
    return normalizedIndex(currentStep, normalizedTotal(totalSteps)) === 0;
}

/** Whether the viewer is on the LAST step, where the forward control becomes the finish affordance. */
export function isAtLastStep(currentStep: number, totalSteps: number): boolean {
    const total = normalizedTotal(totalSteps);

    return total === 0 || normalizedIndex(currentStep, total) === total - 1;
}

/**
 * The one-based position of the current step, for display. A single-step recipe is `1 of 1`; both boundaries
 * hold at once there, which is a real state (a one-step recipe), not an edge case to special-case away.
 */
export function stepNumber(currentStep: number, totalSteps: number): number {
    return normalizedIndex(currentStep, normalizedTotal(totalSteps)) + 1;
}

/**
 * Fill the `stepPosition` template (`'Step {current} of {total}'`) from the CLAMPED position, so the text a
 * cook reads can never be `Step 0 of 5` or `Step 7 of 5`.
 */
export function formatStepPosition(template: string, currentStep: number, totalSteps: number, locale: Locale): string {
    const total = normalizedTotal(totalSteps);

    // Delegates the rendering to the shared authority in `./stepPosition`. This module keeps only what
    // is genuinely its own knowledge: clamping a possibly-out-of-range index, and turning the 0-based
    // index into a 1-based display number.
    return formatPosition(template, { current: normalizedIndex(currentStep, total) + 1, total }, locale);
}

/**
 * One state per step, in order: everything BEFORE the current index is `completed`, the current index is
 * `current`, everything after is `upcoming`. This is the whole of what the dot row means — both leaves
 * render this array and add nothing to it.
 */
export function stepDotStates(currentStep: number, totalSteps: number): readonly StepDotState[] {
    const total = normalizedTotal(totalSteps);
    const current = normalizedIndex(currentStep, total);

    return Array.from({ length: total }, (_value, index): StepDotState => {
        if (index < current) {
            return 'completed';
        }

        return index === current ? 'current' : 'upcoming';
    });
}

/**
 * Classify a released drag by displacement alone: horizontal must dominate vertical (so a scroll is never a
 * step change), and the horizontal travel must EXCEED {@link SWIPE_THRESHOLD_PX}. Swipe LEFT (negative `dx`,
 * content dragged toward the start) advances; swipe RIGHT goes back.
 */
export function swipeIntent(dx: number, dy: number): SwipeIntent {
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.abs(dx) <= Math.abs(dy)) {
        return 'none';
    }

    if (dx < -SWIPE_THRESHOLD_PX) {
        return 'next';
    }

    if (dx > SWIPE_THRESHOLD_PX) {
        return 'previous';
    }

    return 'none';
}

/**
 * The navigation a swipe actually performs: {@link swipeIntent} narrowed by the SAME boundary rules the tap
 * zones obey. A swipe past either end is a no-op — notably, swiping left on the last step does NOT finish
 * the session, because ending a cook must stay a deliberate press (HAZ-006).
 */
export function swipeNavigation(dx: number, dy: number, currentStep: number, totalSteps: number): SwipeIntent {
    const intent = swipeIntent(dx, dy);

    if (intent === 'next') {
        return isAtLastStep(currentStep, totalSteps) ? 'none' : 'next';
    }

    if (intent === 'previous') {
        return isAtFirstStep(currentStep, totalSteps) ? 'none' : 'previous';
    }

    return 'none';
}
