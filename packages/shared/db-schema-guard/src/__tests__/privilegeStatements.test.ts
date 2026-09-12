import { describe, expect, it } from 'vitest';

import { DATABASE_ROLES } from '../roles/databaseRoles.js';
import { databaseAclStatements, privilegesAfterApply, privilegesBeforeApply } from '../roles/privilegeStatements.js';

const roles = DATABASE_ROLES.food;

/**
 * Pins the exact privilege statements. Whether PostgreSQL then does what they MEAN is
 * `packages/infra/global/tests/dbRoleModel.integration.test.ts`'s job; this file makes a changed statement a
 * reviewed change rather than a silent one.
 */
describe('databaseAclStatements', () => {
    it('RESETS the ACL — revokes everything from PUBLIC and both logins — then admits exactly the two logins', () => {
        // A reset, not an addition: a grant that drifted in (an old bootstrap's `GRANT ALL`, a hand-run TEMP) is
        // taken back on every run, so the service role can never keep CREATE on its database.
        expect(databaseAclStatements(roles, 'kitchensink_food')).toEqual([
            'REVOKE ALL ON DATABASE "kitchensink_food" FROM PUBLIC, "food_migrator", "food_app"',
            'GRANT CONNECT ON DATABASE "kitchensink_food" TO "food_migrator", "food_app"',
        ]);
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

        expect(statements.slice(0, 2)).toEqual(databaseAclStatements(roles, 'kitchensink_food'));
    });

    it('then grants schema USAGE and installs the grant-on-create hook for the owner', () => {
        expect(privilegesBeforeApply(roles, 'kitchensink_food').slice(2)).toEqual([
            'GRANT USAGE ON SCHEMA public TO "food_app"',
            'ALTER DEFAULT PRIVILEGES FOR ROLE "food_owner" IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "food_app"',
            'ALTER DEFAULT PRIVILEGES FOR ROLE "food_owner" IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO "food_app"',
        ]);
    });

    it('refuses an unsafe database name', () => {
        expect(() => privilegesBeforeApply(roles, 'x"; --')).toThrow(/Refusing/u);
    });
});

describe('privilegesAfterApply', () => {
    it('grants DML on everything that exists, then makes the ledger read-only for the service role', () => {
        expect(privilegesAfterApply(roles)).toEqual([
            'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "food_app"',
            'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "food_app"',
            'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON schema_migrations FROM "food_app"',
        ]);
    });
});
