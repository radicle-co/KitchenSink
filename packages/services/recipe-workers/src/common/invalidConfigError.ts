/**
 * Raised when a required environment variable is PRESENT but not a usable value (for example not a positive
 * integer). The sibling of `MissingConfigError` in `config.ts`: absent and malformed are different operator mistakes.
 */
export class InvalidConfigError extends Error {
    public readonly variableName: string;

    constructor(variableName: string, message: string) {
        super(message);
        this.name = 'InvalidConfigError';
        this.variableName = variableName;
        Object.setPrototypeOf(this, InvalidConfigError.prototype);
    }
}

export const isInvalidConfigError = (error: unknown): error is InvalidConfigError =>
    error instanceof InvalidConfigError;
