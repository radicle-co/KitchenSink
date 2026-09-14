/**
 * @module db-bootstrap/disposition — the role-split bootstrap's two pure decisions.
 *
 * 1. {@link legacyRecreateArmed}: whether this deploy may run the ONE-SHOT legacy recreate.
 * 2. {@link decideDisposition}: what to do with a service's base database, given who owns it.
 *
 * ⛔ These stand between a deploy and `DROP DATABASE`. The recreate is the owner's ruling for ONE release
 * (`docs/plans/2026-09-11-database-role-split.md`, rulings 1, 2 and 8: nothing is live, prod data is disposable,
 * the databases are recreated owned by `<svc>_owner`). Everything else about this module exists to keep it from
 * ever running outside that window:
 *
 * - it drops only a database owned by a role this module can NAME as that database's legacy owner — an unknown
 *   owner is refused, armed or not;
 * - once a database is owned by `<svc>_owner` it is `ready`, so a second armed run is a no-op — the recreate cannot
 *   repeat itself;
 * - an EMPTY master-owned database is adopted, not dropped, even when armed — the destructive path is taken only
 *   when nothing cheaper will do;
 * - after the disarm commit a still-legacy stage is REFUSED — the deploy fails, it does not quietly run on the old
 *   model.
 *
 * DESIGN PATTERN: Policy module — pure, total functions over a closed decision union (Visitor via an exhaustive
 * switch in the caller); the bootstrap pass is the thin impure applier.
 */
import type { DatabaseRoles, DatabaseService } from '@kitchensink/db-schema-guard';

/**
 * The arming token's fixed prefix. The full token is `role-split-2026-09:<stage>`: the DataStack stamps it on the
 * custom resource for each armed stage, and the handler checks the stage segment against its OWN `STAGE`, so a token
 * wired to the wrong stage cannot arm anything.
 */
export const LEGACY_RECREATE_TOKEN_PREFIX = 'role-split-2026-09';

/** The arming token was present but does not arm THIS stage. */
export class LegacyRecreateTokenError extends Error {
    public readonly token: string;
    public readonly stage: string;

    public constructor(token: string, stage: string) {
        super(
            `Refusing the legacy recreate token ${JSON.stringify(token)} on stage ${JSON.stringify(stage)}: only ` +
                `"${LEGACY_RECREATE_TOKEN_PREFIX}:${stage}" arms this stage. A token for another stage or of another ` +
                'shape is a wiring fault, and is surfaced rather than read as "not armed".',
        );
        this.name = 'LegacyRecreateTokenError';
        this.token = token;
        this.stage = stage;
        Object.setPrototypeOf(this, LegacyRecreateTokenError.prototype);
    }
}

/**
 * Type guard for {@link LegacyRecreateTokenError}.
 *
 * @param error - Anything thrown.
 * @returns Whether it is the token error.
 */
export function isLegacyRecreateTokenError(error: unknown): error is LegacyRecreateTokenError {
    return error instanceof LegacyRecreateTokenError;
}

/**
 * Whether the one-shot legacy recreate is armed for `stage`.
 *
 * @param token - The custom resource's `legacyRecreate` property; absent once disarmed.
 * @param stage - The function's own `STAGE`.
 * @returns `true` only for exactly `role-split-2026-09:<stage>`; `false` when no token is supplied. Pure.
 * @throws {LegacyRecreateTokenError} on any other non-empty value.
 */
export function legacyRecreateArmed(token: string | undefined, stage: string): boolean {
    if (token === undefined || token === '') {
        return false;
    }

    if (token === `${LEGACY_RECREATE_TOKEN_PREFIX}:${stage}`) {
        return true;
    }

    throw new LegacyRecreateTokenError(token, stage);
}

/**
 * The roles that owned a service's base database BEFORE the role split — the only owners the recreate may drop
 * from.
 *
 * - identity: RDS created `kitchensink_identity` for the master (the instance's `databaseName`).
 * - food / recipe: their single `<svc>_app` role migrated AND served, and owned the database. The name survives as
 *   the new data-only service role, which is why the recreate must first take `rds_iam` away from it.
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
    readonly armed: boolean;
}

/** What to do with the base database. */
export type DatabaseDisposition =
    | { readonly kind: 'create' }
    | { readonly kind: 'ready' }
    | { readonly kind: 'adopt' }
    | { readonly kind: 'recreate'; readonly legacyOwner: string }
    | { readonly kind: 'refuse'; readonly reason: string };

/**
 * Decide what to do with a service's base database.
 *
 * @param input - Its catalog row, its emptiness (master-owned only), and whether the recreate is armed.
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
        return input.armed
            ? { kind: 'recreate', legacyOwner: row.owner }
            : {
                  kind: 'refuse',
                  reason:
                      `${database} is owned by ${row.owner}, the legacy owner from before the role split, and the ` +
                      'legacy recreate is not armed on this stage. It will not be dropped without the arming token.',
              };
    }

    return {
        kind: 'refuse',
        reason:
            `${database} is owned by ${row.owner}, which is neither ${roles.owner} nor a legacy owner this bootstrap ` +
            'can name. Refusing to touch it.',
    };
}
