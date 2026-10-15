/**
 * Integration: `account.paidFeatures` on `GET` and `PATCH /api/v1/users/me` over real HTTP, with the database stubbed
 * (plan `docs/plans/2026-10-14-009-feat-roles-and-paid-gate-plan.md` D6, D8; `docs/CODING_STANDARDS.md` §7.1a).
 *
 * The REAL `UsersController`, the REAL `UsersService` and the REAL `paidFeaturesGateProvider` — which reads
 * `PAID_FEATURES_GATE` once at boot — over a stubbed resolver and drizzle handle. Auth is a header-driven stand-in for
 * `AuthMiddleware` (as in `settings.integration.test.ts`): the header carries the roles a verified token would. Each
 * response is parsed with the PUBLISHED `userProfileSchema`, so a drift between the service and the schema package
 * fails here.
 *
 * Owner ruling 2026-10-13: an entitled role is `granted` under both gate values; anyone else is `upsell` with the
 * gate on and `hidden` with it off.
 *
 * @module
 */
import 'reflect-metadata';

import type { AddressInfo } from 'node:net';

import { ROLES, parseRoles, type Role } from '@kitchensink/clerk-verify';
import { userProfileSchema } from '@kitchensink/schema-identity';
import { Module, type INestApplication } from '@nestjs/common';
import { APP_PIPE, NestFactory } from '@nestjs/core';
import type { NextFunction, Request, Response } from 'express';
import { ZodValidationPipe } from 'nestjs-zod';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@aws-sdk/client-sqs', () => ({
    SQSClient: vi.fn(),
    SendMessageCommand: vi.fn(),
}));

import type { AuthorizerContext } from '../src/auth/decorators/currentUser.decorator.js';
import { DrizzleProvider } from '../src/database/database.module.js';
import { SqsService } from '../src/queue/sqs.service.js';
import { AVATAR_OBJECT_STORE } from '../src/users/avatarObjectStore.js';
import { HANDLE_SYNC_PUBLISHER, noopHandleSyncPublisher } from '../src/users/handleSync.publisher.js';
import { paidFeaturesGateProvider } from '../src/users/paidFeaturesGate.provider.js';
import { ResolveUserService } from '../src/users/resolveUser.js';
import { UsersController } from '../src/users/users.controller.js';
import { UsersService } from '../src/users/users.service.js';

const USER_ID = '01HZZZZZZZZZZZZZZZZZZZZZPF';
const NOW = new Date('2026-10-14T00:00:00.000Z');
const user = {
    id: USER_ID,
    identityId: 'user_paid',
    email: 'paid@example.com',
    status: 'active',
    createdAt: NOW,
    updatedAt: NOW,
};
const account = { id: 'a-paid', userId: USER_ID, subscriptionTier: 'free', createdAt: NOW, updatedAt: NOW };
const profile = { id: 'p-paid', userId: USER_ID, displayName: 'Paid', avatarUrl: null, updatedAt: NOW };

/** A drizzle stand-in for `getUserMe`'s one read: the profile row. */
function stubDb() {
    return {
        select: vi.fn(() => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([profile]) }) }) })),
    };
}

/**
 * Boot the users routes with the gate env set as the CDK stack would set it.
 *
 * @sideEffect Sets `process.env['PAID_FEATURES_GATE']` for the provider's boot read, then restores it; listens.
 */
async function bootUsers(gate: 'true' | 'false'): Promise<{ app: INestApplication; baseUrl: string }> {
    const db = stubDb();
    const resolver = { resolveUser: vi.fn().mockResolvedValue({ user, account }) };

    @Module({
        controllers: [UsersController],
        providers: [
            UsersService,
            paidFeaturesGateProvider,
            { provide: DrizzleProvider, useValue: db },
            { provide: SqsService, useValue: {} },
            { provide: ResolveUserService, useValue: resolver },
            { provide: HANDLE_SYNC_PUBLISHER, useValue: noopHandleSyncPublisher },
            { provide: AVATAR_OBJECT_STORE, useValue: {} },
            { provide: APP_PIPE, useValue: new ZodValidationPipe() },
        ],
    })
    class TestUsersModule {}

    const previous = process.env['PAID_FEATURES_GATE'];
    process.env['PAID_FEATURES_GATE'] = gate;

    try {
        const app = await NestFactory.create(TestUsersModule, { logger: false });
        app.use((req: Request & { user?: AuthorizerContext }, _res: Response, next: NextFunction) => {
            req.user = {
                userId: USER_ID as AuthorizerContext['userId'],
                email: 'paid@example.com',
                clerkUserId: 'user_paid',
                scopes: [],
                permissions: [],
                // What `verifyClerkToken` would have parsed out of `public_metadata.roles`.
                roles: parseRoles(JSON.parse(req.header('x-test-roles') ?? '[]')),
                tokenType: 'user',
                testPrincipal: false,
            };
            next();
        });
        await app.init();
        await app.listen(0);

        return { app, baseUrl: `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}` };
    } finally {
        if (previous === undefined) {
            delete process.env['PAID_FEATURES_GATE'];
        } else {
            process.env['PAID_FEATURES_GATE'] = previous;
        }
    }
}

const ENTITLED: readonly Role[] = ['admin', 'superuser', 'vip', 'premium'];

describe.each([
    ['on', 'true', 'upsell'],
    ['off', 'false', 'hidden'],
] as const)('GET /api/v1/users/me with the gate %s', (_label, gate, notEntitled) => {
    let app: INestApplication;
    let baseUrl: string;

    beforeAll(async () => {
        ({ app, baseUrl } = await bootUsers(gate));
    });

    afterAll(async () => {
        await app?.close();
    });

    const me = async (roles: readonly string[]) => {
        const res = await fetch(`${baseUrl}/api/v1/users/me`, { headers: { 'x-test-roles': JSON.stringify(roles) } });

        expect(res.status).toBe(200);

        return userProfileSchema.parse(await res.json());
    };

    it.each(ENTITLED.map((role) => [role]))('%s is granted', async (role) => {
        expect((await me([role])).account.paidFeatures).toBe('granted');
    });

    it(`default is ${notEntitled}`, async () => {
        expect((await me(['default'])).account.paidFeatures).toBe(notEntitled);
    });

    it(`no roles at all is ${notEntitled} (fails closed, never granted)`, async () => {
        expect((await me([])).account.paidFeatures).toBe(notEntitled);
    });

    it(`an unknown or wrong-case role is ${notEntitled}`, async () => {
        expect((await me(['Premium', 'owner'])).account.paidFeatures).toBe(notEntitled);
    });

    it('answers no subscriptionTier', async () => {
        const res = await fetch(`${baseUrl}/api/v1/users/me`, { headers: { 'x-test-roles': '["premium"]' } });
        const body = (await res.json()) as { account: Record<string, unknown> };

        expect(body.account).not.toHaveProperty('subscriptionTier');
    });

    it('covers every role (non-vacuity)', () => {
        expect(new Set([...ENTITLED, 'default'])).toStrictEqual(new Set(ROLES));
    });
});
