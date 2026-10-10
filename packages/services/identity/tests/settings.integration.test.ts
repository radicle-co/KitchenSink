/**
 * Integration: `/api/v1/users/me/settings` over real HTTP, with the database mocked (ADR-0059,
 * `docs/CODING_STANDARDS.md` §7.1a).
 *
 * Two apps, because two different layers are under test:
 *
 * 1. A minimal Nest app with the REAL `SettingsController`, the REAL `SettingsService` and the REAL global
 *    `ZodValidationPipe`, over a stubbed `SettingsDAO`. It proves the response shapes and the `400`s. Auth is a
 *    header-driven stand-in for `AuthMiddleware`, as in `adminAuthz.integration.test.ts`.
 * 2. The FULL `AppModule` with `pg` mocked and NO dev-auth bypass, to prove the route sits behind the real
 *    `AuthMiddleware`: no token is a `401`, whatever the body.
 *
 * What neither can prove — the migration, the grants, the one-statement upsert — is the LOCAL e2e tier's job
 * (`tests/e2e/migration0015Settings.e2e.test.ts`).
 *
 * @module
 */
import 'reflect-metadata';

import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { APP_PIPE, NestFactory } from '@nestjs/core';
import { Module, type INestApplication } from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';
import type { NextFunction, Request, Response } from 'express';
import { newUserId, SettingsDAO } from '@kitchensink/identity-db';
import { userSettingsSchema } from '@kitchensink/schema-identity';

vi.mock('pg', () => {
    class Pool {
        connect = vi.fn();
        query = vi.fn();
        end = vi.fn();
        on = vi.fn();
    }

    return { default: { Pool } };
});

vi.mock('@aws-sdk/client-sqs', () => ({
    SQSClient: vi.fn(),
    SendMessageCommand: vi.fn(),
}));

import type { BootedServiceApp } from '@kitchensink/service-test-harness';

import type { AuthorizerContext } from '../src/auth/decorators/currentUser.decorator.js';
import { SettingsController } from '../src/settings/settings.controller.js';
import { SettingsService } from '../src/settings/settings.service.js';
import { bootIdentityApp } from './support/identityApp.js';

const USER_ID = newUserId();
const row = (searchShortcut: boolean | null) => ({ userId: USER_ID, searchShortcut, updatedAt: new Date(0) });

describe('settings routes (controller + service + pipe, DAO stubbed)', () => {
    let app: INestApplication;
    let baseUrl: string;
    const dao = { findByUserId: vi.fn(), upsertForActiveUser: vi.fn() };

    @Module({
        controllers: [SettingsController],
        providers: [
            SettingsService,
            { provide: SettingsDAO, useValue: dao },
            { provide: APP_PIPE, useValue: new ZodValidationPipe() },
        ],
    })
    class TestSettingsModule {}

    beforeAll(async () => {
        app = await NestFactory.create(TestSettingsModule, { logger: false });
        app.use((req: Request & { user?: AuthorizerContext }, _res: Response, next: NextFunction) => {
            req.user = {
                userId: USER_ID,
                email: 'settings@example.com',
                clerkUserId: 'user_settings',
                scopes: [],
                permissions: [],
                tokenType: 'user',
                testPrincipal: false,
            };
            next();
        });
        await app.listen(0);
        baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    });

    afterAll(async () => {
        await app?.close();
    });

    const patch = (body: string) =>
        fetch(`${baseUrl}/api/v1/users/me/settings`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body,
        });

    it('GET answers 200 with the DEFAULTS for a user who never chose, in the published shape', async () => {
        dao.findByUserId.mockResolvedValueOnce(undefined);

        const res = await fetch(`${baseUrl}/api/v1/users/me/settings`);

        expect(res.status).toBe(200);
        expect(userSettingsSchema.parse(await res.json())).toEqual({ searchShortcut: true });
        expect(dao.upsertForActiveUser).not.toHaveBeenCalled();
    });

    it('GET answers the stored choice', async () => {
        dao.findByUserId.mockResolvedValueOnce(row(false));

        const res = await fetch(`${baseUrl}/api/v1/users/me/settings`);

        expect(userSettingsSchema.parse(await res.json())).toEqual({ searchShortcut: false });
    });

    it('PATCH answers 200 with the resolved settings and writes only what was sent', async () => {
        dao.upsertForActiveUser.mockResolvedValueOnce(row(false));

        const res = await patch(JSON.stringify({ searchShortcut: false }));

        expect(res.status).toBe(200);
        expect(userSettingsSchema.parse(await res.json())).toEqual({ searchShortcut: false });
        expect(dao.upsertForActiveUser).toHaveBeenCalledWith(USER_ID, { searchShortcut: false });
    });

    it('PATCH {} is a 200 no-op that writes nothing', async () => {
        dao.upsertForActiveUser.mockClear();
        dao.findByUserId.mockResolvedValueOnce(row(false));

        const res = await patch('{}');

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ searchShortcut: false });
        expect(dao.upsertForActiveUser).not.toHaveBeenCalled();
    });

    it.each([
        ['an unknown key', { searchShortcut: true, theme: 'dark' }],
        ['a non-boolean value', { searchShortcut: 'yes' }],
        ['null', { searchShortcut: null }],
    ])('PATCH with %s is a 400 and writes nothing', async (_label, body) => {
        dao.upsertForActiveUser.mockClear();

        const res = await patch(JSON.stringify(body));

        expect(res.status).toBe(400);
        expect(dao.upsertForActiveUser).not.toHaveBeenCalled();
    });

    it('PATCH with no body at all is a 400', async () => {
        const res = await fetch(`${baseUrl}/api/v1/users/me/settings`, { method: 'PATCH' });

        expect(res.status).toBe(400);
    });

    it('PATCH answers 403 when the user is no longer active', async () => {
        dao.upsertForActiveUser.mockResolvedValueOnce(undefined);

        const res = await patch(JSON.stringify({ searchShortcut: true }));

        expect(res.status).toBe(403);
    });

    it('does not serve the deprecated bare alias', async () => {
        const res = await fetch(`${baseUrl}/v1/users/me/settings`);

        expect(res.status).toBe(404);
    });
});

describe('settings routes behind the real AuthMiddleware', () => {
    let booted: BootedServiceApp;

    beforeAll(async () => {
        booted = await bootIdentityApp();
    });

    afterAll(async () => {
        await booted?.close();
    });

    it.each([
        ['GET', undefined],
        ['PATCH', JSON.stringify({ searchShortcut: false })],
    ])('%s without a token is a 401', async (method, body) => {
        const res = await fetch(`${booted.baseUrl}/api/v1/users/me/settings`, {
            method,
            headers: { 'content-type': 'application/json' },
            ...(body === undefined ? {} : { body }),
        });

        expect(res.status).toBe(401);
    });

    it('a malformed body without a token is still a 401, not a 400 (auth runs first)', async () => {
        const res = await fetch(`${booted.baseUrl}/api/v1/users/me/settings`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ bogus: true }),
        });

        expect(res.status).toBe(401);
    });
});
