/**
 * A secret was read and holds no string value: it is binary, or empty. The message names the secret and never a
 * value, because a secret's value is a credential.
 *
 * @module
 */

/** Thrown when a secret holds no string value. */
export class SecretUnavailableError extends Error {
    /** The secret's id, as it was asked for. */
    public readonly secretId: string;

    /**
     * @param secretId - The secret's id.
     */
    public constructor(secretId: string) {
        super(`The secret ${secretId} holds no string value.`);
        this.name = 'SecretUnavailableError';
        this.secretId = secretId;
        Object.setPrototypeOf(this, SecretUnavailableError.prototype);
    }
}

/**
 * Type guard for {@link SecretUnavailableError}. Pure.
 *
 * @param error - Any value.
 * @returns True for a {@link SecretUnavailableError}.
 */
export function isSecretUnavailableError(error: unknown): error is SecretUnavailableError {
    return error instanceof SecretUnavailableError;
}
