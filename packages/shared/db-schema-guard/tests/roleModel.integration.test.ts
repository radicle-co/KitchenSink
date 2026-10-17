/**
 * The role model's statement ORDER, swept over the whole registry (curated catalog plan U18, ADR-0039 §8).
 *
 * For every database: the roles and memberships first, then a re-read of the membership graph, and only then
 * `rds_iam` — to exactly that database's login roles, never the owner. A mocked catalog client records the statements;
 * the real server is `packages/infra/global/tests/e2e/seederBootstrap.e2e.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import {
    DATABASE_ROLES,
    RDS_IAM,
    RDS_MASTER_USERNAME,
    applyRoleModel,
    databaseRoleNames,
    loginRoles,
    type CatalogReader,
    type DatabaseRoles,
    type MembershipEdge,
} from '../src/index.js';

/** A catalog in which the model already holds, recording every statement sent to it. */
function healthyCatalog(roles: DatabaseRoles): CatalogReader & { sql: string[] } {
    const sql: string[] = [];
    const edge = (member: string, role: string): MembershipEdge => ({
        member,
        role,
        admin: false,
        inherit: true,
        set: true,
    });
    const edges = [
        edge(roles.migrator, roles.owner),
        edge(RDS_MASTER_USERNAME, roles.owner),
        ...loginRoles(roles).map((login) => edge(login, RDS_IAM)),
    ];
    const rows = databaseRoleNames(roles).map((rolname) => ({
        rolname,
        rolcanlogin: rolname !== roles.owner,
        rolcreatedb: rolname === roles.migrator,
    }));

    return {
        sql,
        query: async <Row>(text: string) => {
            sql.push(text);

            if (text.includes('FROM pg_auth_members')) {
                return { rows: edges as unknown as Row[] };
            }

            if (text.includes('FROM pg_roles WHERE rolname = ANY')) {
                return { rows: rows as unknown as Row[] };
            }

            return { rows: [] };
        },
    };
}

describe('applyRoleModel over every database in the registry', () => {
    it.each(Object.entries(DATABASE_ROLES))(
        '%s: roles, then the re-read, then rds_iam to its logins only',
        async (_service, roles) => {
            const catalog = healthyCatalog(roles);

            await applyRoleModel(catalog, { roles, context: { master: RDS_MASTER_USERNAME, isProd: false } });

            const reread = catalog.sql.findIndex((sql) => sql.includes('FROM pg_auth_members'));
            const grants = catalog.sql.flatMap((sql, index) =>
                sql.startsWith('GRANT rds_iam') ? [{ sql, index }] : [],
            );
            const lastRoleStatement = Math.max(
                ...catalog.sql.flatMap((sql, index) => (/CREATE ROLE|^ALTER ROLE|^GRANT "/u.test(sql) ? [index] : [])),
            );

            expect(reread).toBeGreaterThan(lastRoleStatement);
            expect(grants.every((grant) => grant.index > reread)).toBe(true);
            expect(grants.map((grant) => grant.sql)).toStrictEqual(
                loginRoles(roles).map((login) => `GRANT rds_iam TO "${login}"`),
            );
            expect(grants.map((grant) => grant.sql).join('\n')).not.toContain(roles.owner);
        },
    );
});
