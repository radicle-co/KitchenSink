/**
 * @module @commise/features-account/sequenceStep — the ONE rule for tagging which step of an account sequence failed.
 *
 * Erasure (`erasureSequence.ts`) and closure (`closureSequence.ts`) are both "do the account work, then end the
 * session" mutations, and both need the same fact on failure: a failed `exit` means the account work WAS accepted and
 * only leaving failed, so retrying the work would be a lie. The tagging rule lives here once; each sequence keeps its
 * own error class (and `is*` guard), because a closure failure must never read as an erasure failure.
 *
 * Pattern: **Template Method** — the sequences own the order; this owns the wrap of a single step.
 */

/** A sequence step failed. Carries which step and the original failure as `cause`. */
export abstract class SequenceStepError<Step extends string> extends Error {
    public readonly step: Step;

    protected constructor(message: string, step: Step, cause: unknown) {
        super(message, { cause });
        this.step = step;
    }
}

/**
 * Run one step, rethrowing any failure as the sequence's own tagged error.
 *
 * @param step - The step being run.
 * @param run - The step.
 * @param tag - Builds the sequence's error class from the step and the original failure.
 * @returns What the step resolved with.
 * @throws The error `tag` builds, with the original failure as `cause`.
 */
export async function runSequenceStep<Step extends string, T>(
    step: Step,
    run: () => Promise<T>,
    tag: (step: Step, cause: unknown) => Error,
): Promise<T> {
    try {
        return await run();
    } catch (cause) {
        throw tag(step, cause);
    }
}
