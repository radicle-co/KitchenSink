/**
 * @module @commise/features-account/erasureSequence — the ORDER of an account erasure, stated once for both apps.
 *
 * Erasure is three steps that only make sense in this order: erase the viewer's RECIPES (with the donate
 * election), erase the ACCOUNT (identity row, Clerk account, fan-out to food), then END THE SESSION and leave.
 * Web and mobile used to chain them through `mutate(..., { onSuccess })` callbacks. TanStack drops observer
 * callbacks once the component unmounts, so a browser Back or a route change during the first step erased the
 * recipes and then never deleted the account or ended the session (review finding P1 #3). The whole sequence is
 * now ONE `mutationFn`, which TanStack runs to completion after unmount; only the observer's view of it is lost.
 *
 * Pattern: **Command** — a TanStack mutation IS the Command — over a **Template Method**: this module owns the
 * ordering and the step labelling; each platform supplies its three steps (its own recipe-erasure and
 * account-erasure calls, and its sign-out adapter over `signOutAndVerify`, ADR-0009, which is NOT bypassed:
 * the last step must still prove the session ended). Mirrors `signOutAndVerify`: one authority for the part
 * that must not drift between platforms.
 *
 * Which step failed matters, so a failure is wrapped in {@link ErasureStepError}: a failed recipe or account
 * step means "we couldn't erase, try again", while a failed `exit` means the erasure WAS accepted and only
 * leaving failed — retrying the erasure would be a lie.
 */
import { useMutation, type UseMutationResult } from '@tanstack/react-query';

import { runSequenceStep, SequenceStepError } from './sequenceStep.js';

/** The recipe-service erasure request the first step sends. */
export interface RecipeErasureInput {
    /** The phrase the viewer typed (already gated by `confirmsErasurePhrase`; the server re-validates it). */
    readonly confirmationPhrase: string;
    /** The donate election: owner-only recipes to publish instead of destroy. */
    readonly publishRecipeIds: readonly string[];
}

/** Which step of the sequence failed. `exit` is the sign-out and leave, run only after both erasures were accepted. */
export type ErasureStep = 'recipes' | 'account' | 'exit';

/** The three platform-supplied steps. Each resolves when its step is ACCEPTED and rejects when it is not. */
export interface ErasureSteps {
    /** Erase the viewer's recipes, honouring the donate election. */
    readonly eraseRecipes: (input: RecipeErasureInput) => Promise<unknown>;
    /** Erase the account itself (identity, Clerk, fan-out). */
    readonly eraseAccount: () => Promise<unknown>;
    /** End the session, PROVE it ended (`signOutAndVerify`), and leave. Throws when it cannot prove it. */
    readonly leave: () => Promise<void>;
    /**
     * Whether a recipe-step failure is the service's `410 ALREADY_ERASED`: a prior recipe erasure COMPLETED, so the
     * step's goal already holds. Supplied by the platform because the error type belongs to the recipe client.
     */
    readonly recipesAlreadyErased: (error: unknown) => boolean;
}

/** A step of the erasure sequence failed. Carries the step and the original failure as `cause`. */
export class ErasureStepError extends SequenceStepError<ErasureStep> {
    public constructor(step: ErasureStep, cause: unknown) {
        super(`account erasure failed at step "${step}"`, step, cause);
        this.name = 'ErasureStepError';
        Object.setPrototypeOf(this, ErasureStepError.prototype);
    }
}

/** Type guard: `error` is an {@link ErasureStepError} for exactly `step`. */
export function isErasureStepError(error: unknown, step: ErasureStep): error is ErasureStepError {
    return error instanceof ErasureStepError && error.step === step;
}

const runStep = <T>(step: ErasureStep, run: () => Promise<T>): Promise<T> =>
    runSequenceStep(step, run, (failed, cause) => new ErasureStepError(failed, cause));

/**
 * Run the erasure sequence as one mutation: recipes, then account, then sign-out and leave. A failing step stops
 * the sequence there, so the session is never ended over an account that still exists.
 *
 * Retrying after an `account` failure re-runs the recipe step. The service answers a duplicate `202` while the
 * recipe job is in flight but `410 ALREADY_ERASED` once it has completed, so that answer counts as the step done;
 * otherwise a retry could never reach the account step again.
 *
 * @param steps - The platform's three steps (see {@link ErasureSteps}); read when the mutation starts.
 * @returns The mutation: `mutate(input)` starts it, `isPending` stays true through the sign-out, and `error` is an
 *   {@link ErasureStepError} naming the step that failed.
 * @sideEffect Irreversibly erases the recipes and the account, and ends the session.
 */
export function useErasureSequence(steps: ErasureSteps): UseMutationResult<void, ErasureStepError, RecipeErasureInput> {
    return useMutation<void, ErasureStepError, RecipeErasureInput>({
        mutationFn: async (input) => {
            await runStep('recipes', async () => {
                try {
                    await steps.eraseRecipes(input);
                } catch (error) {
                    if (!steps.recipesAlreadyErased(error)) {
                        throw error;
                    }
                }
            });
            await runStep('account', () => steps.eraseAccount());
            await runStep('exit', () => steps.leave());
        },
    });
}
