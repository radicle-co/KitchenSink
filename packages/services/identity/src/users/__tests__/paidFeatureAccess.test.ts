/**
 * What identity tells a client about the paid features (plan 2026-10-14-009 D2, D6).
 *
 * Owner rulings 2026-10-13 and 2026-10-15: a user who is not superuser, vip or premium — an admin included — sees no
 * paid feature and no upsell with the gate off (`hidden`), and the upsell with the gate on (`upsell`); an entitled role
 * always gets the paid features (`granted`), whatever the gate says.
 *
 * It replaces `subscriptionTier.ts`, whose `premium` PERMISSION no longer grants anything: roles do.
 */
import { ROLES, type Role } from '@kitchensink/clerk-verify';
import { describe, expect, it } from 'vitest';

import { paidFeatureAccess } from '../domain/paidFeatureAccess.js';
import { paidFeaturesSchema, type PaidFeatures } from '../users.schema.js';

describe('paidFeatureAccess — every role against both gate values', () => {
    const table: readonly (readonly [Role | 'none', boolean, PaidFeatures])[] = [
        ['admin', false, 'hidden'],
        ['admin', true, 'upsell'],
        ['superuser', false, 'granted'],
        ['superuser', true, 'granted'],
        ['vip', false, 'granted'],
        ['vip', true, 'granted'],
        ['premium', false, 'granted'],
        ['premium', true, 'granted'],
        ['default', false, 'hidden'],
        ['default', true, 'upsell'],
        ['none', false, 'hidden'],
        ['none', true, 'upsell'],
    ];

    it.each(table)('%s with the gate %s is %s', (role, gate, expected) => {
        const roles: readonly Role[] = role === 'none' ? [] : [role];

        expect(paidFeatureAccess({ roles, gate })).toBe(expected);
    });

    it('covers every declared role (non-vacuity for the table)', () => {
        expect(new Set(table.map(([role]) => role))).toStrictEqual(new Set([...ROLES, 'none']));
    });

    it('answers granted when ANY role is entitled, even beside default', () => {
        expect(paidFeatureAccess({ roles: ['default', 'vip'], gate: false })).toBe('granted');
    });

    it('only ever answers a value the wire schema accepts', () => {
        for (const [role, gate] of table) {
            const roles: readonly Role[] = role === 'none' ? [] : [role];

            expect(paidFeaturesSchema.safeParse(paidFeatureAccess({ roles, gate })).success).toBe(true);
        }
    });
});
