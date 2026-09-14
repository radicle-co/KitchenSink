/**
 * The role-database fixture's PURE half: which connection each principal gets, which database names may be
 * provisioned, and what `truncate()` issues.
 *
 * The impure half — provisioning, migrating, and the privileges the service role actually holds — is
 * `tests/roleDatabase.integration.test.ts`, against real PostgreSQL. A unit test cannot observe a grant.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { DATABASE_ROLES, MIGRATION_LEDGER_TABLE } from '@kitchensink/db-schema-guard';

import { isNonDisposableDatabaseError, roleDatabase, truncateStatement } from '../roleDatabase.js';

const ADMIN = 'postgres://postgres:postgres@localhost:5432/postgres';
const spec = (database: string) => ({
    roles: DATABASE_ROLES.food,
    database,
    migrationsDir: '/nowhere',
    migrate: async () => undefined,
});

afterEach(() => {
    delete process.env['DATABASE_ADMIN_URL'];
});

describe('roleDatabase — the connections it hands out', () => {
    it('gives the subject the SERVICE role and the migrator its own, on the same server and database', () => {
        process.env['DATABASE_ADMIN_URL'] = ADMIN;

        const db = roleDatabase(spec('food_test'));
        const app = new URL(db.appUrl);
        const migrator = new URL(db.migratorUrl);

        expect(app.username).toBe(DATABASE_ROLES.food.app);
        expect(app.pathname).toBe('/food_test');
        expect(app.hostname).toBe('localhost');
        expect(migrator.username).toBe(DATABASE_ROLES.food.migrator);
        expect(migrator.pathname).toBe('/food_test');
    });

    it('⛔ never hands out the owner — it is NOLOGIN, and elevation goes through asOwner', () => {
        process.env['DATABASE_ADMIN_URL'] = ADMIN;

        const db = roleDatabase(spec('food_test'));

        expect(JSON.stringify({ app: db.appUrl, migrator: db.migratorUrl })).not.toContain(DATABASE_ROLES.food.owner);
    });
});

describe('roleDatabase — which database names it will provision', () => {
    it('⛔ REFUSES a name that is not disposable, naming the rule', () => {
        process.env['DATABASE_ADMIN_URL'] = ADMIN;

        const error = (() => {
            try {
                roleDatabase(spec('kitchensink_food'));

                return undefined;
            } catch (caught: unknown) {
                return caught;
            }
        })();

        expect(isNonDisposableDatabaseError(error)).toBe(true);
        expect((error as Error).message).toMatch(/_test/u);
    });

    it("⛔ REFUSES a `kitchensink_` name even with the suffix — the reaper's census counts those", () => {
        process.env['DATABASE_ADMIN_URL'] = ADMIN;

        expect(() => roleDatabase(spec('kitchensink_food_test'))).toThrow(/kitchensink_/u);
    });

    it('refuses ON USE when no admin server is configured — so a gated suite SKIPS instead of failing to import', () => {
        // The handle is built at module scope and the suite gates on `hasTestDatabase`. Throwing during
        // construction would make a machine with no PostgreSQL fail at import, which reads as a broken tier
        // rather than an absent one — the opposite of what the gate promises.
        const db = roleDatabase(spec('food_test'));

        expect(() => db.appUrl).toThrow(/DATABASE_ADMIN_URL/u);
        expect(() => db.migratorUrl).toThrow(/DATABASE_ADMIN_URL/u);
    });
});

describe('truncateStatement', () => {
    it('empties every table in one statement, restarting identities and cascading', () => {
        expect(truncateStatement(['food', 'food_source'])).toBe(
            'TRUNCATE TABLE "food", "food_source" RESTART IDENTITY CASCADE',
        );
    });

    it('⛔ EXCLUDES the migration ledger — truncating it would re-run every migration on the next reset', () => {
        expect(truncateStatement(['food', MIGRATION_LEDGER_TABLE])).toBe(
            'TRUNCATE TABLE "food" RESTART IDENTITY CASCADE',
        );
    });

    it('is a no-op statement when there is nothing to empty', () => {
        expect(truncateStatement([MIGRATION_LEDGER_TABLE])).toBeUndefined();
    });
});
