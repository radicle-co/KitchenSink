/**
 * @module db-bootstrap/masterLoginProbeError — a fresh master login failed after the pass.
 */

/** A fresh password login as the master failed after the pass — the lock-out's first symptom. */
export class MasterLoginProbeError extends Error {
    /** Why the first probe failed. */
    public readonly probeFailure: string;
    /** Whether a login worked again after the pass took back what it had granted the master. */
    public readonly recoveredAfterRollback: boolean;

    public constructor(probeFailure: string, recoveredAfterRollback: boolean) {
        super(
            `A fresh login as the RDS master FAILED after the bootstrap (${probeFailure}). The pass revoked what it ` +
                `had granted the master; a login ${recoveredAfterRollback ? 'works again' : 'STILL FAILS'} after that ` +
                'rollback. Failing the deploy: an unconfirmed master login is not a state to continue from.',
        );
        this.name = 'MasterLoginProbeError';
        this.probeFailure = probeFailure;
        this.recoveredAfterRollback = recoveredAfterRollback;
        Object.setPrototypeOf(this, MasterLoginProbeError.prototype);
    }
}

/**
 * Type guard for {@link MasterLoginProbeError}.
 *
 * @param error - Anything thrown.
 * @returns Whether it is the probe error.
 */
export function isMasterLoginProbeError(error: unknown): error is MasterLoginProbeError {
    return error instanceof MasterLoginProbeError;
}
