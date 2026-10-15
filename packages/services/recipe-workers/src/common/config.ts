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

/**
 * Read a positive integer from the environment, failing CLOSED.
 *
 * ⛔ THROWS rather than defaulting. Every caller describes infrastructure this process does not own (a lease,
 * an allowance, a window), so a default here would be a second definition of a bound the stack owns, and the
 * drift of a copy is silent.
 *
 * @param name - The variable's name.
 * @param env - The environment to read; defaults to `process.env`.
 * @returns The parsed value.
 * @throws When the variable is absent or not a positive integer.
 * @sideEffect Reads `process.env` when no environment is given.
 */
export const requirePositiveEnv = (name: string, env: NodeJS.ProcessEnv = process.env): number => {
    const parsed = Number(env[name]);

    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`${name} must be a positive integer`);
    }

    return parsed;
};
