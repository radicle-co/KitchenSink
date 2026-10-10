/**
 * A source adapter's configuration is missing or malformed. It names the variables and never their values, because a
 * source's configuration holds its credential.
 *
 * @module
 */
import type { RemoteSearchSource } from '../search/remoteSearch.schema.js';

/** Thrown when a source adapter cannot be built from the process environment. */
export class SourceConfigurationError extends Error {
    /** The source whose configuration failed. */
    public readonly source: RemoteSearchSource;

    /** The environment variables that are missing or malformed. */
    public readonly variables: readonly string[];

    /**
     * @param source - The source.
     * @param variables - The variables that failed, by name.
     */
    public constructor(source: RemoteSearchSource, variables: readonly string[]) {
        super(`The ${source} source's configuration is missing or malformed: ${variables.join(', ')}`);
        this.name = 'SourceConfigurationError';
        this.source = source;
        this.variables = variables;
        Object.setPrototypeOf(this, SourceConfigurationError.prototype);
    }
}

/**
 * Type guard for {@link SourceConfigurationError}. Pure.
 *
 * @param error - Any value.
 * @returns True for a {@link SourceConfigurationError}.
 */
export function isSourceConfigurationError(error: unknown): error is SourceConfigurationError {
    return error instanceof SourceConfigurationError;
}
