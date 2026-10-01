import { describe, expect, it } from 'vitest';

import {
    DATABASE_ROLES,
    MIGRATION_LEDGER_TABLE,
    RDS_MASTER_USERNAME,
    databaseRoleNames,
    loginRoles,
    loginRolesByKey,
} from '../roles/databaseRoles.js';
import { privilegesAfterApply, privilegesBeforeApply } from '../roles/privilegeStatements.js';
import type { TablePolicy } from '../roles/tablePolicy.js';

const allRoles = Object.values(DATABASE_ROLES).flatMap((roles) => databaseRoleNames(roles));

describe('DATABASE_ROLES — the one registry of who owns, migrates and serves each database', () => {
    it('names every role safely enough to be quoted into SQL', () => {
        // Role names cannot be bound parameters in GRANT/ALTER statements; this pattern is what makes the
        // quoting in the statement builders safe.
        for (const role of allRoles) {
            expect(role).toMatch(/^[a-z_]+$/u);
        }
    });

    it('gives every database DISTINCT roles, and no role to two databases', () => {
        expect(new Set(allRoles).size).toBe(allRoles.length);
    });

    it('⛔ never names a role after the RDS master login', () => {
        // The master is `identity_app` — a historical name that reads like identity's app role and is not. A
        // registry entry spelled `identity_app` would hand the service the MASTER credential's identity, and
        // granting it `rds_iam` would lock the master out (AWS: rds_iam forces IAM auth on the master too).
        expect(RDS_MASTER_USERNAME).toBe('identity_app');
        expect(allRoles).not.toContain(RDS_MASTER_USERNAME);
    });

    it('covers exactly the three databases the platform creates', () => {
        expect(Object.keys(DATABASE_ROLES).sort()).toEqual(['food', 'identity', 'recipe']);
    });

    it('gives food, and only food, a seeder (curated catalog plan U18, KTD-18)', () => {
        expect(DATABASE_ROLES.food.seeder).toBe('food_seeder');
        expect('seeder' in DATABASE_ROLES.identity).toBe(false);
        expect('seeder' in DATABASE_ROLES.recipe).toBe(false);
    });
});

describe('the role projections — every list of roles is derived from the registry, never typed out', () => {
    it('names every role of a database, the seeder last', () => {
        expect(databaseRoleNames(DATABASE_ROLES.food)).toStrictEqual([
            'food_owner',
            'food_migrator',
            'food_app',
            'food_seeder',
        ]);
        expect(databaseRoleNames(DATABASE_ROLES.identity)).toStrictEqual([
            'identity_owner',
            'identity_migrator',
            'identity_service',
        ]);
    });

    it('⛔ names every LOGIN role and never the owner — the list rds_iam and CONNECT are granted over', () => {
        expect(loginRoles(DATABASE_ROLES.food)).toStrictEqual(['food_migrator', 'food_app', 'food_seeder']);
        expect(loginRoles(DATABASE_ROLES.recipe)).toStrictEqual(['recipe_migrator', 'recipe_app']);

        for (const roles of Object.values(DATABASE_ROLES)) {
            expect(loginRoles(roles)).not.toContain(roles.owner);
        }
    });

    it('keys every login role by the part it plays, and the keys are every role of the entry but the owner', () => {
        expect([...loginRolesByKey(DATABASE_ROLES.food)]).toStrictEqual([
            ['migrator', 'food_migrator'],
            ['app', 'food_app'],
            ['seeder', 'food_seeder'],
        ]);

        for (const roles of Object.values(DATABASE_ROLES)) {
            const byKey = loginRolesByKey(roles);

            // Read from the entry itself, so a login key added to the registry and missed by the projection fails.
            expect([...byKey.keys()]).toStrictEqual(Object.keys(roles).filter((key) => key !== 'owner'));
            expect([...byKey.values()]).toStrictEqual(loginRoles(roles));
        }
    });
});

/**
 * Changed by curated catalog plan U4a: the seeder gains an explicit schema USAGE, and `privilegesAfterApply` takes the
 * table policy, resets the seeder and applies the policy after the blanket grant. The exact lists for every shape are
 * pinned in `privilegeStatements.test.ts`; this block keeps the service role's view of them.
 */
describe('privilege statements — what the service role may do, re-applied on every migration run', () => {
    const roles = DATABASE_ROLES.food;
    const policy: TablePolicy = {
        catalog: new Set(['food_item']),
        serviceReadOnly: new Set(['catalog_seed_ledger']),
        dictionaries: new Set(['nutrient']),
    };

    it('before the migrations: closes the database to PUBLIC, admits the logins, and sets the grant-on-create hook', () => {
        expect(privilegesBeforeApply(roles, 'kitchensink_food_pr_91')).toEqual([
            'REVOKE ALL ON DATABASE "kitchensink_food_pr_91" FROM PUBLIC, "food_migrator", "food_app", "food_seeder"',
            'GRANT CONNECT ON DATABASE "kitchensink_food_pr_91" TO "food_migrator", "food_app", "food_seeder"',
            'GRANT TEMPORARY ON DATABASE "kitchensink_food_pr_91" TO "food_seeder"',
            'GRANT USAGE ON SCHEMA public TO "food_app"',
            'GRANT USAGE ON SCHEMA public TO "food_seeder"',
            'ALTER DEFAULT PRIVILEGES FOR ROLE "food_owner" IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "food_app"',
            'ALTER DEFAULT PRIVILEGES FOR ROLE "food_owner" IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO "food_app"',
        ]);
    });

    it('after the migrations: DML on everything that exists, and the ledger and read-only tables READ-ONLY for the service', () => {
        // The boot guard reads `schema_migrations`, so SELECT stays; nothing but the migrator may write it.
        expect(privilegesAfterApply(roles, policy).filter((sql) => sql.includes('"food_app"'))).toEqual([
            'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "food_app"',
            'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "food_app"',
            `REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ${MIGRATION_LEDGER_TABLE} FROM "food_app"`,
            'REVOKE ALL ON TABLE "catalog_seed_ledger" FROM PUBLIC, "food_app"',
            'GRANT SELECT ON TABLE "catalog_seed_ledger" TO "food_app"',
            'REVOKE ALL ON TABLE "nutrient" FROM PUBLIC, "food_app"',
            'GRANT SELECT, INSERT ON TABLE "nutrient" TO "food_app"',
        ]);
    });

    it('never grants the service role anything that creates, alters or drops', () => {
        const all = [...privilegesBeforeApply(roles, 'kitchensink_food'), ...privilegesAfterApply(roles, policy)].join(
            '\n',
        );

        expect(all).not.toMatch(/\b(CREATE|ALL PRIVILEGES|TRUNCATE ON|OWNER)\b.*"food_app"/u);
    });

    it('refuses a database name it could not quote safely', () => {
        expect(() => privilegesBeforeApply(roles, 'kitchensink"; DROP DATABASE x; --')).toThrow(/database name/u);
    });
});
