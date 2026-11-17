/**
 * The errors `@kitchensink/cooking-core` throws, each with its matching `is*` guard.
 */

/** Raised when a step count is not a positive integer, so no valid step index could exist. */
export class InvalidTotalStepsError extends Error {
    public constructor(public readonly totalSteps: number) {
        super(`Invalid total step count: ${totalSteps}`);
        this.name = 'InvalidTotalStepsError';
        Object.setPrototypeOf(this, InvalidTotalStepsError.prototype);
    }
}

/**
 * Type guard for {@link InvalidTotalStepsError}.
 *
 * @param error - The thrown value.
 * @returns `true` when `error` is an {@link InvalidTotalStepsError}.
 */
export function isInvalidTotalStepsError(error: unknown): error is InvalidTotalStepsError {
    return error instanceof InvalidTotalStepsError;
}

/** Raised when a caller jumps to a step index the recipe does not contain. */
export class InvalidStepIndexError extends Error {
    public constructor(
        public readonly index: number,
        public readonly totalSteps: number,
    ) {
        super(`Step index ${index} is outside the range [0, ${totalSteps - 1}]`);
        this.name = 'InvalidStepIndexError';
        Object.setPrototypeOf(this, InvalidStepIndexError.prototype);
    }
}

/**
 * Type guard for {@link InvalidStepIndexError}.
 *
 * @param error - The thrown value.
 * @returns `true` when `error` is an {@link InvalidStepIndexError}.
 */
export function isInvalidStepIndexError(error: unknown): error is InvalidStepIndexError {
    return error instanceof InvalidStepIndexError;
}

/** Raised when a caller names a line of a step that the step's split does not contain. */
export class InvalidLineIndexError extends Error {
    public constructor(
        public readonly lineIndex: number,
        public readonly lineCount: number,
    ) {
        super(`Line index ${lineIndex} is outside the range [0, ${lineCount - 1}]`);
        this.name = 'InvalidLineIndexError';
        Object.setPrototypeOf(this, InvalidLineIndexError.prototype);
    }
}

/**
 * Type guard for {@link InvalidLineIndexError}.
 *
 * @param error - The thrown value.
 * @returns `true` when `error` is an {@link InvalidLineIndexError}.
 */
export function isInvalidLineIndexError(error: unknown): error is InvalidLineIndexError {
    return error instanceof InvalidLineIndexError;
}

/** Raised when a timer length is not a whole number of ms between the shortest and the longest timer. */
export class InvalidTimerDurationError extends Error {
    public constructor(public readonly durationMs: number) {
        super(`Invalid timer duration: ${durationMs} ms`);
        this.name = 'InvalidTimerDurationError';
        Object.setPrototypeOf(this, InvalidTimerDurationError.prototype);
    }
}

/**
 * Type guard for {@link InvalidTimerDurationError}.
 *
 * @param error - The thrown value.
 * @returns `true` when `error` is an {@link InvalidTimerDurationError}.
 */
export function isInvalidTimerDurationError(error: unknown): error is InvalidTimerDurationError {
    return error instanceof InvalidTimerDurationError;
}
