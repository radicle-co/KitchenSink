/**
 * @module stepOfferMs — the length a step offers to time.
 */
import { hasStepText } from '@kitchensink/cooking-core';

/** A step as the offer reads it. */
interface OfferStep {
    readonly instruction: string;
    readonly timerSeconds?: number;
}

/**
 * The length of the timer a step offers.
 *
 * @param steps - The recipe's steps, in order.
 * @param stepIndex - The 0-based index among the steps with text, as the step walk counts.
 * @returns The length in ms, or `undefined` when the step has none, a zero length, or does not exist. Pure.
 */
export function stepOfferMs(steps: readonly OfferStep[], stepIndex: number): number | undefined {
    const seconds = steps.filter(({ instruction }) => hasStepText(instruction))[stepIndex]?.timerSeconds;

    return seconds === undefined || seconds <= 0 ? undefined : seconds * 1000;
}
