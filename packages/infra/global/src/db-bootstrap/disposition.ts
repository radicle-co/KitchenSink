/**
 * @module db-bootstrap/disposition — the role-split bootstrap's pure decision: what to do with a service's base
 * database, given who owns it.
 *
 * ⛔ It stands between a deploy and a database nobody meant to touch. ADR-0039's one-shot legacy recreate (owner
 * rulings 1, 2 and 8 of `docs/plans/2026-09-11-database-role-split.md`) ran on sandbox on 2026-10-04 and on prod on
 * 2026-10-25, and the disarm commit deleted it. So:
 *
 * - no answer drops a database: there is create, ready, adopt and refuse;
 * - an EMPTY master-owned database is adopted, the one ownership change that destroys nothing;
 * - a database still owned by its pre-role-split owner is REFUSED, by name, and the deploy fails instead of quietly
 *   running on the old model.
 *
 * DESIGN PATTERN: Policy module — a pure, total function over a closed decision union (Visitor via an exhaustive
 * switch in the caller); the bootstrap pass is the thin impure applier.
 */
import type { DatabaseRoles, DatabaseService } from '@kitchensink/db-schema-guard';

/**
 * The roles that owned a service's base database BEFORE the role split, which the refusal names so an operator
 * knows the stage never completed the split.
 *
 * - identity: RDS created `kitchensink_identity` for the master (the instance's `databaseName`).
 * - food / recipe: their single `<svc>_app` role migrated AND served, and owned the database. The name survives as
 *   the new data-only service role.
 *
 * @param service - The database.
 * @param roles - Its roles.
 * @param master - The RDS master login.
 * @returns The legacy owners. Pure.
 */
export function legacyOwnersOf(service: DatabaseService, roles: DatabaseRoles, master: string): readonly string[] {
    return service === 'identity' ? [master] : [roles.app];
}

/** What the catalog says about the base database, read from `pg_database` on the maintenance database. */
export interface DatabaseRow {
    readonly owner: string;
    /** `datconnlimit = -2`: an interrupted `DROP DATABASE` left it invalid. */
    readonly draining: boolean;
}

/** Everything {@link decideDisposition} needs. */
export interface DispositionInput {
    readonly service: DatabaseService;
    readonly roles: DatabaseRoles;
    readonly master: string;
    readonly database: string;
    /** `undefined` when the database does not exist. */
    readonly row: DatabaseRow | undefined;
    /**
     * Whether a MASTER-owned database holds no user objects. Measured only while the master owns it — after an
     * adopt there is no second chance to look inside (prod's master cannot connect to an owner-owned database).
     * `undefined` means "not measured", which never licenses an adopt.
     */
    readonly empty: boolean | undefined;
}

/** What to do with the base database. */
export type DatabaseDisposition =
    | { readonly kind: 'create' }
    | { readonly kind: 'ready' }
    | { readonly kind: 'adopt' }
    | { readonly kind: 'refuse'; readonly reason: string };

/**
 * Decide what to do with a service's base database.
 *
 * @param input - Its catalog row and its emptiness (master-owned only).
 * @returns The disposition. Pure and total.
 */
export function decideDisposition(input: DispositionInput): DatabaseDisposition {
    const { row, roles, master, database } = input;

    if (row === undefined) {
        return { kind: 'create' };
    }

    if (row.draining) {
        return {
            kind: 'refuse',
            reason:
                `${database} is mid-DROP (datconnlimit = -2): an interrupted DROP DATABASE left it invalid, and ` +
                'CREATE DATABASE cannot reuse the name. Finish the drop by hand, then redeploy.',
        };
    }

    if (row.owner === roles.owner) {
        return { kind: 'ready' };
    }

    if (row.owner === master && input.empty === true) {
        return { kind: 'adopt' };
    }

    if (legacyOwnersOf(input.service, roles, master).includes(row.owner)) {
        return {
            kind: 'refuse',
            reason:
                `${database} is owned by ${row.owner}, the legacy owner from before the role split, so this stage ` +
                'never completed it. The one-shot recreate that finished the split was removed (ADR-0039), so bring ' +
                `the database and its objects onto ${roles.owner} by hand, then redeploy.`,
        };
    }

    return {
        kind: 'refuse',
        reason:
            `${database} is owned by ${row.owner}, which is neither ${roles.owner} nor a legacy owner this bootstrap ` +
            'can name. Refusing to touch it.',
    };
}
