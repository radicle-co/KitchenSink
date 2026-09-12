import { describe, expect, it } from 'vitest';

import { DATABASE_ROLES, MIGRATION_LEDGER_TABLE, RDS_MASTER_USERNAME } from '../roles/databaseRoles.js';
import { privilegesAfterApply, privilegesBeforeApply } from '../roles/privilegeStatements.js';

const allRoles = Object.values(DATABASE_ROLES).flatMap((roles) => [roles.owner, roles.migrator, roles.app]);

describe('DATABASE_ROLES — the one registry of who owns, migrates and serves each database', () => {
    it('names every role safely enough to be quoted into SQL', () => {
        // Role names cannot be bound parameters in GRANT/ALTER statements; this pattern is what makes the
        // quoting in the statement builders safe.
        for (const role of allRoles) {
            expect(role).toMatch(/^[a-z_]+$/u);
        }
    });

    it('gives every database three DISTINCT roles, and no role to two databases', () => {
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
});

describe('privilege statements — what the service role may do, re-applied on every migration run', () => {
    const roles = DATABASE_ROLES.food;

    it('before the migrations: closes the database to PUBLIC, admits the two logins, and sets the grant-on-create hook', () => {
        expect(privilegesBeforeApply(roles, 'kitchensink_food_pr_91')).toEqual([
            'REVOKE ALL ON DATABASE "kitchensink_food_pr_91" FROM PUBLIC, "food_migrator", "food_app"',
            'GRANT CONNECT ON DATABASE "kitchensink_food_pr_91" TO "food_migrator", "food_app"',
            'GRANT USAGE ON SCHEMA public TO "food_app"',
            'ALTER DEFAULT PRIVILEGES FOR ROLE "food_owner" IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "food_app"',
            'ALTER DEFAULT PRIVILEGES FOR ROLE "food_owner" IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO "food_app"',
        ]);
    });

    it('after the migrations: DML on everything that exists, and the ledger READ-ONLY for the service', () => {
        // The boot guard reads `schema_migrations`, so SELECT stays; nothing but the migrator may write it.
        expect(privilegesAfterApply(roles)).toEqual([
            'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "food_app"',
            'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "food_app"',
            `REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ${MIGRATION_LEDGER_TABLE} FROM "food_app"`,
        ]);
    });

    it('never grants the service role anything that creates, alters or drops', () => {
        const all = [...privilegesBeforeApply(roles, 'kitchensink_food'), ...privilegesAfterApply(roles)].join('\n');

        expect(all).not.toMatch(/\b(CREATE|ALL PRIVILEGES|TRUNCATE ON|OWNER)\b.*"food_app"/u);
    });

    it('refuses a database name it could not quote safely', () => {
        expect(() => privilegesBeforeApply(roles, 'kitchensink"; DROP DATABASE x; --')).toThrow(/database name/u);
    });
});
