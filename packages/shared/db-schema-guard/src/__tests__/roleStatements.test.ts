import { describe, expect, it } from 'vitest';

import { DATABASE_ROLES, RDS_MASTER_USERNAME, type DatabaseRoles } from '../roles/databaseRoles.js';
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
    /**
     * Role names are constants today, so nothing hostile reaches these statements — but the quoting is PostgreSQL's
     * rule (`pg.escapeIdentifier` / `escapeLiteral`), not a pair of quote marks that only holds while that is true.
     */
    it('escapes an identifier and a role-name literal rather than merely wrapping them', () => {
        const hostile: DatabaseRoles = { owner: 'x"; DROP ROLE y; --', migrator: "o'brien", app: 'food_app' };

        const [createOwner, alterOwner, createMigrator] = roleModelStatements(hostile, { master, isProd: false });

        expect(createOwner).toContain(`CREATE ROLE "x""; DROP ROLE y; --" NOLOGIN`);
        expect(alterOwner).toBe(`ALTER ROLE "x""; DROP ROLE y; --" NOLOGIN NOCREATEDB`);
        expect(createMigrator).toContain(`WHERE rolname = 'o''brien'`);
    });

    it('non-prod: creates the roles, joins the migrator to the owner, and lets the master INHERIT the owner (the reaper drops)', () => {
        expect(roleModelStatements(roles, { master, isProd: false })).toEqual([
            `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'food_owner') THEN CREATE ROLE "food_owner" NOLOGIN; END IF; END $$`,
            'ALTER ROLE "food_owner" NOLOGIN NOCREATEDB',
            `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'food_migrator') THEN CREATE ROLE "food_migrator" LOGIN; END IF; END $$`,
            `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'food_app') THEN CREATE ROLE "food_app" LOGIN; END IF; END $$`,
            `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'food_seeder') THEN CREATE ROLE "food_seeder" LOGIN; END IF; END $$`,
            'ALTER ROLE "food_migrator" CREATEDB',
            'ALTER ROLE "food_app" NOCREATEDB',
            'ALTER ROLE "food_seeder" NOCREATEDB',
            'GRANT "food_owner" TO "food_migrator" WITH INHERIT TRUE, SET TRUE',
            'GRANT "food_owner" TO "identity_app" WITH INHERIT TRUE, SET TRUE',
        ]);
    });

    it('prod: the migrator creates no databases, and the master may SET to the owner but does NOT inherit it', () => {
        const statements = roleModelStatements(roles, { master, isProd: true });

        expect(statements).toContain('ALTER ROLE "food_migrator" NOCREATEDB');
        expect(statements).toContain('ALTER ROLE "food_seeder" NOCREATEDB');
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

    it('⛔ gives the seeder no membership, and makes no role a member of it', () => {
        for (const isProd of [false, true]) {
            const graph = graphOf(roleModelStatements(roles, { master, isProd }));

            expect(graph.filter((edge) => edge.member === 'food_seeder' || edge.role === 'food_seeder')).toEqual([]);
        }
    });
});

describe('iamLoginStatements', () => {
    it('grants rds_iam to every LOGIN role, the seeder included, and never to the owner', () => {
        expect(iamLoginStatements(roles)).toEqual([
            'GRANT rds_iam TO "food_migrator"',
            'GRANT rds_iam TO "food_app"',
            'GRANT rds_iam TO "food_seeder"',
        ]);
    });
});

/**
 * ⛔ Identity's and recipe's statements are pinned byte for byte: adding food's seeder must not change what their
 * bootstrap applies. Their bootstrap still re-runs on the next deploy, because the handler bundle changed and its
 * digest feeds every database's custom resource; the pass is idempotent, so that re-run changes nothing.
 */
describe('identity and recipe — unchanged by the food seeder', () => {
    it.each([
        [
            'identity',
            false,
            [
                `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'identity_owner') THEN CREATE ROLE "identity_owner" NOLOGIN; END IF; END $$`,
                `ALTER ROLE "identity_owner" NOLOGIN NOCREATEDB`,
                `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'identity_migrator') THEN CREATE ROLE "identity_migrator" LOGIN; END IF; END $$`,
                `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'identity_service') THEN CREATE ROLE "identity_service" LOGIN; END IF; END $$`,
                `ALTER ROLE "identity_migrator" CREATEDB`,
                `ALTER ROLE "identity_service" NOCREATEDB`,
                `GRANT "identity_owner" TO "identity_migrator" WITH INHERIT TRUE, SET TRUE`,
                `GRANT "identity_owner" TO "identity_app" WITH INHERIT TRUE, SET TRUE`,
            ],
        ],
        [
            'identity',
            true,
            [
                `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'identity_owner') THEN CREATE ROLE "identity_owner" NOLOGIN; END IF; END $$`,
                `ALTER ROLE "identity_owner" NOLOGIN NOCREATEDB`,
                `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'identity_migrator') THEN CREATE ROLE "identity_migrator" LOGIN; END IF; END $$`,
                `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'identity_service') THEN CREATE ROLE "identity_service" LOGIN; END IF; END $$`,
                `ALTER ROLE "identity_migrator" NOCREATEDB`,
                `ALTER ROLE "identity_service" NOCREATEDB`,
                `GRANT "identity_owner" TO "identity_migrator" WITH INHERIT TRUE, SET TRUE`,
                `GRANT "identity_owner" TO "identity_app" WITH INHERIT FALSE, SET TRUE`,
            ],
        ],
        [
            'recipe',
            false,
            [
                `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'recipe_owner') THEN CREATE ROLE "recipe_owner" NOLOGIN; END IF; END $$`,
                `ALTER ROLE "recipe_owner" NOLOGIN NOCREATEDB`,
                `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'recipe_migrator') THEN CREATE ROLE "recipe_migrator" LOGIN; END IF; END $$`,
                `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'recipe_app') THEN CREATE ROLE "recipe_app" LOGIN; END IF; END $$`,
                `ALTER ROLE "recipe_migrator" CREATEDB`,
                `ALTER ROLE "recipe_app" NOCREATEDB`,
                `GRANT "recipe_owner" TO "recipe_migrator" WITH INHERIT TRUE, SET TRUE`,
                `GRANT "recipe_owner" TO "identity_app" WITH INHERIT TRUE, SET TRUE`,
            ],
        ],
        [
            'recipe',
            true,
            [
                `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'recipe_owner') THEN CREATE ROLE "recipe_owner" NOLOGIN; END IF; END $$`,
                `ALTER ROLE "recipe_owner" NOLOGIN NOCREATEDB`,
                `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'recipe_migrator') THEN CREATE ROLE "recipe_migrator" LOGIN; END IF; END $$`,
                `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'recipe_app') THEN CREATE ROLE "recipe_app" LOGIN; END IF; END $$`,
                `ALTER ROLE "recipe_migrator" NOCREATEDB`,
                `ALTER ROLE "recipe_app" NOCREATEDB`,
                `GRANT "recipe_owner" TO "recipe_migrator" WITH INHERIT TRUE, SET TRUE`,
                `GRANT "recipe_owner" TO "identity_app" WITH INHERIT FALSE, SET TRUE`,
            ],
        ],
    ] as const)('%s (isProd=%s) role statements', (service, isProd, expected) => {
        expect(roleModelStatements(DATABASE_ROLES[service], { master, isProd })).toStrictEqual(expected);
    });

    it.each([
        ['identity', [`GRANT rds_iam TO "identity_migrator"`, `GRANT rds_iam TO "identity_service"`]],
        ['recipe', [`GRANT rds_iam TO "recipe_migrator"`, `GRANT rds_iam TO "recipe_app"`]],
    ] as const)('%s rds_iam grants', (service, expected) => {
        expect(iamLoginStatements(DATABASE_ROLES[service])).toStrictEqual(expected);
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
