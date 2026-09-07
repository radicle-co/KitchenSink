/**
 * e2e: `ScopesGuard` + `@RequireScopes('admin:users')` actually gate the admin routes over real HTTP —
 * the declarative authZ seam that replaced the imperative `assertAdmin(ctx)` (S-I4). This suite isolates
 * the AUTHORIZATION layer: it boots a minimal Nest app with the REAL `AdminController` (so the REAL
 * `@UseGuards`/`@RequireScopes` wiring runs) and a REAL `ScopesGuard`, but stands in for `AuthMiddleware`
 * with a tiny test-only middleware that sets `req.user` from a header this test controls — Clerk
 * verification + the read-through DB provisioning `AuthMiddleware` normally performs are proven
 * elsewhere (`tests/auth.middleware.test.ts`, `tests/resolveOrCreate.test.ts`) and are out of scope
 * here. No Postgres/LocalStack required — `AdminService` is stubbed.
 *
 * @module
 */
import 'reflect-metadata';

import type { AddressInfo } from 'node:net';

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { NestFactory, APP_PIPE } from '@nestjs/core';
import { Module, type INestApplication } from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';
import type { Request, Response, NextFunction } from 'express';
import { newUserId } from '@kitchensink/identity-db';

import { AdminController } from '../../src/admin/admin.controller.js';
import { AdminService } from '../../src/admin/admin.service.js';
import { ScopesGuard } from '../../src/auth/guards/scopes.guard.js';
import type { AuthorizerContext } from '../../src/auth/decorators/currentUser.decorator.js';

/** Test-only header this suite uses to control the injected `req.user`'s scopes (comma-separated). */
const TEST_SCOPES_HEADER = 'x-test-scopes';

function userFromScopesHeader(header: string | undefined): AuthorizerContext | undefined {
    if (header === undefined) {
        return undefined;
    }

    const scopes = header
        .split(',')
        .map((scope) => scope.trim())
        .filter((scope) => scope.length > 0);

    return {
        // A REAL ULID from the app's own generator. The literal this replaced —
        // `'01HZZE2EADMINAUTHZUSER0000'` — is not a ULID at all: Crockford base32 excludes `U`, so no
        // `newUserId()` can produce it and `isUserId()` rejects it. It only survived because the `as` cast
        // silences the brand. A fixture the system could not have minted is a fixture that proves nothing.
        userId: newUserId() as AuthorizerContext['userId'],
        email: 'admin-e2e@example.com',
        clerkUserId: 'user_admin_e2e',
        scopes,
        permissions: [],
        tokenType: 'user',
    };
}

describe('admin authZ — ScopesGuard e2e', () => {
    let app: INestApplication;
    let baseUrl: string;

    const adminServiceStub = {
        listUsers: vi.fn().mockResolvedValue({ users: [], limit: 50, offset: 0 }),
    };

    // A minimal Nest module wiring the REAL AdminController (so its REAL `@UseGuards`/`@RequireScopes`
    // decorators run) + the REAL ScopesGuard, with AdminService stubbed — no DB required. Built with a
    // plain `@Module` class + `NestFactory.create` (the same primitives `tests/e2e/service-harness.ts`
    // uses for the full app) rather than `@nestjs/testing`'s `Test.createTestingModule`, which is not a
    // dependency of this workspace.
    //
    // ⚠️ THE GLOBAL PIPE IS PART OF THE FIXTURE, because `AppModule` binds one. Without it the `:userId`
    // routes' `AdminUserIdParamDto` is never handed to a pipe, so this suite would run against a route shape
    // production does not have — and a 403-vs-400 ordering claim measured on an app with no validation layer
    // is not a measurement of anything.
    @Module({
        controllers: [AdminController],
        providers: [
            ScopesGuard,
            { provide: AdminService, useValue: adminServiceStub },
            { provide: APP_PIPE, useValue: new ZodValidationPipe() },
        ],
    })
    class TestAdminModule {}

    beforeAll(async () => {
        app = await NestFactory.create(TestAdminModule, { logger: false });

        // Test-only stand-in for AuthMiddleware: injects req.user from a header this test controls.
        // Real Clerk verification + read-through DB provisioning are proven elsewhere; this suite
        // isolates the ScopesGuard authorization layer end-to-end over real HTTP.
        app.use((req: Request & { user?: AuthorizerContext }, _res: Response, next: NextFunction) => {
            req.user = userFromScopesHeader(req.headers[TEST_SCOPES_HEADER] as string | undefined);
            next();
        });

        await app.listen(0);

        const address = app.getHttpServer().address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${address.port}`;
    });

    afterAll(async () => {
        await app?.close();
    });

    it('denies GET /api/v1/admin/users with 403 when the caller lacks admin:users', async () => {
        const res = await fetch(`${baseUrl}/api/v1/admin/users`, {
            headers: { [TEST_SCOPES_HEADER]: 'billing:read' },
        });

        expect(res.status).toBe(403);
        expect(adminServiceStub.listUsers).not.toHaveBeenCalled();
    });

    it('denies GET /api/v1/admin/users with 403 (fail-closed) when there is no authenticated caller at all', async () => {
        const res = await fetch(`${baseUrl}/api/v1/admin/users`);

        expect(res.status).toBe(403);
    });

    it('allows GET /api/v1/admin/users with 200 when the caller has admin:users', async () => {
        const res = await fetch(`${baseUrl}/api/v1/admin/users`, {
            headers: { [TEST_SCOPES_HEADER]: 'admin:users' },
        });

        expect(res.status).toBe(200);
        expect(adminServiceStub.listUsers).toHaveBeenCalled();
    });

    it('allows POST /api/v1/admin/users/:userId/suspend with 200 when the caller has admin:users', async () => {
        const targetId = newUserId();
        const suspendStub = vi
            .fn()
            .mockResolvedValue({ sub: targetId, status: 'suspended', suspendedAt: new Date().toISOString() });

        (adminServiceStub as unknown as { suspendUser: typeof suspendStub }).suspendUser = suspendStub;

        const res = await fetch(`${baseUrl}/api/v1/admin/users/${targetId}/suspend`, {
            method: 'POST',
            headers: { [TEST_SCOPES_HEADER]: 'admin:users' },
        });

        expect(res.status).toBe(200);
        // suspendUser still takes `ctx` (actor identity for the audit log) — only the authz check moved
        // to the guard, so this pins that the controller still forwards the caller's context.
        expect(suspendStub).toHaveBeenCalledWith(targetId, expect.objectContaining({ userId: expect.any(String) }));
    });

    it('denies POST /api/v1/admin/users/:userId/suspend with 403 when the caller lacks admin:users', async () => {
        const suspendStub = vi.fn();

        (adminServiceStub as unknown as { suspendUser: typeof suspendStub }).suspendUser = suspendStub;

        const res = await fetch(`${baseUrl}/api/v1/admin/users/${newUserId()}/suspend`, {
            method: 'POST',
            headers: { [TEST_SCOPES_HEADER]: '' },
        });

        expect(res.status).toBe(403);
        expect(suspendStub).not.toHaveBeenCalled();
    });
});
