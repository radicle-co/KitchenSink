/**
 * @module @commise/features-account/closureSequence — the ORDER of an account closure, stated once for both apps.
 *
 * Closure is two steps: CLOSE the account (`deleteMe`, which enqueues the Clerk ban), then END THE SESSION and leave.
 * Web used to run them inside `useTransition` and mobile inside one anonymous `mutationFn`, both with ONE error, so a
 * cook whose account WAS closed read "We couldn't close your account" and could press Close again on a closed account
 * (`buildSpec.md` §9.1 "Close account when the sign-out fails"). Now the whole sequence is ONE `mutationFn` (TanStack
 * runs it to completion after unmount, the erasure P1 #3 reason) and a failure names its step.
 *
 * Pattern: **Command** — a TanStack mutation IS the Command — over a **Template Method** shared with
 * `erasureSequence.ts` (`sequenceStep.ts` owns the step tagging). The `leave` step is the platform's verified sign-out
 * (`useSignOutAndLeave` on web, `useSignOutAndVerify` on mobile; ADR-0009), which is NOT bypassed here.
 *
 * A failed `close` means the account is still open, so retrying is right. A failed `exit` means it IS closed and only
 * leaving failed; the surface must offer sign-out, never another close.
 */
import { useMutation, type UseMutationResult } from '@tanstack/react-query';

import { runSequenceStep, SequenceStepError } from './sequenceStep.js';

/** Which step of the sequence failed. `exit` is the verified sign-out, run only after the close was accepted. */
export type ClosureStep = 'close' | 'exit';

/** The two platform-supplied steps. Each resolves when its step is ACCEPTED and rejects when it is not. */
export interface ClosureSteps {
    /** Close the account (`deleteMe`). */
    readonly close: () => Promise<unknown>;
    /** End the session, PROVE it ended (ADR-0009), and leave. Throws when it cannot prove it. */
    readonly leave: () => Promise<void>;
}

/** A step of the closure sequence failed. Carries the step and the original failure as `cause`. */
export class ClosureStepError extends SequenceStepError<ClosureStep> {
    public constructor(step: ClosureStep, cause: unknown) {
        super(`account closure failed at step "${step}"`, step, cause);
        this.name = 'ClosureStepError';
        Object.setPrototypeOf(this, ClosureStepError.prototype);
    }
}

/** Type guard: `error` is a {@link ClosureStepError} for exactly `step`. */
export function isClosureStepError(error: unknown, step: ClosureStep): error is ClosureStepError {
    return error instanceof ClosureStepError && error.step === step;
}

const tag = (step: ClosureStep, cause: unknown): ClosureStepError => new ClosureStepError(step, cause);

/**
 * Run the closure sequence as one mutation: close, then sign-out and leave. A failing `close` stops the sequence, so
 * the session is never ended over an account that is still open.
 *
 * @param steps - The platform's two steps (see {@link ClosureSteps}); read when the mutation starts.
 * @returns The mutation: `mutate()` starts it, `isPending` stays true through the sign-out, and `error` is a
 *   {@link ClosureStepError} naming the step that failed.
 * @sideEffect Closes the account and ends the session.
 */
export function useClosureSequence(steps: ClosureSteps): UseMutationResult<void, ClosureStepError, void> {
    return useMutation<void, ClosureStepError, void>({
        mutationFn: async () => {
            await runSequenceStep('close', () => steps.close(), tag);
            await runSequenceStep('exit', () => steps.leave(), tag);
        },
    });
}
