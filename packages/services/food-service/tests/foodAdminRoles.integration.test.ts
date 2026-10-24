/**
 * Integration: a role reaches food's admin check through the REAL verification chain (plan 2026-10-14-009 D3, D4).
 *
 * The REAL `FoodAuthGuard` → `@kitchensink/clerk-verify`'s `verifyClerkToken` → `@clerk/backend`'s `verifyToken`,
 * against tokens genuinely RS256-signed by a throwaway key (`tests/support/jwt.ts`), no network. Food learns nothing
 * about roles: `verifyClerkToken` expands them into scopes once, and food's `hasScope(…, FOOD_ADMIN_SCOPE)` reads the
 * scopes it always read. That expansion is what this proves — a unit test with a mocked verifier cannot.
 *
 * Owner ruling 2026-10-13: superuser holds every scope; admin holds the admin scopes (`food:admin` among them, the
 * plan's default); a paid role is not a privilege.
 */
import type { NextFunction, Response } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FoodAuthGuard } from '../src/auth/foodAuth.guard.js';
import { FOOD_ADMIN_SCOPE, hasScope, type AuthenticatedRequest } from '../src/auth/authenticatedPrincipal.js';
import { generateClerkKeypair, mintToken } from './support/jwt.js';

const AZP = 'https://food-roles.example.com';
const keypair = generateClerkKeypair();
const saved: Record<string, string | undefined> = {};

beforeAll(() => {
    for (const key of ['CLERK_JWT_KEY', 'CLERK_AUTHORIZED_PARTIES', 'CLERK_AZP_PATTERN', 'CLERK_AZP_PREVIEW_MODE']) {
        saved[key] = process.env[key];
    }

    process.env['CLERK_JWT_KEY'] = keypair.publicKeyPem;
    process.env['CLERK_AUTHORIZED_PARTIES'] = AZP;
    delete process.env['CLERK_AZP_PATTERN'];
    delete process.env['CLERK_AZP_PREVIEW_MODE'];
});

afterAll(() => {
    for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    }
});

/** Run the real guard over a bearer carrying `roles`, and answer whether the caller holds `food:admin`. */
async function holdsFoodAdmin(roles: readonly string[] | undefined): Promise<boolean> {
    const token = mintToken(keypair.privateKeyPem, {
        sub: 'user_food_roles',
        azp: AZP,
        externalId: '01JFOODROLES00000000000001',
        ...(roles === undefined ? {} : { roles }),
    });
    const headers: Record<string, string> = { authorization: `Bearer ${token}` };
    const req = { headers, header: (name: string) => headers[name.toLowerCase()] } as unknown as AuthenticatedRequest;
    let passed = false;

    await new FoodAuthGuard().use(
        req,
        {} as Response,
        (() => {
            passed = true;
        }) as NextFunction,
    );

    expect(passed).toBe(true);

    return hasScope(req.user, FOOD_ADMIN_SCOPE);
}

describe('food:admin by role, through the real verifier', () => {
    it.each([['superuser'], ['admin']])('%s holds food:admin', async (role) => {
        expect(await holdsFoodAdmin([role])).toBe(true);
    });

    it.each([['vip'], ['premium'], ['default']])('%s does not', async (role) => {
        expect(await holdsFoodAdmin([role])).toBe(false);
    });

    it('no roles key at all does not', async () => {
        expect(await holdsFoodAdmin(undefined)).toBe(false);
    });

    it('a wrong-case role does not', async () => {
        expect(await holdsFoodAdmin(['Superuser'])).toBe(false);
    });
});
