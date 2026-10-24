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
import { DEFAULT_PRIVILEGE_HOOK } from './privilegeStatements.js';
import {
    SERVICE_ROLE_TABLE_RIGHTS,
    TABLE_POLICY_RIGHTS,
    policyTables,
    type TablePolicy,
    type TablePrivilege,
} from './tablePolicy.js';
import type { CatalogReader } from '../port.js';

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

/**
 * Every table right the audits compare. The four beyond data access are never granted by a policy, so holding one is
 * drift — a hand-run grant, an old bootstrap's `GRANT ALL`, or membership in `pg_maintain` — and each is more than a
 * data-only role should hold: TRUNCATE bypasses row-level DELETE, REFERENCES lets it pin another table's rows, TRIGGER
 * runs code, and MAINTAIN (PostgreSQL 17) runs VACUUM, REINDEX and LOCK.
 */
const TABLE_RIGHTS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'] as const;

/**
 * Every table right a role holds and should not, or lacks and should have: `$3` maps a table to its exact rights, and
 * `$4` is what every other table should give the role. `has_table_privilege` counts PUBLIC and role membership, so a
 * right that arrives by either is caught too.
 */
const TABLE_RIGHTS_DIFFER = `${OWNERSHIP_AUDIT_MARKER}
SELECT format('%s %s %s %s on table %I', $1::text, $2::text, CASE WHEN held THEN 'holds' ELSE 'lacks' END,
              privilege, relname) AS problem
  FROM (SELECT c.relname, p.privilege, has_table_privilege($2::text, c.oid, p.privilege) AS held,
               p.privilege = ANY (CASE WHEN $3::jsonb ? c.relname
                                       THEN ARRAY(SELECT jsonb_array_elements_text($3::jsonb -> c.relname))
                                       ELSE $4::text[] END) AS expected
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         CROSS JOIN unnest($5::text[]) AS p(privilege)
         WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')) rights
 WHERE held <> expected
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

/** Any right the seeder holds on a view, a foreign table or a sequence: the policy grants it tables only. */
const SEEDER_OTHER_RELATIONS = `${OWNERSHIP_AUDIT_MARKER}
SELECT format('the seeder %s holds %s on %s %I', $1::text, privilege, kind, relname) AS problem
  FROM (SELECT c.relname, p.privilege,
               CASE c.relkind WHEN 'v' THEN 'view' WHEN 'm' THEN 'materialized view' ELSE 'foreign table' END AS kind
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         CROSS JOIN unnest($2::text[]) AS p(privilege)
         WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm', 'f')
           AND has_table_privilege($1::text, c.oid, p.privilege)) relations
UNION ALL
SELECT format('the seeder %s holds %s on sequence %I', $1::text, privilege, c.relname)
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 CROSS JOIN unnest(ARRAY['USAGE', 'SELECT', 'UPDATE']) AS privilege
 WHERE n.nspname = 'public'
   -- CASE, not AND, for the reason APP_LACKS_SEQUENCE gives.
   AND CASE WHEN c.relkind = 'S' THEN has_sequence_privilege($1::text, c.oid, privilege) ELSE false END
 ORDER BY 1`;

/**
 * The seeder's schema rights: its own explicit USAGE on `public`, read from the ACL so that PUBLIC's template USAGE
 * cannot stand in for it, and no CREATE.
 */
const SEEDER_SCHEMA = `${OWNERSHIP_AUDIT_MARKER}
SELECT format('the seeder %s can CREATE in schema public', $1::text) AS problem
 WHERE has_schema_privilege($1::text, 'public', 'CREATE')
UNION ALL
SELECT format('the seeder %s holds no explicit USAGE on schema public', $1::text)
 WHERE NOT EXISTS (SELECT 1 FROM pg_namespace n, aclexplode(n.nspacl) a
                    WHERE n.nspname = 'public' AND a.privilege_type = 'USAGE'
                      AND a.grantee = (SELECT oid FROM pg_roles WHERE rolname = $1::text))`;

/** Prefixes the default-privileges audit, so a test double can tell it from the table audits. */
export const DEFAULT_PRIVILEGES_AUDIT_MARKER = '/* default-privileges-audit */';

/**
 * Every default-privilege entry in the database that the grant-on-create hook does not account for, and every hook
 * entry that is missing. `$1` is the owner, `$2` the service role and `$3` the hook as `[{objtype, privilege}]`. An
 * entry for another role, another schema, every schema (`defaclnamespace = 0`), another grantee or a grant option is
 * extra: a default privilege is a grant to every object created later, so it reaches tables no table audit has seen.
 */
const DEFAULT_PRIVILEGES_DIFFER = `${DEFAULT_PRIVILEGES_AUDIT_MARKER}
WITH held AS (
    SELECT pg_get_userbyid(d.defaclrole)::text AS role, coalesce(n.nspname::text, '') AS schema,
           d.defaclobjtype::text AS objtype,
           CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)::text END AS grantee,
           a.privilege_type AS privilege, a.is_grantable AS grantable
      FROM pg_default_acl d
      LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
     CROSS JOIN LATERAL aclexplode(d.defaclacl) a
), expected AS (
    SELECT $1::text AS role, 'public'::text AS schema, e.objtype, $2::text AS grantee, e.privilege, false AS grantable
      FROM jsonb_to_recordset($3::jsonb) AS e(objtype text, privilege text)
), named AS (
    (SELECT 'extra' AS side, h.* FROM held h EXCEPT SELECT 'extra', e.* FROM expected e)
    UNION ALL
    (SELECT 'missing' AS side, e.* FROM expected e EXCEPT SELECT 'missing', h.* FROM held h)
)
SELECT format('the default privileges of %s %s %s %s %s on new %s%s',
              role, CASE WHEN schema = '' THEN 'in every schema' ELSE format('in schema %I', schema) END,
              CASE side WHEN 'extra' THEN 'give' ELSE 'no longer give' END, grantee, privilege,
              CASE objtype WHEN 'r' THEN 'tables' WHEN 'S' THEN 'sequences' WHEN 'f' THEN 'functions'
                           WHEN 'T' THEN 'types' WHEN 'n' THEN 'schemas' WHEN 'L' THEN 'large objects'
                           ELSE format('objects of kind %s', objtype) END,
              CASE WHEN grantable THEN ' WITH GRANT OPTION' ELSE '' END) AS problem
  FROM named
 ORDER BY 1`;

/** Run audit queries and collect every problem sentence. */
async function collect(
    client: CatalogReader,
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
export async function auditObjectOwners(client: CatalogReader, roles: DatabaseRoles): Promise<readonly string[]> {
    return collect(client, [[NOT_OWNED_BY_OWNER, [roles.owner]]]);
}

/**
 * Each policy table's exact rights for one role, as the JSON object {@link TABLE_RIGHTS_DIFFER} reads.
 *
 * @param policy - The table policy.
 * @param role - Whose rights.
 * @param extra - Tables outside the policy with rights of their own.
 * @returns The JSON text. Pure.
 */
function expectedRights(
    policy: TablePolicy,
    role: 'app' | 'seeder',
    extra: Readonly<Record<string, readonly TablePrivilege[]>> = {},
): string {
    // Built from entries, never a literal accumulator, so a table named `__proto__` is stored, not dropped.
    const byTable: Record<string, readonly TablePrivilege[]> = Object.fromEntries([
        ...Object.entries(extra),
        ...policyTables(policy).map(({ table, set }) => [table, TABLE_POLICY_RIGHTS[set][role]] as const),
    ]);

    return JSON.stringify(byTable);
}

/**
 * What the service role may do — and nothing more: on each table exactly its policy set's rights, read-only on the
 * migration ledger, DML on every other table; SELECT on views; USAGE on sequences; no TRUNCATE/REFERENCES/TRIGGER on
 * any table and no CREATE in `public`. Run AFTER the after-migration grants.
 *
 * @param client - A connection to the migrated database.
 * @param roles - The database's roles.
 * @param policy - The database's table policy.
 * @returns One sentence per missing or excess privilege; empty when the service role is exactly data-only.
 * @sideEffect Reads the system catalogs.
 */
export async function auditServicePrivileges(
    client: CatalogReader,
    roles: DatabaseRoles,
    policy: TablePolicy,
): Promise<readonly string[]> {
    const expected = expectedRights(policy, 'app', { [MIGRATION_LEDGER_TABLE]: ['SELECT'] });

    return collect(client, [
        [TABLE_RIGHTS_DIFFER, ['the service role', roles.app, expected, SERVICE_ROLE_TABLE_RIGHTS, TABLE_RIGHTS]],
        [APP_CAN_CREATE_IN_SCHEMA, [roles.app]],
        [APP_CANNOT_READ_VIEW, [roles.app]],
        [APP_LACKS_SEQUENCE, [roles.app]],
    ]);
}

/**
 * What the seeder may do — and nothing more (curated catalog plan KTD-18): on each policy table exactly its set's
 * rights; no right on the migration ledger, another table, a view or a sequence; its own explicit USAGE on `public`
 * and no CREATE. Run AFTER the after-migration grants.
 *
 * @param client - A connection to the migrated database.
 * @param roles - The database's roles.
 * @param policy - The database's table policy.
 * @returns One sentence per missing or excess privilege; empty when the database has no seeder.
 * @sideEffect Reads the system catalogs.
 */
export async function auditSeederPrivileges(
    client: CatalogReader,
    roles: DatabaseRoles,
    policy: TablePolicy,
): Promise<readonly string[]> {
    if (roles.seeder === undefined) {
        return [];
    }

    return collect(client, [
        [TABLE_RIGHTS_DIFFER, ['the seeder', roles.seeder, expectedRights(policy, 'seeder'), [], TABLE_RIGHTS]],
        [SEEDER_OTHER_RELATIONS, [roles.seeder, TABLE_RIGHTS]],
        [SEEDER_SCHEMA, [roles.seeder]],
    ]);
}

/**
 * That the database's default privileges are exactly the grant-on-create hook ({@link DEFAULT_PRIVILEGE_HOOK}): the
 * owner's, in `public`, to the service role, nothing more and nothing missing. The table audits read the objects that
 * exist; this reads what every object created later will be given.
 *
 * @param client - A connection to the migrated database.
 * @param roles - The database's roles.
 * @returns One sentence per extra or missing entry; empty when the default privileges are the hook.
 * @sideEffect Reads the system catalogs.
 */
export async function auditDefaultPrivileges(client: CatalogReader, roles: DatabaseRoles): Promise<readonly string[]> {
    const hook = DEFAULT_PRIVILEGE_HOOK.flatMap(({ objtype, rights }) =>
        rights.map((privilege) => ({ objtype, privilege })),
    );

    return collect(client, [[DEFAULT_PRIVILEGES_DIFFER, [roles.owner, roles.app, JSON.stringify(hook)]]]);
}
