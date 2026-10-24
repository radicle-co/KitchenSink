/**
 * Raised when a settled downgraded owner is read and identity still calls it entitled — the downgrade did not take, or
 * a token minted before it is in use. Its own file because `signerEntitlement.ts` already exports the opposite error
 * (`SignerNotEntitledError`), and a file does one thing (CODING_STANDARDS §1).
 */
export class SignerStillEntitledError extends Error {
    public constructor(message: string) {
        super(message);
        this.name = 'SignerStillEntitledError';
        Object.setPrototypeOf(this, SignerStillEntitledError.prototype);
    }
}

/**
 * Type guard for {@link SignerStillEntitledError}.
 *
 * @param error - The value to test.
 * @returns `true` when the signer was read and is still entitled.
 */
export function isSignerStillEntitledError(error: unknown): error is SignerStillEntitledError {
    return error instanceof SignerStillEntitledError;
}
