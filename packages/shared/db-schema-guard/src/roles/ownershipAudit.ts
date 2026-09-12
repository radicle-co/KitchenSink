/**
 * The post-migration ownership and privilege audit: after every migration run, prove from the CATALOG that the
 * database is in the role split's shape.
 *
 * ⚠️ `pg_class` / `pg_proc` / `pg_type`, NEVER `information_schema`: `information_schema` only shows objects the
 * CURRENT user has privileges on, so an object the service role cannot see would be invisible to the very check
 * asking whether it can see it.
 *
 * Every query selects the OFFENDING objects, one `problem` sentence per row, so an empty answer is a clean
 * database — the shape that also keeps a test double honest (no rows, no violations).
 *
 * DESIGN PATTERN: Design-by-contract postcondition, run by the engine's `validate`.
 */
import { MIGRATION_LEDGER_TABLE, type DatabaseRoles } from './databaseRoles.js';
import type { MigrationClient } from '../port.js';

/** Prefixes every audit query, so a test double can recognise them. */
export const OWNERSHIP_AUDIT_MARKER = '/* ownership-audit */';

/**
 * Relations, functions and types that are not owned by the owner role.
 *
 * ⚠️ Extension MEMBER objects are excluded (`pg_depend` type `e`). Installing a TRUSTED extension (`pg_trgm`,
 * `citext`, `pgcrypto` — all used here) as a non-superuser makes its member objects owned by the BOOTSTRAP
 * superuser (`rdsadmin` on RDS), not by the role that ran `CREATE EXTENSION` — so they are not ours to own and must
 * not read as a violation.
 */
const NOT_OWNED_BY_OWNER = `${OWNERSHIP_AUDIT_MARKER}
SELECT format('%s %I is owned by %s, not %s', kind, name, pg_get_userbyid(owner), $1::text) AS problem
  FROM (
        SELECT CASE c.relkind WHEN 'S' THEN 'sequence' WHEN 'v' THEN 'view' WHEN 'm' THEN 'materialized view'
                              ELSE 'table' END AS kind, c.relname AS name, c.relowner AS owner
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
           AND NOT EXISTS (SELECT 1 FROM pg_depend d
                            WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
        UNION ALL
        SELECT 'function', p.proname, p.proowner
          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND NOT EXISTS (SELECT 1 FROM pg_depend d
                            WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
        UNION ALL
        SELECT 'type', t.typname, t.typowner
          FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
         WHERE n.nspname = 'public' AND t.typrelid = 0 AND t.typelem = 0
           AND NOT EXISTS (SELECT 1 FROM pg_depend d
                            WHERE d.classid = 'pg_type'::regclass AND d.objid = t.oid AND d.deptype = 'e')
       ) objects
 WHERE owner <> (SELECT oid FROM pg_roles WHERE rolname = $1::text)
 ORDER BY 1`;

/** Tables the service role cannot read and write — every one except the ledger. */
const APP_LACKS_DML = `${OWNERSHIP_AUDIT_MARKER}
SELECT format('the service role %s lacks %s on table %I', $1::text, missing, c.relname) AS problem
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS missing
 WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname <> $2::text
   AND NOT has_table_privilege($1::text, c.oid, missing)
 ORDER BY 1`;

/**
 * Table rights BEYOND data access. `privilegesAfterApply` grants exactly SELECT/INSERT/UPDATE/DELETE, so any of these
 * came from drift — a hand-run grant, or an old bootstrap's `GRANT ALL` — and each is more than a data-only role
 * should hold: TRUNCATE bypasses row-level DELETE, REFERENCES lets it pin another table's rows, TRIGGER runs code.
 */
const APP_EXCESS_TABLE_RIGHTS = `${OWNERSHIP_AUDIT_MARKER}
SELECT format('the service role %s holds %s on table %I', $1::text, excess, c.relname) AS problem
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 CROSS JOIN unnest(ARRAY['TRUNCATE', 'REFERENCES', 'TRIGGER']) AS excess
 WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
   AND has_table_privilege($1::text, c.oid, excess)
 ORDER BY 1`;

/** The service role must not be able to create objects in `public` — that is DDL. */
const APP_CAN_CREATE_IN_SCHEMA = `${OWNERSHIP_AUDIT_MARKER}
SELECT format('the service role %s can CREATE in schema public', $1::text) AS problem
 WHERE has_schema_privilege($1::text, 'public', 'CREATE')`;

/** Views the service role cannot read. */
const APP_CANNOT_READ_VIEW = `${OWNERSHIP_AUDIT_MARKER}
SELECT format('the service role %s cannot SELECT view %I', $1::text, c.relname) AS problem
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm') AND NOT has_table_privilege($1::text, c.oid, 'SELECT')
 ORDER BY 1`;

/** Sequences the service role cannot advance. */
const APP_LACKS_SEQUENCE = `${OWNERSHIP_AUDIT_MARKER}
SELECT format('the service role %s lacks USAGE on sequence %I', $1::text, c.relname) AS problem
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   -- CASE, not AND: PostgreSQL does not promise to evaluate WHERE clauses in order, and has_sequence_privilege
   -- RAISES on a relation that is not a sequence (observed: it was handed a TOAST table).
   AND CASE WHEN c.relkind = 'S' THEN NOT has_sequence_privilege($1::text, c.oid, 'USAGE') ELSE false END
 ORDER BY 1`;

/** The ledger must be readable (the boot guard reads it) and not writable by the service role. */
const LEDGER_ACCESS = `${OWNERSHIP_AUDIT_MARKER}
SELECT format('the service role %s holds %s on the migration ledger %I', $1::text, privilege, $2::text) AS problem
  FROM unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) AS privilege
 WHERE has_table_privilege($1::text, format('public.%I', $2::text), privilege)
UNION ALL
SELECT format('the service role %s cannot SELECT the migration ledger %I', $1::text, $2::text)
 WHERE NOT has_table_privilege($1::text, format('public.%I', $2::text), 'SELECT')`;

/** Run audit queries and collect every problem sentence. */
async function collect(
    client: MigrationClient,
    queries: readonly (readonly [string, readonly unknown[]])[],
): Promise<readonly string[]> {
    const problems: string[] = [];

    for (const [sql, values] of queries) {
        const result = await client.query<{ problem: string }>(sql, [...values]);

        problems.push(...result.rows.map((row) => row.problem));
    }

    return problems;
}

/**
 * Every object in `public` not owned by the owner role (extension members excepted).
 *
 * ⚠️ Run BEFORE the after-migration grants: `GRANT … ON ALL TABLES` issued as the owner fails with a bare
 * "permission denied for table x" on a table the owner does not own, which names the symptom and hides the cause.
 * Checking ownership first turns that into "table x is owned by <login>, not <owner>".
 *
 * @param client - A connection to the migrated database.
 * @param roles - The database's roles.
 * @returns One sentence per offending object; empty when every object is the owner's.
 * @sideEffect Reads the system catalogs.
 */
export async function auditObjectOwners(client: MigrationClient, roles: DatabaseRoles): Promise<readonly string[]> {
    return collect(client, [[NOT_OWNED_BY_OWNER, [roles.owner]]]);
}

/**
 * What the service role may do — and nothing more: DML on every table but the ledger, SELECT on views, USAGE on
 * sequences, the ledger read-only; and no TRUNCATE/REFERENCES/TRIGGER on any table and no CREATE in `public`. Run
 * AFTER the after-migration grants.
 *
 * @param client - A connection to the migrated database.
 * @param roles - The database's roles.
 * @returns One sentence per missing or excess privilege; empty when the service role is exactly data-only.
 * @sideEffect Reads the system catalogs.
 */
export async function auditServicePrivileges(
    client: MigrationClient,
    roles: DatabaseRoles,
): Promise<readonly string[]> {
    return collect(client, [
        [APP_LACKS_DML, [roles.app, MIGRATION_LEDGER_TABLE]],
        [APP_EXCESS_TABLE_RIGHTS, [roles.app]],
        [APP_CAN_CREATE_IN_SCHEMA, [roles.app]],
        [APP_CANNOT_READ_VIEW, [roles.app]],
        [APP_LACKS_SEQUENCE, [roles.app]],
        [LEDGER_ACCESS, [roles.app, MIGRATION_LEDGER_TABLE]],
    ]);
}
