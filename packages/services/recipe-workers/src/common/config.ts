/**
 * Raised when a required environment variable is absent or empty. Extends `Error` with a matching
 * `isMissingConfigError` guard per the repo custom-error convention.
 */
export class MissingConfigError extends Error {
    public readonly variableName: string;

    constructor(variableName: string) {
        super(`Missing required environment variable: ${variableName}`);
        this.name = 'MissingConfigError';
        this.variableName = variableName;
        Object.setPrototypeOf(this, MissingConfigError.prototype);
    }
}

export const isMissingConfigError = (error: unknown): error is MissingConfigError =>
    error instanceof MissingConfigError;

/**
 * Read a required environment variable, throwing `MissingConfigError` when unset or empty. Uses
 * bracket notation per the repo env-access convention.
 */
export const requireEnv = (name: string): string => {
    const value = process.env[name];

    if (value === undefined || value === '') {
        throw new MissingConfigError(name);
    }

    return value;
};
