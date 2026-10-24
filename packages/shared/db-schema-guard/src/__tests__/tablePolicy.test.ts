/**
 * The table policy (curated catalog plan KTD-13, U4): a database's table-name sets, the rights each role holds on a
 * table of each set, and the precondition that a policy fits the database's roles.
 *
 * The policy is how `@kitchensink/db-schema-guard` grants food's tables without naming one: the service passes its
 * registry, and this module decides what the service role and the seeder may do with each set.
 */
import { describe, expect, it } from 'vitest';

import { DATABASE_ROLES, MIGRATION_LEDGER_TABLE } from '../roles/databaseRoles.js';
import {
    NO_TABLE_POLICY,
    TABLE_POLICY_RIGHTS,
    assertTablePolicyFits,
    policyTables,
    type TablePolicy,
} from '../roles/tablePolicy.js';
import {
    TablePolicyOverlapError,
    TablePolicySeederMismatchError,
    isTablePolicyOverlapError,
    isTablePolicySeederMismatchError,
} from '../roles/tablePolicy.errors.js';

/** A policy over the given names; every set defaults to empty. */
function policy(sets: { catalog?: string[]; serviceReadOnly?: string[]; dictionaries?: string[] }): TablePolicy {
    return {
        catalog: new Set(sets.catalog ?? []),
        serviceReadOnly: new Set(sets.serviceReadOnly ?? []),
        dictionaries: new Set(sets.dictionaries ?? []),
    };
}

/** What `run` threw, or `undefined`. */
function thrownBy(run: () => void): unknown {
    try {
        run();

        return undefined;
    } catch (error: unknown) {
        return error;
    }
}

describe('TABLE_POLICY_RIGHTS — what each role may do with a table of each set (KTD-13, KTD-14, KTD-18)', () => {
    it('gives the service role DML on the catalog, SELECT on the read-only set and SELECT+INSERT on dictionaries', () => {
        expect(TABLE_POLICY_RIGHTS.catalog.app).toStrictEqual(['SELECT', 'INSERT', 'UPDATE', 'DELETE']);
        expect(TABLE_POLICY_RIGHTS.serviceReadOnly.app).toStrictEqual(['SELECT']);
        expect(TABLE_POLICY_RIGHTS.dictionaries.app).toStrictEqual(['SELECT', 'INSERT']);
    });

    it('gives the seeder DML on the catalog and SELECT+INSERT on the read-only set and dictionaries', () => {
        expect(TABLE_POLICY_RIGHTS.catalog.seeder).toStrictEqual(['SELECT', 'INSERT', 'UPDATE', 'DELETE']);
        expect(TABLE_POLICY_RIGHTS.serviceReadOnly.seeder).toStrictEqual(['SELECT', 'INSERT']);
        expect(TABLE_POLICY_RIGHTS.dictionaries.seeder).toStrictEqual(['SELECT', 'INSERT']);
    });
});

describe('NO_TABLE_POLICY', () => {
    it('names no table', () => {
        expect(policyTables(NO_TABLE_POLICY)).toStrictEqual([]);
    });
});

describe('policyTables', () => {
    it('lists every table with its set: catalog, then read-only, then dictionaries, each by name', () => {
        expect(
            policyTables(
                policy({ catalog: ['food', 'food_item'], serviceReadOnly: ['ledger'], dictionaries: ['b', 'a'] }),
            ),
        ).toStrictEqual([
            { table: 'food', set: 'catalog' },
            { table: 'food_item', set: 'catalog' },
            { table: 'ledger', set: 'serviceReadOnly' },
            { table: 'a', set: 'dictionaries' },
            { table: 'b', set: 'dictionaries' },
        ]);
    });
});

describe('assertTablePolicyFits — a seeded policy exactly when the database has a seeder', () => {
    it('admits a seeded database with a policy that names tables', () => {
        expect(() =>
            assertTablePolicyFits(DATABASE_ROLES.food, policy({ catalog: ['food'], serviceReadOnly: ['ledger'] })),
        ).not.toThrow();
    });

    it('admits a seeded database with a policy that names no table yet (U4a, before the catalog tables exist)', () => {
        expect(() => assertTablePolicyFits(DATABASE_ROLES.food, policy({}))).not.toThrow();
    });

    it.each(['identity', 'recipe'] as const)('admits %s, which has no seeder, with NO_TABLE_POLICY', (service) => {
        expect(() => assertTablePolicyFits(DATABASE_ROLES[service], NO_TABLE_POLICY)).not.toThrow();
    });

    it('admits a database with no seeder and a policy that names no table: it grants nothing', () => {
        expect(() => assertTablePolicyFits(DATABASE_ROLES.recipe, policy({}))).not.toThrow();
    });

    it('⛔ refuses a seeded database given NO_TABLE_POLICY, naming the seeder', () => {
        // The seeder's table rights come only from the policy, so a food migrate handed identity's policy would leave
        // the seed unable to write and nothing would say why until the seed ran.
        const error = thrownBy(() => assertTablePolicyFits(DATABASE_ROLES.food, NO_TABLE_POLICY));

        expect(isTablePolicySeederMismatchError(error)).toBe(true);
        expect(error).toMatchObject({ reason: 'seederWithoutPolicy' });
        expect(String(error)).toContain('food_seeder');
    });

    it.each([
        ['catalog', policy({ catalog: ['food'] })],
        ['serviceReadOnly', policy({ serviceReadOnly: ['ledger'] })],
        ['dictionaries', policy({ dictionaries: ['nutrient'] })],
    ] as const)('⛔ refuses a database with no seeder given a policy whose %s set names a table', (_set, given) => {
        // Every set grants the seeder something, so a policy that names a table on a database with no seeder asks
        // for grants to a role that does not exist.
        const error = thrownBy(() => assertTablePolicyFits(DATABASE_ROLES.recipe, given));

        expect(isTablePolicySeederMismatchError(error)).toBe(true);
        expect(error).toMatchObject({ reason: 'policyWithoutSeeder' });
        expect(String(error)).toContain('recipe_owner');
    });
});

describe('assertTablePolicyFits — the sets are disjoint', () => {
    it('⛔ refuses a table in two sets, naming the table and both sets', () => {
        const error = thrownBy(() =>
            assertTablePolicyFits(DATABASE_ROLES.food, policy({ catalog: ['nutrient'], dictionaries: ['nutrient'] })),
        );

        expect(isTablePolicyOverlapError(error)).toBe(true);
        expect(error).toMatchObject({ overlaps: [{ table: 'nutrient', sets: ['catalog', 'dictionaries'] }] });
        expect(String(error)).toContain('nutrient (catalog, dictionaries)');
    });

    it('⛔ refuses the migration ledger in any set: the seeder would gain INSERT on it', () => {
        const error = thrownBy(() =>
            assertTablePolicyFits(DATABASE_ROLES.food, policy({ serviceReadOnly: [MIGRATION_LEDGER_TABLE] })),
        );

        expect(isTablePolicyOverlapError(error)).toBe(true);
        expect(error).toMatchObject({
            overlaps: [{ table: MIGRATION_LEDGER_TABLE, sets: ['serviceReadOnly', 'migrationLedger'] }],
        });
    });

    it('checks overlap before the seeder rule, so a broken policy is named for what is wrong with it', () => {
        const error = thrownBy(() =>
            assertTablePolicyFits(DATABASE_ROLES.recipe, policy({ catalog: ['x'], serviceReadOnly: ['x'] })),
        );

        expect(isTablePolicyOverlapError(error)).toBe(true);
    });
});

describe('the error guards', () => {
    it('recognise their own errors and nothing else', () => {
        const overlap = new TablePolicyOverlapError([{ table: 't', sets: ['catalog', 'dictionaries'] }]);
        const mismatch = new TablePolicySeederMismatchError('seederWithoutPolicy', DATABASE_ROLES.food);

        expect(isTablePolicyOverlapError(overlap)).toBe(true);
        expect(isTablePolicyOverlapError(mismatch)).toBe(false);
        expect(isTablePolicySeederMismatchError(mismatch)).toBe(true);
        expect(isTablePolicySeederMismatchError(overlap)).toBe(false);
        expect(isTablePolicyOverlapError(new Error('x'))).toBe(false);
        expect(overlap.name).toBe('TablePolicyOverlapError');
        expect(mismatch.name).toBe('TablePolicySeederMismatchError');
    });
});
