/**
 * @module db-bootstrap/legacyRecreate — the ONE-SHOT recreate of a base database from before the role split.
 *
 * ⛔ DESTRUCTIVE, AND ONLY FOR THIS RELEASE. The owner ruled (2026-09-11, rulings 1, 2 and 8 of
 * `docs/plans/2026-09-11-database-role-split.md`) that nothing is live and the data is disposable, so each base
 * database is DROPPED and recreated owned by `<svc>_owner` rather than transferred. It runs only when
 * `decideDisposition` says `recreate` — armed by a stage-scoped token AND owned by a role that module can name as
 * the legacy owner — and a disarm commit removes the token.
 *
 * ## Why the master has to join the app role, and why that is the dangerous moment
 *
 * `food_app` / `recipe_app` own their base databases, and only an owner (or a member of one) may drop a database.
 * The master is not a member. But those roles hold `rds_iam`, and the master joining ANY role that reaches
 * `rds_iam` is the lock-out. So the order is fixed and every step is re-checked:
 *
 * 1. preflight — the master holds ADMIN on the app role and on `rds_iam`, and CREATEDB; otherwise refuse, having
 *    changed nothing;
 * 2. `REVOKE rds_iam FROM <app>` — every grantor's row — then RE-READ: if ANY row or path from the app to `rds_iam`
 *    survives, refuse BEFORE the master joins it (the negative control in the integration tier);
 * 3. `GRANT <app> TO <master> WITH INHERIT TRUE, SET FALSE` — INHERIT is what DROP needs; SET is withheld;
 * 4. `DROP DATABASE … WITH (FORCE)`; outside prod, re-own the legacy per-PR databases to `<svc>_owner`, so the reaper
 *    (whose master INHERITs the owner outside prod) can drop them later — the reaper stays the only thing that drops
 *    a per-PR database;
 * 5. `finally`: take the master back out and prove it from the catalog. `rds_iam` stays revoked here; the pass
 *    re-grants it through `applyRoleModel`, which refuses while the master has any path into the app role.
 *
 * The identity database is simpler: the master owns it, so it is dropped directly.
 *
 * No transaction wraps any of it — `DROP DATABASE` cannot run inside one.
 */
import {
    pathsToRole,
    readMembershipEdges,
    type CatalogReader,
    type DatabaseRoles,
    type LockOutEdges,
} from '@kitchensink/db-schema-guard';

import { BootstrapRefusedError } from './bootstrapRefusedError.js';
import { releaseMasterFrom, revokeMembership } from './masterMembership.js';
import { perPrLikePattern } from './perPrInventory.js';

const RDS_IAM = 'rds_iam';

/** What the recreate did. */
export interface RecreateReport {
    readonly dropped: string;
    /** Legacy per-PR databases handed to the owner role (non-prod only), sorted. */
    readonly reowned: readonly string[];
    /** Legacy per-PR databases left alone because an interrupted DROP left them invalid. */
    readonly skippedDraining: readonly string[];
}

/** What {@link recreateLegacyDatabase} needs. */
export interface RecreateInput {
    readonly roles: DatabaseRoles;
    readonly database: string;
    readonly master: string;
    readonly isProd: boolean;
    /** Who owns it now — the master (identity) or the legacy app role (food, recipe). */
    readonly legacyOwner: string;
    /** How the master's release is judged; `every-row` unless the caller is a vanilla-PostgreSQL stand-in. */
    readonly lockOutEdges?: LockOutEdges;
}

/**
 * Whether `name` is one of `base`'s per-PR children, `<base>_pr_<digits>` exactly.
 *
 * @param base - The base database.
 * @param name - A database name.
 * @returns The verdict. Pure.
 */
export function isPerPrChildOf(base: string, name: string): boolean {
    const prefix = `${base}_pr_`;

    return name.startsWith(prefix) && /^[0-9]+$/u.test(name.slice(prefix.length));
}

/**
 * Refuse before changing anything unless the master can complete every step.
 *
 * @sideEffect Reads the catalog.
 */
async function preflight(session: CatalogReader, app: string): Promise<void> {
    const [row] = (
        await session.query<{ app_admin: boolean | null; iam_admin: boolean | null; createdb: boolean }>(
            `SELECT (SELECT pg_has_role(current_user, oid, 'MEMBER WITH ADMIN OPTION') FROM pg_roles WHERE rolname = $1) AS app_admin,
                    (SELECT pg_has_role(current_user, oid, 'MEMBER WITH ADMIN OPTION') FROM pg_roles WHERE rolname = $2) AS iam_admin,
                    (SELECT rolcreatedb FROM pg_roles WHERE rolname = current_user) AS createdb`,
            [app, RDS_IAM],
        )
    ).rows;

    const missing = [
        row?.app_admin !== true && `ADMIN on ${app}`,
        row?.iam_admin !== true && `ADMIN on ${RDS_IAM}`,
        row?.createdb !== true && 'CREATEDB',
    ].filter((item): item is string => typeof item === 'string');

    if (missing.length > 0) {
        throw new BootstrapRefusedError(
            `the master lacks ${missing.join(', ')}, which the legacy recreate needs; nothing was changed`,
        );
    }
}

/**
 * Take `rds_iam` away from the legacy app role, and prove it cannot reach `rds_iam` any other way.
 *
 * ⛔ Judged by the CONSERVATIVE reading, whatever the stage: ANY surviving `pg_auth_members` row from the app role to
 * `rds_iam` — ADMIN-only included — and any path over every row, and any grant that could not be revoked, is a
 * refusal. This guards the most dangerous statement in the change (joining the master to the role next), so it does
 * not relax for anyone.
 *
 * @sideEffect Revokes `rds_iam` memberships.
 * @throws {BootstrapRefusedError} when anything could still carry the master to `rds_iam`; nothing has been granted
 *   to the master.
 */
async function revokeIamFrom(session: CatalogReader, app: string): Promise<void> {
    const refusals = await revokeMembership(session, RDS_IAM, app);
    const paths = pathsToRole(await readMembershipEdges(session), app, RDS_IAM).map((path) => path.join(' → '));

    if (paths.length > 0 || refusals.length > 0) {
        throw new BootstrapRefusedError(
            `${app} may still reach ${RDS_IAM} after the REVOKE (${[...paths, ...refusals].join('; ')}), so joining ` +
                'the master to it could lock the master out. Nothing was granted to the master.',
        );
    }
}

/**
 * Drop the legacy base database (and, outside prod, hand its per-PR children to the owner role).
 *
 * @param session - A connection as the master, on the maintenance database.
 * @param input - The database, its roles, and its legacy owner.
 * @returns What was dropped and re-owned.
 * @throws {BootstrapRefusedError} when a precondition fails, before anything is changed.
 * @sideEffect Revokes and grants role memberships, drops a database and re-owns others.
 */
export async function recreateLegacyDatabase(session: CatalogReader, input: RecreateInput): Promise<RecreateReport> {
    const { roles, database, master } = input;

    if (input.legacyOwner === master) {
        await session.query(`DROP DATABASE "${database}" WITH (FORCE)`);

        return { dropped: database, reowned: [], skippedDraining: [] };
    }

    if (input.legacyOwner !== roles.app) {
        throw new BootstrapRefusedError(
            `the legacy recreate knows how to drop from ${master} or ${roles.app}, not ${input.legacyOwner}`,
        );
    }

    const app = roles.app;

    await preflight(session, app);
    await revokeIamFrom(session, app);

    let report: RecreateReport | undefined;
    let failure: unknown;

    try {
        await session.query(`GRANT "${app}" TO "${master}" WITH INHERIT TRUE, SET FALSE`);
        await session.query(`DROP DATABASE "${database}" WITH (FORCE)`);

        const reowned: string[] = [];
        const skippedDraining: string[] = [];

        if (!input.isProd) {
            const children = (
                await session.query<{ datname: string; datconnlimit: number }>(
                    `SELECT datname, datconnlimit FROM pg_database
                      WHERE datname LIKE $1 ESCAPE '\\' AND pg_get_userbyid(datdba) = $2
                      ORDER BY datname`,
                    [perPrLikePattern(database), app],
                )
            ).rows.filter((row) => isPerPrChildOf(database, row.datname));

            for (const child of children) {
                if (child.datconnlimit === -2) {
                    skippedDraining.push(child.datname);
                } else {
                    await session.query(`ALTER DATABASE "${child.datname}" OWNER TO "${roles.owner}"`);
                    reowned.push(child.datname);
                }
            }
        }

        report = { dropped: database, reowned, skippedDraining };
    } catch (error) {
        failure = error;
    }

    try {
        await releaseMasterFrom(session, master, [app], input.lockOutEdges);
    } catch (releaseError) {
        // Both matter: the release failure is the one an operator must act on first.
        throw failure === undefined ? releaseError : new AggregateError([releaseError, failure], String(releaseError));
    }

    if (failure !== undefined) {
        throw failure;
    }

    return report as RecreateReport;
}
