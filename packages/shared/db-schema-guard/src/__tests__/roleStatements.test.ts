import { describe, expect, it } from 'vitest';

import { DATABASE_ROLES, RDS_MASTER_USERNAME } from '../roles/databaseRoles.js';
import { pathsToRole, type MembershipEdge } from '../roles/roleGraph.js';
import { iamLoginStatements, roleModelStatements } from '../roles/roleStatements.js';

const roles = DATABASE_ROLES.food;
const master = RDS_MASTER_USERNAME;

/**
 * Fold the GRANT statements into the membership graph they would create, so the "master never reaches rds_iam"
 * property is checked against what the statements DO, not against a description of them.
 */
function graphOf(statements: readonly string[]): readonly MembershipEdge[] {
    return statements.flatMap((sql) => {
        const match = /^GRANT "?(\w+)"? TO "?(\w+)"?(?: WITH INHERIT (TRUE|FALSE), SET (TRUE|FALSE))?$/u.exec(sql);

        if (match === null) {
            return [];
        }

        const [, role = '', member = '', inherit, set] = match;

        return [{ member, role, admin: false, inherit: inherit !== 'FALSE', set: set !== 'FALSE' }];
    });
}

describe('roleModelStatements', () => {
    it('non-prod: creates the three roles, joins the migrator to the owner, and lets the master INHERIT the owner (the reaper drops)', () => {
        expect(roleModelStatements(roles, { master, isProd: false })).toEqual([
            `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'food_owner') THEN CREATE ROLE "food_owner" NOLOGIN; END IF; END $$`,
            'ALTER ROLE "food_owner" NOLOGIN NOCREATEDB',
            `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'food_migrator') THEN CREATE ROLE "food_migrator" LOGIN; END IF; END $$`,
            `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'food_app') THEN CREATE ROLE "food_app" LOGIN; END IF; END $$`,
            'ALTER ROLE "food_migrator" CREATEDB',
            'ALTER ROLE "food_app" NOCREATEDB',
            'GRANT "food_owner" TO "food_migrator" WITH INHERIT TRUE, SET TRUE',
            'GRANT "food_owner" TO "identity_app" WITH INHERIT TRUE, SET TRUE',
        ]);
    });

    it('prod: the migrator creates no databases, and the master may SET to the owner but does NOT inherit it', () => {
        const statements = roleModelStatements(roles, { master, isProd: true });

        expect(statements).toContain('ALTER ROLE "food_migrator" NOCREATEDB');
        expect(statements).toContain('GRANT "food_owner" TO "identity_app" WITH INHERIT FALSE, SET TRUE');
        expect(statements).not.toContain('ALTER ROLE "food_migrator" CREATEDB');
    });

    it('never grants rds_iam — that is a separate, gated step', () => {
        for (const isProd of [false, true]) {
            expect(roleModelStatements(roles, { master, isProd }).join('\n')).not.toMatch(/rds_iam/u);
        }
    });

    it('gives the service role no membership in the owner or the migrator', () => {
        const graph = graphOf(roleModelStatements(roles, { master, isProd: false }));

        expect(graph.filter((edge) => edge.member === roles.app)).toEqual([]);
    });
});

describe('iamLoginStatements', () => {
    it('grants rds_iam to the two LOGIN roles, and never to the owner', () => {
        expect(iamLoginStatements(roles)).toEqual(['GRANT rds_iam TO "food_migrator"', 'GRANT rds_iam TO "food_app"']);
    });
});

describe('⛔ the statements, applied together, never put the master on a chain to rds_iam', () => {
    it.each([false, true])('isProd=%s', (isProd) => {
        const all = [...roleModelStatements(roles, { master, isProd }), ...iamLoginStatements(roles)];

        // Sanity: the graph is not empty, and the LOGIN roles DO reach rds_iam — so an empty answer for the
        // master is a finding, not a parser that saw nothing.
        expect(pathsToRole(graphOf(all), roles.app, 'rds_iam')).toEqual([[roles.app, 'rds_iam']]);
        expect(pathsToRole(graphOf(all), roles.migrator, 'rds_iam')).toEqual([[roles.migrator, 'rds_iam']]);
        expect(pathsToRole(graphOf(all), master, 'rds_iam')).toEqual([]);
    });
});

describe('the other databases', () => {
    it.each(Object.entries(DATABASE_ROLES))('%s never reaches rds_iam from the master either', (_service, dbRoles) => {
        const all = [...roleModelStatements(dbRoles, { master, isProd: false }), ...iamLoginStatements(dbRoles)];

        expect(pathsToRole(graphOf(all), master, 'rds_iam')).toEqual([]);
    });
});
