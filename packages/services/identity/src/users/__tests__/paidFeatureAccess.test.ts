/**
 * What identity tells a client about the paid features (plan 2026-10-14-009 D2, D6).
 *
 * Owner ruling 2026-10-13: a user who is not admin, superuser, vip or premium, with the gate off, sees no paid feature
 * and no upsell (`hidden`); with the gate on, they see the upsell (`upsell`); an entitled role always gets the paid
 * features (`granted`), whatever the gate says.
 *
 * It replaces `subscriptionTier.ts`, whose `premium` PERMISSION no longer grants anything: roles do.
 */
import { ROLES, type Role } from '@kitchensink/clerk-verify';
import { describe, expect, it } from 'vitest';

import { paidFeatureAccess } from '../domain/paidFeatureAccess.js';
import { paidFeaturesSchema, type PaidFeatures } from '../users.schema.js';

describe('paidFeatureAccess — every role against both gate values', () => {
    const table: readonly (readonly [Role | 'none', boolean, PaidFeatures])[] = [
        ['admin', false, 'granted'],
        ['admin', true, 'granted'],
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
