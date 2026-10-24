/** An event that is not a scheduler command this function accepts. */
export class InvalidSchedulerRequestError extends Error {
    public constructor(public readonly event: unknown) {
        super(
            `Invalid scheduler request ${JSON.stringify(event)} — expected {action:'stop'}, {action:'sync'} or ` +
                `{action:'start', stage:'pr-<N>'}.`,
        );
        this.name = 'InvalidSchedulerRequestError';
        Object.setPrototypeOf(this, InvalidSchedulerRequestError.prototype);
    }
}

/** Whether `error` is an {@link InvalidSchedulerRequestError}. Pure. */
export function isInvalidSchedulerRequestError(error: unknown): error is InvalidSchedulerRequestError {
    return error instanceof InvalidSchedulerRequestError;
}
