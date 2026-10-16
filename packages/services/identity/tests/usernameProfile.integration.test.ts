/**
 * Integration: `user.username` on `GET /api/v1/users/me` over real HTTP, with the database stubbed (plan
 * `docs/plans/2026-10-15-010-feat-username-byline-plan.md` D9; `docs/CODING_STANDARDS.md` §7.1a).
 *
 * The REAL `UsersController` and `UsersService` over a stubbed resolver and drizzle handle, as in
 * `paidFeatures.integration.test.ts`. Each response is parsed with the PUBLISHED `userProfileSchema`
 * (`@kitchensink/schema-identity`), so a service that answers a shape the schema package does not carry fails here.
 *
 * @module
 */
import 'reflect-metadata';

import type { AddressInfo } from 'node:net';

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
import { AVATAR_MEDIA } from '../src/users/avatarMedia.js';
import { HANDLE_SYNC_PUBLISHER, noopHandleSyncPublisher } from '../src/users/handleSync.publisher.js';
import { PAID_FEATURES_GATE } from '../src/users/paidFeaturesGate.provider.js';
import { ResolveUserService } from '../src/users/resolveUser.js';
import { UsersController } from '../src/users/users.controller.js';
import { UsersService } from '../src/users/users.service.js';

const USER_ID = '01HZZZZZZZZZZZZZZZZZZZZZUN';
const NOW = new Date('2026-10-15T00:00:00.000Z');
const user = {
    id: USER_ID,
    identityId: 'user_un',
    email: 'un@example.com',
    status: 'active',
    createdAt: NOW,
    updatedAt: NOW,
};
const account = { id: 'a-un', userId: USER_ID, subscriptionTier: 'free', createdAt: NOW, updatedAt: NOW };

/** The profile row the stubbed read returns; each case sets its username. */
let profileUsername: string | null = null;

describe('GET /api/v1/users/me — the username', () => {
    let app: INestApplication;
    let baseUrl: string;

    beforeAll(async () => {
        const db = {
            select: vi.fn(() => ({
                from: () => ({
                    where: () => ({
                        limit: () =>
                            Promise.resolve([
                                {
                                    id: 'p-un',
                                    userId: USER_ID,
                                    displayName: 'Ada Lovelace',
                                    avatarUrl: null,
                                    username: profileUsername,
                                    updatedAt: NOW,
                                },
                            ]),
                    }),
                }),
            })),
        };

        @Module({
            controllers: [UsersController],
            providers: [
                UsersService,
                { provide: PAID_FEATURES_GATE, useValue: false },
                { provide: DrizzleProvider, useValue: db },
                { provide: SqsService, useValue: {} },
                {
                    provide: ResolveUserService,
                    useValue: { resolveUser: vi.fn().mockResolvedValue({ user, account }) },
                },
                { provide: HANDLE_SYNC_PUBLISHER, useValue: noopHandleSyncPublisher },
                { provide: AVATAR_MEDIA, useValue: {} },
                { provide: APP_PIPE, useValue: new ZodValidationPipe() },
            ],
        })
        class TestUsersModule {}

        app = await NestFactory.create(TestUsersModule, { logger: false });
        app.use((req: Request & { user?: AuthorizerContext }, _res: Response, next: NextFunction) => {
            req.user = {
                userId: USER_ID as AuthorizerContext['userId'],
                email: 'un@example.com',
                clerkUserId: 'user_un',
                scopes: [],
                permissions: [],
                roles: [],
                tokenType: 'user',
                testPrincipal: false,
            };
            next();
        });
        await app.init();
        await app.listen(0);
        baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    });

    afterAll(async () => {
        await app?.close();
    });

    const me = async () => {
        const res = await fetch(`${baseUrl}/api/v1/users/me`);

        expect(res.status).toBe(200);

        return userProfileSchema.parse(await res.json());
    };

    it('answers the profile’s username beside the display name', async () => {
        profileUsername = 'goodfellow';

        const body = await me();

        expect(body.user.username).toBe('goodfellow');
        expect(body.user.displayName).toBe('Ada Lovelace');
    });

    it('answers null — the key present, never absent or empty — when the profile has none', async () => {
        profileUsername = null;

        const res = await fetch(`${baseUrl}/api/v1/users/me`);
        const raw = (await res.json()) as { user: Record<string, unknown> };

        expect(raw.user).toHaveProperty('username', null);
        expect(userProfileSchema.parse(raw).user.username).toBeNull();
    });
});
