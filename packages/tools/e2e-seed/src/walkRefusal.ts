/**
 * What counts as a refusal in the user-story walk (`userStoryWalk.ts`).
 *
 * ⛔ ONLY THE STATUS THE RULE SPECIFIES. Both refusals the walk checks are `403`s by contract — `CANNOT_RATE_OWN_RECIPE`
 * (US2.8) and `NOT_OWNER` on a visible recipe (US1.4). Any other failure (a `5xx`, an expired token, a timeout, a
 * transport error) says nothing about the authorization rule, and counting it as a pass is a green over a check that
 * never ran.
 */
import { isForbiddenError } from '@kitchensink/recipe-service-client';

/** One refusal check's verdict and the detail the walk prints beside it. */
export interface RefusalOutcome {
    readonly refused: boolean;
    readonly detail: string;
}

/**
 * Run a write that the service must refuse with a `403`, and report whether it did.
 *
 * @param attempt - The write to try.
 * @returns `refused: true` only for a `403`; an accepted write or any other failure is `refused: false`.
 * @sideEffect Runs `attempt`, which makes an HTTP call.
 */
export async function attemptRefusal(attempt: () => Promise<unknown>): Promise<RefusalOutcome> {
    try {
        await attempt();
    } catch (error) {
        if (isForbiddenError(error)) {
            return { refused: true, detail: `403 ${error.code ?? ''}`.trim() };
        }

        return { refused: false, detail: `not a 403: ${describeFailure(error)}` };
    }

    return { refused: false, detail: 'the write was accepted' };
}

/** A short, printable account of an unexpected failure. Pure. */
function describeFailure(error: unknown): string {
    if (error instanceof Error) {
        const status = 'status' in error && typeof error.status === 'number' ? ` (${String(error.status)})` : '';

        return `${error.name}${status}: ${error.message}`;
    }

    return String(error);
}
