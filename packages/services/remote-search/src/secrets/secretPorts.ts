/**
 * How this package reads a secret's value, by the secret's id (its name or ARN): the function's USDA key.
 *
 * @module
 */

/**
 * Reads a secret's current string value.
 *
 * @throws {SecretUnavailableError} when the secret holds no string value; any read failure is thrown as it came.
 */
export type SecretReader = (secretId: string) => Promise<string>;
