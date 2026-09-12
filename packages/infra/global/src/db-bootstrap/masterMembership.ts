/**
 * @module db-bootstrap/masterMembership — revoke role memberships and PROVE, from the catalog, that they are gone.
 *
 * ⛔ The master reaching `rds_iam` is the lock-out (`docs/plans/2026-09-11-database-role-split.md`): RDS then demands
 * an IAM token from a password login, and every in-VPC tool that could undo it connects as the master. The legacy
 * recreate joins the master to the legacy app role for a moment, the login probe's rollback has to undo what a pass
 * granted, and the recreate has to take `rds_iam` away from the legacy app role — so "revoke, then re-read and show
 * nothing is left" lives once, here.
 *
 * PostgreSQL 16+ keeps one `pg_auth_members` row PER GRANTOR, and a plain `REVOKE` removes only the rows the current
 * role granted (measured on real PostgreSQL: the master's plain `REVOKE rds_iam` left a superuser's grant standing).
 * So each surviving row is revoked `GRANTED BY` its own grantor, which PostgreSQL allows only when the master holds
 * that grantor's privileges; what still stands is reported. The answer is never "the REVOKE succeeded" — it is "the
 * re-read shows no path".
 *
 * DESIGN PATTERN: Design-by-contract postcondition around a command — the re-read is the contract.
 */
import {
    lockOutPredicate,
    pathsToRole,
    readMembershipEdges,
    type CatalogReader,
    type LockOutEdges,
} from '@kitchensink/db-schema-guard';

/** A membership that survived its revocation. */
export class MasterMembershipError extends Error {
    /** Every remaining path, rendered `a → b`, and every grant that could not be revoked. */
    public readonly remaining: readonly string[];

    public constructor(member: string, remaining: readonly string[]) {
        super(
            `${member} still holds ${remaining.join('; ')} after REVOKE. Refusing to continue: rds_iam is not granted ` +
                'while any such path exists, so this is an outage to fix by hand, not a lock-out.',
        );
        this.name = 'MasterMembershipError';
        this.remaining = remaining;
        Object.setPrototypeOf(this, MasterMembershipError.prototype);
    }
}

/**
 * Type guard for {@link MasterMembershipError}.
 *
 * @param error - Anything thrown.
 * @returns Whether it is the membership error.
 */
export function isMasterMembershipError(error: unknown): error is MasterMembershipError {
    return error instanceof MasterMembershipError;
}

/**
 * Revoke EVERY `pg_auth_members` row making `member` a member of `role`: a plain `REVOKE` (the rows the master
 * granted), then `GRANTED BY` each surviving row's grantor.
 *
 * @param session - A connection as the master.
 * @param role - The role to take away.
 * @param member - The role to take it from.
 * @returns One sentence per row that could not be revoked; empty when every row went.
 * @sideEffect Revokes role memberships.
 */
export async function revokeMembership(
    session: CatalogReader,
    role: string,
    member: string,
): Promise<readonly string[]> {
    await session.query(`REVOKE "${role}" FROM "${member}"`);

    const survivors = (
        await session.query<{ grantor: string }>(
            `SELECT g.rolname AS grantor
               FROM pg_auth_members am
               JOIN pg_roles r ON r.oid = am.roleid
               JOIN pg_roles m ON m.oid = am.member
               JOIN pg_roles g ON g.oid = am.grantor
              WHERE r.rolname = $1 AND m.rolname = $2`,
            [role, member],
        )
    ).rows;
    const refusals: string[] = [];

    for (const { grantor } of survivors) {
        try {
            await session.query(`REVOKE "${role}" FROM "${member}" GRANTED BY "${grantor}"`);
        } catch (error) {
            refusals.push(
                `the grant of ${role} to ${member} by ${grantor} (${error instanceof Error ? error.message : String(error)})`,
            );
        }
    }

    return refusals;
}

/**
 * Take the master out of `roles`, then prove from a fresh read that it has no path into any of them.
 *
 * Only the rows the lock-out reading COUNTS are revoked and checked: in production that is every row (the default);
 * a vanilla-PostgreSQL stand-in passes `inherit-or-set`, because its creator's ADMIN rows cannot be revoked by
 * anyone but a superuser and RDS holds that ADMIN without a row.
 *
 * @param session - A connection as the master.
 * @param master - The master login.
 * @param roles - The roles to take it out of.
 * @param lockOutEdges - Which rows count; `every-row` unless the caller is a vanilla-PostgreSQL stand-in.
 * @returns The roles a row was revoked from.
 * @throws {MasterMembershipError} when a path or an unrevokable grant survives.
 * @sideEffect Revokes role memberships.
 */
export async function releaseMasterFrom(
    session: CatalogReader,
    master: string,
    roles: readonly string[],
    lockOutEdges: LockOutEdges = 'every-row',
): Promise<readonly string[]> {
    const counts = lockOutPredicate(lockOutEdges);
    const before = await readMembershipEdges(session);
    const held = roles.filter((role) =>
        before.some((edge) => edge.member === master && edge.role === role && counts(edge)),
    );
    const refusals: string[] = [];

    for (const role of held) {
        refusals.push(...(await revokeMembership(session, role, master)));
    }

    const after = await readMembershipEdges(session);
    const remaining = roles.flatMap((role) => pathsToRole(after, master, role, counts).map((path) => path.join(' → ')));

    if (remaining.length > 0) {
        throw new MasterMembershipError(master, [...remaining, ...refusals]);
    }

    return held;
}
