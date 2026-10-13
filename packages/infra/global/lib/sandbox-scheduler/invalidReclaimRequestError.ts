/** An event that is not a reclaim request this function accepts. */
export class InvalidReclaimRequestError extends Error {
    public constructor(public readonly event: unknown) {
        super(
            `Invalid reclaim request ${JSON.stringify(event)} — expected {kind:'step', iteration, maxIterations} with ` +
                `0 <= iteration < maxIterations, or {kind:'report'}.`,
        );
        this.name = 'InvalidReclaimRequestError';
        Object.setPrototypeOf(this, InvalidReclaimRequestError.prototype);
    }
}

/** Whether `error` is an {@link InvalidReclaimRequestError}. Pure. */
export function isInvalidReclaimRequestError(error: unknown): error is InvalidReclaimRequestError {
    return error instanceof InvalidReclaimRequestError;
}
