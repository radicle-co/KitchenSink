/**
 * The ONE tier source every recipe-service policy reads (plan 2026-10-14-009 D5).
 *
 * Owner ruling 2026-10-13: admin, superuser, vip and premium get the paid features; default does not. The roles come
 * from the verified token's `public_metadata.roles`. The paid-features GATE plays no part here: it decides only what a
 * user without an entitled role is shown, and only identity reads it.
 */
import { ROLES, type Role } from '@kitchensink/clerk-verify';
import { describe, expect, it } from 'vitest';

import { isPremiumPrincipal, tieredActingPrincipalOf, type Principal } from '../principal.js';

function principal(overrides: Partial<Principal> = {}): Principal {
    return {
        userId: '01J0000000000000000PRINCIPA',
        sub: 'user_principal',
        scopes: [],
        permissions: [],
        roles: [],
        principalKind: 'real',
        containment: 'enforce',
        ...overrides,
    };
}

describe('isPremiumPrincipal — from roles', () => {
    const table: readonly (readonly [Role, boolean])[] = [
        ['admin', true],
        ['superuser', true],
        ['vip', true],
        ['premium', true],
        ['default', false],
    ];

    it.each(table)('%s → %s', (role, expected) => {
        expect(isPremiumPrincipal(principal({ roles: [role] }))).toBe(expected);
    });

    it('covers every role (non-vacuity)', () => {
        expect(new Set(table.map(([role]) => role))).toStrictEqual(new Set(ROLES));
    });

    it('is false with no roles at all', () => {
        expect(isPremiumPrincipal(principal())).toBe(false);
    });

    /** The old grant was the `premium` PERMISSION. Roles replaced it; the permission alone grants nothing now. */
    it('ignores a bare premium permission or scope', () => {
        expect(isPremiumPrincipal(principal({ permissions: ['premium'], scopes: ['premium'] }))).toBe(false);
    });
});

describe('tieredActingPrincipalOf', () => {
    it('carries the role-derived tier into the acting slice', () => {
        expect(tieredActingPrincipalOf(principal({ roles: ['vip'] })).isPremium).toBe(true);
        expect(tieredActingPrincipalOf(principal({ roles: ['default'] })).isPremium).toBe(false);
    });
});
