/**
 * @module db-bootstrap/postconditions — read-back proof that a DB bootstrap actually provisioned its role.
 *
 * ## Why a bootstrap has to prove its own effect
 *
 * `food-db-bootstrap` and `recipe-db-bootstrap` are CloudFormation custom resources. CloudFormation records
 * whatever the handler returns, so "the resource succeeded" only ever meant "the handler did not throw" — it
 * never meant the role exists. That gap shipped: a bundle-less deploy substituted a 101-byte placeholder
 * which returned success without opening a connection, CloudFormation reported CREATE_COMPLETE, and prod ran
 * four weeks with no `food_app` role. The damage surfaced in another service, weeks later, as
 * `password authentication failed for user "food_app"` — an error that points at credentials, not at
 * provisioning.
 *
 * So after the DDL, the handler READS BACK what it claimed to create. A bootstrap that cannot demonstrate its
 * postconditions fails the deploy that ran it, at the resource that owns them.
 *
 * This is also what makes the provisioning **reproducible from code**. Previously, whether a stage's roles
 * came from this handler or from someone's local `npm run deploy` was unanswerable — the roles were present
 * and the deployed handler was a stub. With the read-back, every deploy of every stage either proves these
 * roles are this code's output or fails loudly.
 *
 * ## What is checked, and why each one
 *
 * Each postcondition mirrors exactly one statement `bootstrap()` issues, so a statement that quietly stops
 * taking effect fails here rather than downstream:
 *
 * | postcondition            | mirrors                                    | how it fails in the wild if unmet          |
 * | ------------------------ | ------------------------------------------ | ------------------------------------------ |
 * | role exists, can LOGIN   | `CREATE ROLE <role> LOGIN`                 | 28P01 at the first connection              |
 * | member of `rds_iam`      | `GRANT rds_iam TO <role>`                  | 28P01 — the IAM token is read as a password |
 * | base database exists     | `CREATE DATABASE … OWNER <role>`           | 3D000 `database … does not exist`          |
 * | …and is OWNED by the role | the `OWNER <role>` clause above            | cannot create in `public` → migrations fail |
 * | CREATEDB (non-prod only) | `ALTER ROLE <role> CREATEDB`               | per-PR database creation denied (ADR-0006) |
 *
 * `rds_iam` membership is read from `pg_auth_members` rather than via `pg_has_role`, because `pg_has_role`
 * RAISES on an unknown role name — on any non-RDS PostgreSQL (a local docker instance) `rds_iam` does not
 * exist, and an exception there would be indistinguishable from a genuine provisioning failure. The catalog
 * join simply returns no rows.
 */
import type pg from 'pg';

/** What the bootstrap claims to have provisioned, and therefore what must be true afterwards. */
export interface BootstrapExpectation {
    /** The least-privilege login role, e.g. `food_app`. */
    readonly role: string;
    /** The base database the role owns, e.g. `kitchensink_food`. */
    readonly databaseName: string;
    /** Whether the role must hold CREATEDB — true for non-prod stages only (per-PR databases, ADR-0006). */
    readonly requireCreateDb: boolean;
}

/** Raised when a bootstrap cannot demonstrate that it provisioned what it claimed. */
export class BootstrapPostconditionError extends Error {
    /** Every postcondition that was not met, in check order. */
    public readonly unmet: readonly string[];

    public constructor(expectation: BootstrapExpectation, unmet: readonly string[]) {
        super(
            `Bootstrap postconditions NOT met for role "${expectation.role}" / database ` +
                `"${expectation.databaseName}": ${unmet.join('; ')}. The DDL reported no error but the catalog ` +
                'does not reflect it. The usual cause is that the deployed handler is the missing-bundle ' +
                'placeholder rather than the real bootstrap — run `npm run bundle:lambda ' +
                '--workspace=packages/infra/global` before `cdk deploy`. Failing here on purpose: reporting ' +
                'success would defer this to the next service that tries to connect.',
        );
        this.name = 'BootstrapPostconditionError';
        this.unmet = unmet;
        Object.setPrototypeOf(this, BootstrapPostconditionError.prototype);
    }
}

/** Type guard for {@link BootstrapPostconditionError}. */
export function isBootstrapPostconditionError(error: unknown): error is BootstrapPostconditionError {
    return error instanceof BootstrapPostconditionError;
}

interface RoleRow {
    readonly rolcanlogin: boolean;
    readonly rolcreatedb: boolean;
}

/**
 * Verify that the bootstrap's effects are visible in the catalog, and throw with every unmet postcondition.
 *
 * Reports ALL failures together rather than the first: when the placeholder shipped, every postcondition was
 * unmet at once, and surfacing them one deploy at a time would cost a cycle per fault.
 *
 * @param pool - A pool connected as the master user (the same one that ran the DDL).
 * @param expectation - What the bootstrap claimed to provision.
 * @throws {BootstrapPostconditionError} when any postcondition is unmet.
 * @sideEffect Reads the PostgreSQL system catalogs.
 */
export async function assertBootstrapPostconditions(pool: pg.Pool, expectation: BootstrapExpectation): Promise<void> {
    const unmet: string[] = [];

    const roleResult = await pool.query<RoleRow>('SELECT rolcanlogin, rolcreatedb FROM pg_roles WHERE rolname = $1', [
        expectation.role,
    ]);
    const role = roleResult.rows[0];

    if (role === undefined) {
        unmet.push(`role "${expectation.role}" does not exist`);
    } else {
        if (!role.rolcanlogin) {
            unmet.push(`role "${expectation.role}" exists but cannot LOGIN`);
        }

        if (expectation.requireCreateDb && !role.rolcreatedb) {
            unmet.push(`role "${expectation.role}" lacks CREATEDB, which this stage needs to create per-PR databases`);
        }
    }

    // Checked even when the role is absent: the two probes are independent, and a partial state (role gone
    // but membership row present, or vice versa) is worth reporting in full.
    const membership = await pool.query(
        'SELECT 1 FROM pg_auth_members m ' +
            'JOIN pg_roles grantee ON grantee.oid = m.member ' +
            'JOIN pg_roles granted ON granted.oid = m.roleid ' +
            "WHERE granted.rolname = 'rds_iam' AND grantee.rolname = $1",
        [expectation.role],
    );

    if ((membership.rowCount ?? 0) === 0) {
        unmet.push(
            `role "${expectation.role}" is not a member of rds_iam, so it would authenticate by password ` +
                'and reject its IAM token (SQLSTATE 28P01)',
        );
    }

    // Ownership, not just existence. `CREATE DATABASE … OWNER <role>` runs ONLY when the database is absent,
    // so one that already exists — created by hand, or by an older bootstrap — never has its ownership
    // corrected, and a name-only check passes in exactly that drifted state.
    //
    // It matters materially: `GRANT ALL PRIVILEGES ON DATABASE` confers CONNECT/CREATE/TEMP on the DATABASE,
    // not rights inside the `public` SCHEMA. On PostgreSQL 15+ CREATE on `public` is revoked from PUBLIC and
    // the schema belongs to the database owner, so a non-owning role cannot create tables at all — surfacing
    // days later as a migration failure in a different component.
    const database = await pool.query<{ readonly owner: string }>(
        'SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = $1',
        [expectation.databaseName],
    );
    const database0 = database.rows[0];

    if (database0 === undefined) {
        unmet.push(`database "${expectation.databaseName}" does not exist`);
    } else if (database0.owner !== expectation.role) {
        unmet.push(
            `database "${expectation.databaseName}" is owned by "${database0.owner}", not by ` +
                `"${expectation.role}" — the role cannot create objects in its public schema (PostgreSQL 15+ ` +
                'revokes CREATE on public from PUBLIC), so migrations will fail. Fix with ' +
                `ALTER DATABASE "${expectation.databaseName}" OWNER TO ${expectation.role};`,
        );
    }

    if (unmet.length > 0) {
        throw new BootstrapPostconditionError(expectation, unmet);
    }
}
