import { describe, expect, it } from 'vitest';

import { DATABASE_ROLES } from '../roles/databaseRoles.js';
import {
    databaseAclStatements,
    isSafeDatabaseName,
    migrationLedgerReadOnly,
    privilegesAfterApply,
    privilegesBeforeApply,
    tablePolicyStatements,
} from '../roles/privilegeStatements.js';
import { NO_TABLE_POLICY, policyTables, type TablePolicy } from '../roles/tablePolicy.js';

const roles = DATABASE_ROLES.food;

/**
 * Pins the exact privilege statements. Whether PostgreSQL then does what they MEAN is
 * `packages/infra/global/tests/dbRoleModel.integration.test.ts`'s and `tests/e2e/tablePolicy.e2e.test.ts`'s job; this
 * file makes a changed statement a reviewed change rather than a silent one.
 *
 * Changed by curated catalog plan U4a: the seeder gains an explicit schema USAGE, its exact-rights reset and the table
 * policy's grants, and `privilegesAfterApply` takes the policy. Identity's and recipe's lists stay byte-identical.
 */
describe('isSafeDatabaseName', () => {
    it('admits the snake_case names every stage uses, and nothing that needs quoting to be one name', () => {
        for (const name of ['kitchensink_food', 'kitchensink_recipes_pr_91', 'identity']) {
            expect(isSafeDatabaseName(name)).toBe(true);
        }

        for (const name of ['', 'Food', 'food-pr-1', 'food; DROP DATABASE x', 'food"x', 'føød']) {
            expect(isSafeDatabaseName(name)).toBe(false);
        }
    });
});

describe('databaseAclStatements', () => {
    it('RESETS the ACL — revokes everything from PUBLIC and every login — then admits the logins, and TEMP to the seeder', () => {
        // A reset, not an addition: a grant that drifted in (an old bootstrap's `GRANT ALL`, a hand-run TEMP) is
        // taken back on every run, so the service role can never keep CREATE on its database. The seeder's TEMP is
        // re-granted each run: it stages the seed in temporary tables (curated catalog plan KTD-1).
        expect(databaseAclStatements(roles, 'kitchensink_food')).toEqual([
            'REVOKE ALL ON DATABASE "kitchensink_food" FROM PUBLIC, "food_migrator", "food_app", "food_seeder"',
            'GRANT CONNECT ON DATABASE "kitchensink_food" TO "food_migrator", "food_app", "food_seeder"',
            'GRANT TEMPORARY ON DATABASE "kitchensink_food" TO "food_seeder"',
        ]);
    });

    it.each([
        [
            'identity',
            [
                'REVOKE ALL ON DATABASE "kitchensink_identity" FROM PUBLIC, "identity_migrator", "identity_service"',
                'GRANT CONNECT ON DATABASE "kitchensink_identity" TO "identity_migrator", "identity_service"',
            ],
        ],
        [
            'recipe',
            [
                'REVOKE ALL ON DATABASE "kitchensink_recipe" FROM PUBLIC, "recipe_migrator", "recipe_app"',
                'GRANT CONNECT ON DATABASE "kitchensink_recipe" TO "recipe_migrator", "recipe_app"',
            ],
        ],
    ] as const)('⛔ leaves %s — which has no seeder — byte-identical', (service, expected) => {
        expect(databaseAclStatements(DATABASE_ROLES[service], `kitchensink_${service}`)).toStrictEqual(expected);
    });

    it('never grants CREATE on the database to anyone', () => {
        for (const dbRoles of Object.values(DATABASE_ROLES)) {
            expect(databaseAclStatements(dbRoles, 'kitchensink_x').join('\n')).not.toMatch(/GRANT[^;]*CREATE/u);
        }
    });

    it('never admits the owner (NOLOGIN — nothing logs in as it) or anyone else', () => {
        const granted = databaseAclStatements(roles, 'kitchensink_food').filter((sql) => sql.startsWith('GRANT'));

        expect(granted.join('\n')).not.toContain(roles.owner);
    });

    it.each(['kitchensink_food; DROP DATABASE x', 'Kitchensink', 'kitchensink-food', ''])(
        'refuses a database name it would have to quote blindly: %j',
        (name) => {
            expect(() => databaseAclStatements(roles, name)).toThrow(/Refusing/u);
        },
    );
});

describe('privilegesBeforeApply', () => {
    it('begins with the database ACL — ONE definition, shared with the bootstrap', () => {
        const statements = privilegesBeforeApply(roles, 'kitchensink_food');

        const acl = databaseAclStatements(roles, 'kitchensink_food');

        expect(statements.slice(0, acl.length)).toEqual(acl);
    });

    it('then grants schema USAGE to the service role and the seeder, and installs the grant-on-create hook', () => {
        // The seeder's USAGE is explicit (curated catalog plan U4): `CREATE DATABASE` gives PUBLIC USAGE on `public`
        // today, and a role's rights must not rest on a template default.
        const acl = databaseAclStatements(roles, 'kitchensink_food');

        expect(privilegesBeforeApply(roles, 'kitchensink_food').slice(acl.length)).toEqual([
            'GRANT USAGE ON SCHEMA public TO "food_app"',
            'GRANT USAGE ON SCHEMA public TO "food_seeder"',
            'ALTER DEFAULT PRIVILEGES FOR ROLE "food_owner" IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "food_app"',
            'ALTER DEFAULT PRIVILEGES FOR ROLE "food_owner" IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO "food_app"',
        ]);
    });

    it.each(['identity', 'recipe'] as const)('⛔ leaves %s — which has no seeder — byte-identical', (service) => {
        const unseeded = DATABASE_ROLES[service];
        const acl = databaseAclStatements(unseeded, `kitchensink_${service}`);

        expect(privilegesBeforeApply(unseeded, `kitchensink_${service}`).slice(acl.length)).toStrictEqual([
            `GRANT USAGE ON SCHEMA public TO "${unseeded.app}"`,
            `ALTER DEFAULT PRIVILEGES FOR ROLE "${unseeded.owner}" IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${unseeded.app}"`,
            `ALTER DEFAULT PRIVILEGES FOR ROLE "${unseeded.owner}" IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO "${unseeded.app}"`,
        ]);
    });

    it('refuses an unsafe database name', () => {
        expect(() => privilegesBeforeApply(roles, 'x"; --')).toThrow(/Refusing/u);
    });
});

/** A food-shaped policy: one table in each set. */
const POLICY: TablePolicy = {
    catalog: new Set(['food_item']),
    serviceReadOnly: new Set(['catalog_seed_ledger']),
    dictionaries: new Set(['nutrient']),
};

/**
 * The statements {@link POLICY} issues for all three of its tables. Every reset revokes from PUBLIC too: a right
 * granted to PUBLIC reaches every role, so a reset that left it would hand the seeder's rights to any login.
 */
const POLICY_STATEMENTS = [
    // Catalog: the service role keeps the DML the grant-on-create hook and the blanket grant give it; only the
    // seeder is reset to its exact rights.
    'REVOKE ALL ON TABLE "food_item" FROM PUBLIC, "food_seeder"',
    'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "food_item" TO "food_seeder"',
    // Read-only: the reset is what takes back the INSERT, UPDATE and DELETE the hook handed the service role.
    'REVOKE ALL ON TABLE "catalog_seed_ledger" FROM PUBLIC, "food_app"',
    'GRANT SELECT ON TABLE "catalog_seed_ledger" TO "food_app"',
    'REVOKE ALL ON TABLE "catalog_seed_ledger" FROM PUBLIC, "food_seeder"',
    'GRANT SELECT, INSERT ON TABLE "catalog_seed_ledger" TO "food_seeder"',
    'REVOKE ALL ON TABLE "nutrient" FROM PUBLIC, "food_app"',
    'GRANT SELECT, INSERT ON TABLE "nutrient" TO "food_app"',
    'REVOKE ALL ON TABLE "nutrient" FROM PUBLIC, "food_seeder"',
    'GRANT SELECT, INSERT ON TABLE "nutrient" TO "food_seeder"',
];

describe('tablePolicyStatements — the per-set rights, for the tables that exist (KTD-13)', () => {
    it('resets each existing policy table to its exact rights: the seeder on every set, the service role where restricted', () => {
        expect(tablePolicyStatements(roles, POLICY, ['nutrient', 'food_item', 'catalog_seed_ledger'])).toStrictEqual(
            POLICY_STATEMENTS,
        );
    });

    it('names only the policy tables that exist, so it can run inside a migration that has not created the rest', () => {
        expect(tablePolicyStatements(roles, POLICY, ['catalog_seed_ledger', 'unregistered'])).toStrictEqual([
            'REVOKE ALL ON TABLE "catalog_seed_ledger" FROM PUBLIC, "food_app"',
            'GRANT SELECT ON TABLE "catalog_seed_ledger" TO "food_app"',
            'REVOKE ALL ON TABLE "catalog_seed_ledger" FROM PUBLIC, "food_seeder"',
            'GRANT SELECT, INSERT ON TABLE "catalog_seed_ledger" TO "food_seeder"',
        ]);
    });

    it('issues nothing for NO_TABLE_POLICY', () => {
        expect(tablePolicyStatements(DATABASE_ROLES.recipe, NO_TABLE_POLICY, ['recipes'])).toStrictEqual([]);
    });

    it('quotes a table name it is given', () => {
        const odd: TablePolicy = { ...POLICY, catalog: new Set(['we"ird']) };

        expect(tablePolicyStatements(roles, odd, ['we"ird'])).toContain(
            'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "we""ird" TO "food_seeder"',
        );
    });
});

describe('privilegesAfterApply', () => {
    it('grants DML on everything, makes the ledger read-only, resets the seeder, then applies the policy', () => {
        // One list, run as ONE transaction by the engine: between the blanket grant and the policy's reset the service
        // role holds INSERT on every read-only table, and only a transaction keeps that from being seen or left behind.
        const everyPolicyTable = policyTables(POLICY).map(({ table }) => table);

        expect(privilegesAfterApply(roles, POLICY, everyPolicyTable)).toStrictEqual([
            'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "food_app"',
            'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "food_app"',
            'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON schema_migrations FROM "food_app"',
            // The seeder holds nothing the policy does not name: no right on the migration ledger, an unregistered
            // table, a view or a sequence.
            'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM "food_seeder"',
            'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM "food_seeder"',
            ...POLICY_STATEMENTS,
        ]);
    });

    it('names only the policy tables that exist, so a migration’s own transaction can run it', () => {
        expect(privilegesAfterApply(roles, POLICY, ['catalog_seed_ledger', 'unregistered']).slice(5)).toStrictEqual([
            'REVOKE ALL ON TABLE "catalog_seed_ledger" FROM PUBLIC, "food_app"',
            'GRANT SELECT ON TABLE "catalog_seed_ledger" TO "food_app"',
            'REVOKE ALL ON TABLE "catalog_seed_ledger" FROM PUBLIC, "food_seeder"',
            'GRANT SELECT, INSERT ON TABLE "catalog_seed_ledger" TO "food_seeder"',
        ]);
    });

    it.each(['identity', 'recipe'] as const)(
        '⛔ leaves %s — which has no seeder — byte-identical under NO_TABLE_POLICY',
        (service) => {
            const unseeded = DATABASE_ROLES[service];

            expect(privilegesAfterApply(unseeded, NO_TABLE_POLICY, [])).toStrictEqual([
                `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${unseeded.app}"`,
                `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${unseeded.app}"`,
                `REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON schema_migrations FROM "${unseeded.app}"`,
            ]);
        },
    );
});

describe('migrationLedgerReadOnly', () => {
    it('is the ledger revoke privilegesAfterApply issues — one statement, run again where the ledger is created', () => {
        expect(privilegesAfterApply(DATABASE_ROLES.identity, NO_TABLE_POLICY, [])).toContain(
            migrationLedgerReadOnly(DATABASE_ROLES.identity),
        );
        expect(migrationLedgerReadOnly(roles)).toBe(
            'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON schema_migrations FROM "food_app"',
        );
    });
});

describe('where the seeder appears', () => {
    it('only in its database ACL, its schema USAGE, its reset and the policy: never a blanket or default grant', () => {
        const empty: TablePolicy = { catalog: new Set(), serviceReadOnly: new Set(), dictionaries: new Set() };
        const seederStatements = [
            ...privilegesBeforeApply(roles, 'kitchensink_food'),
            ...privilegesAfterApply(roles, empty, []),
        ].filter((sql) => sql.includes('food_seeder'));

        expect(seederStatements).toStrictEqual([
            ...databaseAclStatements(roles, 'kitchensink_food'),
            'GRANT USAGE ON SCHEMA public TO "food_seeder"',
            'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM "food_seeder"',
            'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM "food_seeder"',
        ]);
    });
});
