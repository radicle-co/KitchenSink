/**
 * The role vocabulary (plan 2026-10-14-009 D1, D3, D4, D10): which roles get the paid features, which scopes a role
 * implies, and when the sign-up webhook writes `default`.
 *
 * Owner ruling 2026-10-13: admin, superuser, vip and premium get the paid features; default does not. The gate is not
 * here — it changes only what identity tells a client, and that table lives beside `paidFeatureAccess`.
 */
import { describe, expect, it } from 'vitest';

import {
    DEFAULT_ROLE_METADATA,
    ENTITLED_ROLES,
    ROLES,
    ROLES_METADATA_KEY,
    ROLE_SCOPES,
    hasPaidFeatures,
    needsDefaultRole,
    parseRoles,
    scopesForRoles,
} from '../roles.js';

describe('parseRoles', () => {
    it('keeps every known role, in the order given', () => {
        expect(parseRoles(['vip', 'admin'])).toStrictEqual(['vip', 'admin']);
    });

    it.each([
        ['an absent value', undefined],
        ['null', null],
        ['a bare string, not a list', 'premium'],
        ['an object', { premium: true }],
        ['a number', 1],
    ])('reads %s as no roles (fails closed)', (_label, raw) => {
        expect(parseRoles(raw)).toStrictEqual([]);
    });

    it.each([
        ['a wrong-case role', 'Premium'],
        ['a prefixed role', 'premium:trial'],
        ['a padded role', ' premium'],
        ['an unknown role', 'owner'],
        ['a non-string entry', 7],
        ['an inherited member name', 'toString'],
    ])('drops %s', (_label, entry) => {
        expect(parseRoles([entry, 'default'])).toStrictEqual(['default']);
    });

    it('drops a duplicate', () => {
        expect(parseRoles(['premium', 'premium'])).toStrictEqual(['premium']);
    });
});

describe('hasPaidFeatures', () => {
    it.each(ENTITLED_ROLES.map((role) => [role]))('is true for %s', (role) => {
        expect(hasPaidFeatures([role])).toBe(true);
    });

    it('is false for default', () => {
        expect(hasPaidFeatures(['default'])).toBe(false);
    });

    it('is false for no roles at all', () => {
        expect(hasPaidFeatures([])).toBe(false);
    });

    it('is true when any one role is entitled', () => {
        expect(hasPaidFeatures(['default', 'vip'])).toBe(true);
    });

    it('declares the five roles of the ruling', () => {
        expect([...ROLES].sort()).toStrictEqual(['admin', 'default', 'premium', 'superuser', 'vip']);
    });

    it('names exactly the four entitled roles of the ruling', () => {
        expect([...ENTITLED_ROLES].sort()).toStrictEqual(['admin', 'premium', 'superuser', 'vip']);
    });
});

describe('scopesForRoles', () => {
    it('gives superuser every scope the services authorize on', () => {
        expect([...scopesForRoles(['superuser'])].sort()).toStrictEqual([
            'admin:users',
            'food:admin',
            'recipes:import:public',
            'recipes:mappings:global',
            'recipes:parses:global',
        ]);
    });

    it('gives admin the admin scopes only', () => {
        expect([...scopesForRoles(['admin'])].sort()).toStrictEqual(['admin:users', 'food:admin']);
    });

    it.each([['vip'], ['premium'], ['default']] as const)('gives %s no scope', (role) => {
        expect(scopesForRoles([role])).toStrictEqual([]);
    });

    it('unions several roles without duplicates', () => {
        const scopes = scopesForRoles(['admin', 'superuser']);

        expect(scopes.length).toBe(new Set(scopes).size);
        expect(new Set(scopes)).toStrictEqual(new Set(ROLE_SCOPES.superuser));
    });

    it('gives no roles no scope', () => {
        expect(scopesForRoles([])).toStrictEqual([]);
    });

    it('keeps admin inside superuser (superuser holds every admin power)', () => {
        for (const scope of ROLE_SCOPES.admin) {
            expect(ROLE_SCOPES.superuser).toContain(scope);
        }
    });
});

describe('needsDefaultRole — the sign-up writer writes only where nothing is written', () => {
    it('is true when public_metadata has no roles key', () => {
        expect(needsDefaultRole({ testPrincipal: true, scopes: [] })).toBe(true);
    });

    it('is true for empty metadata', () => {
        expect(needsDefaultRole({})).toBe(true);
    });

    it('is false when roles are present', () => {
        expect(needsDefaultRole({ roles: ['premium'] })).toBe(false);
    });

    /** An admin wrote SOMETHING: the writer never overwrites it, even when it does not parse. */
    it('is false when roles is present but malformed', () => {
        expect(needsDefaultRole({ roles: 'premium' })).toBe(false);
    });

    it('is false for an explicitly empty list', () => {
        expect(needsDefaultRole({ roles: [] })).toBe(false);
    });

    it('does not read an inherited member as a roles key', () => {
        expect(needsDefaultRole(Object.create({ roles: ['vip'] }) as Record<string, unknown>)).toBe(true);
    });

    it('writes exactly the default role', () => {
        expect(DEFAULT_ROLE_METADATA).toStrictEqual({ roles: ['default'] });
    });

    /** The single-writer guard admits the webhook because it writes ONE key; a second key here would breach that. */
    it('carries the roles key and no other', () => {
        expect(Object.keys(DEFAULT_ROLE_METADATA)).toStrictEqual([ROLES_METADATA_KEY]);
    });
});
