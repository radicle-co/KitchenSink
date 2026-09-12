/**
 * The master login probe could not REACH the server, so the pass refused to conclude a lock-out.
 *
 * ⛔ WHY THIS IS A SEPARATE TYPE FROM `MasterLoginProbeError`, AND NOT A FLAG ON IT. That error's message
 * states that a rollback HAPPENED — it is thrown only on the path that revoked `rds_iam` from
 * `<svc>_migrator` and `<svc>_app`. This one is thrown on the path that deliberately revoked NOTHING, so
 * reusing that type would make its own message a lie at exactly the moment an operator is reading it to
 * decide whether the instance's role model has been altered.
 *
 * ⛔ THE ASYMMETRY IS THE POINT, and it is chosen on blast radius rather than on tidiness. Rolling back
 * revokes `rds_iam` from LIVE roles every running service authenticates with, so mistaking a network
 * failure for a lock-out manufactures an instance-wide outage — in response to the signal least likely to
 * mean what it looked like. Failing to roll back when a real lock-out occurred leaves the instance in the
 * state it was already in and surfaces as a stated failure a human handles. One of those is recoverable and
 * the other is an incident, so the pass rolls back ONLY on a definite credential refusal (SQLSTATE `28P01`
 * or `28000`) and raises this for everything else, including an unrecognised code.
 *
 * ⚠️ A real lock-out therefore no longer self-heals on a probe whose error carries no SQLSTATE. That is
 * accepted: the previous behaviour "healed" by causing the outage it was meant to prevent, which a measured
 * run demonstrated — a single injected `ECONNREFUSED` produced a full revoke and then reported
 * `recoveredAfterRollback: true`, having recovered only from its own damage.
 */
export class MasterUnreachableError extends Error {
    /** The probe's own failure text, verbatim. */
    public readonly failure: string;

    /** The SQLSTATE or Node errno the probe reported, when it carried one. */
    public readonly code: string | undefined;

    public constructor(failure: string, code: string | undefined) {
        super(
            `The master login probe could not reach the server (${code ?? 'no code'}): ${failure}. ` +
                'NOTHING was rolled back — the role model is unchanged, and this is deliberately not treated ' +
                'as a lock-out. Re-run the pass once connectivity is restored.',
        );

        this.name = 'MasterUnreachableError';
        this.failure = failure;
        this.code = code;

        Object.setPrototypeOf(this, MasterUnreachableError.prototype);
    }
}

/**
 * Whether an unknown value is a {@link MasterUnreachableError}.
 *
 * @param error - The value to test.
 * @returns Whether it is this error. Pure.
 */
export function isMasterUnreachableError(error: unknown): error is MasterUnreachableError {
    return error instanceof MasterUnreachableError;
}

/**
 * The SQLSTATEs that mean "the server refused THESE CREDENTIALS", which is the only signal that can mean a
 * lock-out.
 *
 * `28P01` is `invalid_password`; `28000` is `invalid_authorization_specification` — what AWS produces once
 * it has switched the master to IAM auth and a password login is no longer admissible. Everything else,
 * including every Node errno (`ECONNREFUSED`, `ETIMEDOUT`, `ENOTFOUND`) and every unrecognised SQLSTATE, is
 * NOT a credential refusal.
 */
const CREDENTIAL_REFUSAL_SQLSTATES: readonly string[] = ['28P01', '28000'];

/**
 * Whether a probe failure's code means the server refused the master's credentials.
 *
 * ⛔ Deliberately NOT a message match. `pg` sets `code` on every server error, and a message is localised,
 * reworded between versions, and trivially matched by accident — while this predicate decides whether to
 * revoke `rds_iam` from live roles. An absent or unknown code answers `false`, which is the safe direction.
 *
 * @param code - The error's `code`, if it carried one.
 * @returns Whether this is a credential refusal. Pure.
 */
export function isCredentialRefusal(code: string | undefined): boolean {
    return code !== undefined && CREDENTIAL_REFUSAL_SQLSTATES.includes(code);
}
