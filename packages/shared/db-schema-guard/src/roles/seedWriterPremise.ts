/**
 * The premises of the catalog trigger's writer reading, re-read from the catalog after every migration run (curated
 * catalog plan KTD-12, KTD-13).
 *
 * Food's trigger decides who is writing from privileges, by `session_user` (`catalog_writer` in
 * `food-service/src/db/migrations/0018_food_catalog_items_roots_variants.sql`): a member of the table's owner is the
 * owner, a holder of INSERT on the seed ledger is the seeder, anyone else is neither. Those readings are only true
 * while two facts hold, and nothing else checks either:
 *
 * - **Only the seeder can write the ledger.** For each service-read-only table, no LOGIN role that can CONNECT, other
 *   than the seeder and the owner's members, can INSERT into it by any route: its own grant, a column grant, PUBLIC,
 *   or a role it can become through any membership row. This is wider than the trigger's own test
 *   (`has_table_privilege` on the session user), so when it holds, the trigger's 'seeder' can only be the seeder.
 * - **The seeder is no member of the owner.** Read with `pg_has_role(…, 'MEMBER')`, the trigger's own predicate. On
 *   PostgreSQL 18 it counts every `pg_auth_members` row, ADMIN-only and SET-only included, through any chain, and is
 *   true for a superuser (measured 2026-10-02), so it is also ADR-0039's every-row reading.
 *
 * Both are about roles, which change outside any migration, so the runner reads them on every run, not only on a run
 * that applied something. Each query selects the offending rows, one `problem` sentence each, so empty is clean.
 *
 * DESIGN PATTERN: Design-by-contract precondition of the trigger, run by the engine's `validate`.
 */
import type { DatabaseRoles } from './databaseRoles.js';
import type { TablePolicy } from './tablePolicy.js';
import type { CatalogReader } from '../port.js';

/** Prefixes every premise query, so a test double can recognise them. */
export const SEED_WRITER_PREMISE_MARKER = '/* seed-writer-premise */';

/**
 * Logins other than the seeder that can INSERT into a service-read-only table. `$1` is the seeder, `$2` the owner and
 * `$3` the tables. `pg_has_role(l, r, 'MEMBER')` is true for `r = l`, so the login's own and PUBLIC's grants count too.
 */
const LEDGER_WRITERS = `${SEED_WRITER_PREMISE_MARKER}
SELECT format('the login %s can INSERT into %I, which only the seeder %s may write', l.rolname, t.relname,
              $1::text) AS problem
  FROM pg_roles l
 CROSS JOIN pg_class t
  JOIN pg_namespace n ON n.oid = t.relnamespace
 WHERE n.nspname = 'public' AND t.relkind IN ('r', 'p') AND t.relname = ANY ($3::text[])
   AND l.rolcanlogin
   AND l.rolname <> $1::text
   AND has_database_privilege(l.oid, current_database(), 'CONNECT')
   AND NOT pg_has_role(l.oid, $2::name, 'MEMBER')
   AND EXISTS (SELECT 1 FROM pg_roles r
                WHERE pg_has_role(l.oid, r.oid, 'MEMBER') AND has_any_column_privilege(r.oid, t.oid, 'INSERT'))
 ORDER BY 1`;

/** The seeder as a member of the owner, by the trigger's own predicate. `$1` is the seeder, `$2` the owner. */
const SEEDER_IN_OWNER = `${SEED_WRITER_PREMISE_MARKER}
SELECT format('the seeder %s is a member of the owner %s (or a superuser), so the catalog trigger reads its writes '
              'as the owner''s', $1::text, $2::text) AS problem
 WHERE pg_has_role($1::name, $2::name, 'MEMBER')`;

/**
 * Every login other than the seeder that can INSERT into a service-read-only table.
 *
 * @param client - A connection to the migrated database.
 * @param roles - The database's roles.
 * @param policy - Its table policy.
 * @returns One sentence per login and table; empty when the database has no seeder or no such table.
 * @sideEffect Reads the system catalogs.
 */
export async function auditLedgerWriters(
    client: CatalogReader,
    roles: DatabaseRoles,
    policy: TablePolicy,
): Promise<readonly string[]> {
    if (roles.seeder === undefined || policy.serviceReadOnly.size === 0) {
        return [];
    }

    const result = await client.query<{ problem: string }>(LEDGER_WRITERS, [
        roles.seeder,
        roles.owner,
        [...policy.serviceReadOnly].sort(),
    ]);

    return result.rows.map((row) => row.problem);
}

/**
 * Whether the seeder is a member of the owner, by the predicate the catalog trigger uses.
 *
 * @param client - A connection to any database on the instance (roles are cluster-wide).
 * @param roles - The database's roles.
 * @returns One sentence when it is; empty when it is not or the database has no seeder.
 * @sideEffect Reads the system catalogs.
 */
export async function auditSeederOwnerMembership(
    client: CatalogReader,
    roles: DatabaseRoles,
): Promise<readonly string[]> {
    if (roles.seeder === undefined) {
        return [];
    }

    const result = await client.query<{ problem: string }>(SEEDER_IN_OWNER, [roles.seeder, roles.owner]);

    return result.rows.map((row) => row.problem);
}
