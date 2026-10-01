// @vitest-environment node
/**
 * The bootstrap's database postconditions: what each login role must, and must not, hold on its database once the
 * ACL step has run (ADR-0039, curated catalog plan U18).
 *
 * The rows are what the pass reads from `pg_database` and the ACL functions; the real server is
 * `tests/e2e/seederBootstrap.e2e.test.ts`. Every rule is pinned by the one row that breaks it, so a rule deleted from
 * the policy fails here.
 */
import { describe, expect, it } from 'vitest';

import { DATABASE_ROLES } from '@kitchensink/db-schema-guard';

import { unmetPostconditions, type DatabaseAclRow, type LoginRightsRow } from '../src/db-bootstrap/postconditions.js';

const food = DATABASE_ROLES.food;
const database = 'kitchensink_food';

const healthyDatabase: DatabaseAclRow = { owner: food.owner, connectionLimit: -1, publicConnect: false };

/** A login's rights with nothing but CONNECT. */
const connectOnly = (role: string): LoginRightsRow => ({
    role,
    connect: true,
    create: false,
    temporary: false,
    explicitCreate: false,
    explicitTemporary: false,
});

/** A healthy food catalog: the migrator inherits the owner's rights, the seeder holds TEMPORARY of its own. */
function healthyLogins(): LoginRightsRow[] {
    return [
        { ...connectOnly(food.migrator), create: true, temporary: true },
        connectOnly(food.app),
        { ...connectOnly(food.seeder), temporary: true, explicitTemporary: true },
    ];
}

/** Replace the row for `role`. */
function withLogin(role: string, change: Partial<LoginRightsRow>): LoginRightsRow[] {
    return healthyLogins().map((row) => (row.role === role ? { ...row, ...change } : row));
}

describe('unmetPostconditions', () => {
    it('passes a healthy food database, seeder included', () => {
        expect(unmetPostconditions({ roles: food, database }, healthyDatabase, healthyLogins())).toStrictEqual([]);
    });

    it('asks nothing of a seeder where the database has none', () => {
        const identity = DATABASE_ROLES.identity;

        expect(
            unmetPostconditions(
                { roles: identity, database: 'kitchensink_identity' },
                { ...healthyDatabase, owner: identity.owner },
                [{ ...connectOnly(identity.migrator), create: true, temporary: true }, connectOnly(identity.app)],
            ),
        ).toStrictEqual([]);
    });

    it('reports only the missing database when there is none — nothing else can be read', () => {
        expect(unmetPostconditions({ roles: food, database }, undefined, [])).toStrictEqual([
            `${database} does not exist`,
        ]);
    });

    const brokenDatabases: readonly (readonly [string, Partial<DatabaseAclRow>, string])[] = [
        ['another owner', { owner: 'identity_app' }, `${database} is owned by identity_app, not food_owner`],
        ['a database mid-DROP', { connectionLimit: -2 }, `${database} is mid-DROP`],
        ['PUBLIC still admitted', { publicConnect: true }, `PUBLIC can still CONNECT to ${database}`],
    ];

    it.each(brokenDatabases)('⛔ reports %s', (_case, change, message) => {
        expect(
            unmetPostconditions({ roles: food, database }, { ...healthyDatabase, ...change }, healthyLogins()),
        ).toStrictEqual([message]);
    });

    const brokenLogins: readonly (readonly [string, LoginRightsRow[], string])[] = [
        [
            'a login role with no row (it does not exist)',
            healthyLogins().filter((row) => row.role !== food.seeder),
            'food_seeder does not exist',
        ],
        [
            'a migrator without CONNECT',
            withLogin(food.migrator, { connect: false }),
            `food_migrator cannot CONNECT to ${database}`,
        ],
        [
            'a service role without CONNECT',
            withLogin(food.app, { connect: false }),
            `food_app cannot CONNECT to ${database}`,
        ],
        [
            'a seeder without CONNECT',
            withLogin(food.seeder, { connect: false }),
            `food_seeder cannot CONNECT to ${database}`,
        ],
        [
            'an explicit CREATE grant to the migrator (it inherits the owner’s instead)',
            withLogin(food.migrator, { explicitCreate: true }),
            `food_migrator holds an explicit CREATE grant on ${database}`,
        ],
        [
            'an explicit TEMPORARY grant to the migrator',
            withLogin(food.migrator, { explicitTemporary: true }),
            `food_migrator holds an explicit TEMPORARY grant on ${database}`,
        ],
        [
            'CREATE reaching the service role',
            withLogin(food.app, { create: true }),
            `food_app holds CREATE on ${database}`,
        ],
        [
            'TEMPORARY reaching the service role',
            withLogin(food.app, { temporary: true }),
            `food_app holds TEMPORARY on ${database}`,
        ],
        [
            'a seeder without its own TEMPORARY grant',
            withLogin(food.seeder, { explicitTemporary: false }),
            `food_seeder lacks its explicit TEMPORARY grant on ${database}`,
        ],
        [
            'CREATE reaching the seeder',
            withLogin(food.seeder, { create: true }),
            `food_seeder holds CREATE on ${database}`,
        ],
    ];

    it.each(brokenLogins)('⛔ reports %s', (_case, logins, message) => {
        expect(unmetPostconditions({ roles: food, database }, healthyDatabase, logins)).toStrictEqual([message]);
    });

    it('does not report the rights the migrator INHERITS from the owner, which it is meant to hold', () => {
        const logins = withLogin(food.migrator, { create: true, temporary: true });

        expect(unmetPostconditions({ roles: food, database }, healthyDatabase, logins)).toStrictEqual([]);
    });
});
