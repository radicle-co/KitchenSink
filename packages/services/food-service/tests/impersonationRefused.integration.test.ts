/**
 * Integration: food refuses a Clerk impersonation session token with 401 (owner ruling 2026-10-15).
 *
 * The REAL `FoodAuthGuard` → `@kitchensink/clerk-verify`'s `verifyClerkToken` → `@clerk/backend`'s `verifyToken`,
 * against tokens genuinely RS256-signed by a throwaway key (`tests/support/jwt.ts`), no network. Clerk signs an
 * impersonation session like any other and marks it with an `act` claim; only the shared verifier's rule stops it.
 *
 * The control matters: the SAME token without `act` is admitted, so the 401 is the `act` rule and not a
 * misconfigured key or `azp`.
 */
import { UnauthorizedException } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AuthenticatedRequest } from '../src/auth/authenticatedPrincipal.js';
import { FoodAuthGuard } from '../src/auth/foodAuth.guard.js';
import { generateClerkKeypair, mintToken } from './support/jwt.js';

const AZP = 'https://food-impersonation.example.com';
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

/** Run the real guard over a bearer minted with `act`; resolves whether the guard let the request through. */
async function admitted(act: { readonly sub: string } | undefined): Promise<boolean> {
    const token = mintToken(keypair.privateKeyPem, {
        sub: 'user_food_impersonated',
        azp: AZP,
        externalId: '01JFOODIMPERSON00000000001',
        ...(act === undefined ? {} : { act }),
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

    return passed;
}

describe('FoodAuthGuard — impersonation session token, through the real verifier', () => {
    it('⛔ answers 401 to a validly signed token carrying an act claim', async () => {
        await expect(admitted({ sub: 'user_admin' })).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('control: the same token without act is admitted', async () => {
        expect(await admitted(undefined)).toBe(true);
    });
});
