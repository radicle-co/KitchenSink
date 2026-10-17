/**
 * @module db-bootstrap/bootstrapRefusedError — the bootstrap refused to act.
 */

/**
 * The bootstrap refused to act: the database or the catalog is in a state it will not change. Raised BEFORE any
 * destructive statement, and it fails the deploy that ran it.
 */
export class BootstrapRefusedError extends Error {
    public readonly reason: string;

    public constructor(reason: string) {
        super(`Database bootstrap refused: ${reason}`);
        this.name = 'BootstrapRefusedError';
        this.reason = reason;
        Object.setPrototypeOf(this, BootstrapRefusedError.prototype);
    }
}

/**
 * Type guard for {@link BootstrapRefusedError}.
 *
 * @param error - Anything thrown.
 * @returns Whether it is a refusal.
 */
export function isBootstrapRefusedError(error: unknown): error is BootstrapRefusedError {
    return error instanceof BootstrapRefusedError;
}
