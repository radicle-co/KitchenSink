/**
 * The admin `{userId}` path parameter, over real HTTP, with the REAL global pipe and the REAL `ScopesGuard`.
 *
 * Three things are proven here that a DTO unit test cannot:
 *
 * 1. **The DTO is actually REACHED.** `createZodDto` classes carry no `class-validator` metadata, so a schema
 *    that is not bound to a pipe validates nothing while looking validated (§15.4(4) — it already bit this
 *    service once on `PATCH /users/me`). Only a known-bad value sent to a real route proves the wiring.
 * 2. **`403` PRECEDES `400`.** Nest runs guards before pipes, so an unauthorized caller sending a malformed id
 *    must be told "forbidden", never "that id is malformed" — otherwise the validation error becomes an
 *    oracle a non-admin can query. This is asserted rather than assumed, because it depends on framework
 *    ordering that a future refactor (a validation middleware, a route-scoped pipe) could silently invert.
 * 3. **Every `:userId` route is covered, and the list is DISCOVERED, not typed out.** §15.5.1: a gate that
 *    enumerates its subjects from a hardcoded list is itself the defect, because route number six will not be
 *    on it. The cases below enumerate `AdminController`'s own Nest route metadata, so a new admin action that
 *    takes a bare `@Param('userId') userId: string` fails this file the day it is added.
 *
 * Runs in the DEFAULT tier (no database, no AWS): identity's e2e job is gated on
 * `steps.secrets.outcome == 'success'` in `.github/workflows/_ci.yml`, and an authorization gate must not
 * live behind a step that can skip.
 *
 * @module
 */
import 'reflect-metadata';

import type { AddressInfo } from 'node:net';

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { NestFactory, APP_PIPE } from '@nestjs/core';
import { Module, type INestApplication } from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';
import type { Request, Response, NextFunction } from 'express';
import { newUserId } from '@kitchensink/identity-db';

import { AdminController } from '../src/admin/admin.controller.js';
import { AdminService } from '../src/admin/admin.service.js';
import { AdminUserIdParamDto } from '../src/admin/dto/admin-user-id.param.dto.js';
import { ScopesGuard } from '../src/auth/guards/scopes.guard.js';
import type { AuthorizerContext } from '../src/auth/decorators/current-user.decorator.js';

/** Test-only header controlling the injected `req.user`'s scopes (comma-separated). */
const TEST_SCOPES_HEADER = 'x-test-scopes';

/** The controller prefix the canonical routes are served under. */
const PREFIX = '/api/v1/admin/users';

/** One discovered admin action route: the handler's name and its Nest path template. */
interface DiscoveredRoute {
    readonly method: string;
    readonly path: string;
}

/**
 * Enumerate `AdminController`'s routes whose path template carries the `:userId` segment, from Nest's own
 * `path` metadata. Discovery, not a list — see this module's docstring.
 */
function discoverUserIdRoutes(): DiscoveredRoute[] {
    const proto = AdminController.prototype as unknown as Record<string, object>;

    return Object.getOwnPropertyNames(proto)
        .filter((name) => name !== 'constructor')
        .map((name) => ({ method: name, path: String(Reflect.getMetadata('path', proto[name]!)) }))
        .filter((route) => route.path.includes(':userId'));
}

const userIdRoutes = discoverUserIdRoutes();

/** Substitute a concrete id into a discovered path template. */
const urlFor = (route: DiscoveredRoute, userId: string): string =>
    `${PREFIX}/${route.path.replace(':userId', encodeURIComponent(userId))}`;

function userFromScopesHeader(header: string | undefined): AuthorizerContext | undefined {
    if (header === undefined) {
        return undefined;
    }

    return {
        userId: newUserId() as AuthorizerContext['userId'],
        email: 'admin@example.test',
        clerkUserId: 'user_admin_param_validation',
        scopes: header
            .split(',')
            .map((scope) => scope.trim())
            .filter((scope) => scope.length > 0),
        permissions: [],
        tokenType: 'user',
    };
}

describe('admin :userId path-parameter validation', () => {
    let app: INestApplication;
    let baseUrl: string;

    // Every admin action resolves through the same spy, so a call that gets past the guard and the pipe is
    // observable as "the service was reached" regardless of which route it was.
    //
    // The stub's method set is built from the DISCOVERED routes rather than typed out — and it is a plain
    // object, deliberately NOT a `Proxy`: a catch-all `get` trap also answers `then` with a function, which
    // makes the provider look like a thenable, and Nest's `await` on it never settles. (Measured: the module
    // factory hung for the full 30s hook timeout.)
    const reached = vi.fn();
    const adminServiceStub = Object.fromEntries(
        userIdRoutes.map((route) => [
            route.method,
            (userId: string) => {
                reached(route.method, userId);

                return Promise.resolve({ sub: userId, status: 'suspended', suspendedAt: new Date().toISOString() });
            },
        ]),
    );

    @Module({
        controllers: [AdminController],
        providers: [
            ScopesGuard,
            { provide: AdminService, useValue: adminServiceStub },
            // The SAME global binding `AppModule` uses. Without it the DTO's metatype is never handed to a
            // pipe and this suite would pass against an unvalidated route — the exact failure it exists for.
            { provide: APP_PIPE, useValue: new ZodValidationPipe() },
        ],
    })
    class TestAdminModule {}

    beforeAll(async () => {
        app = await NestFactory.create(TestAdminModule, { logger: false });

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

    const post = (path: string, scopes: string): Promise<globalThis.Response> =>
        fetch(`${baseUrl}${path}`, { method: 'POST', headers: { [TEST_SCOPES_HEADER]: scopes } });

    it('discovered every admin action route that takes a userId', () => {
        // Non-vacuity: if discovery silently returned nothing, every `it.each` below would vanish and this
        // file would go green having asserted nothing at all.
        expect(userIdRoutes.map((route) => route.method).sort()).toEqual([
            'reactivateUser',
            'startImpersonation',
            'stopImpersonation',
            'suspendUser',
            'unsuspendUser',
        ]);
    });

    // The structural gate. A new route added with `@Param('userId') userId: string` — the shape all five had —
    // fails here, whether or not anyone remembers to add an HTTP case for it.
    it.each(userIdRoutes)('$method binds the validated param DTO, not a bare string', (route) => {
        const paramTypes = Reflect.getMetadata('design:paramtypes', AdminController.prototype, route.method) as
            | unknown[]
            | undefined;

        expect(paramTypes).toContain(AdminUserIdParamDto);
        expect(paramTypes).not.toContain(String);
    });

    it.each(userIdRoutes)('$method answers 400 for a malformed id and never reaches the service', async (route) => {
        reached.mockClear();

        const res = await post(urlFor(route, 'target'), 'admin:users');

        expect(res.status).toBe(400);
        expect(reached).not.toHaveBeenCalled();
    });

    it.each(userIdRoutes)('$method answers 200 for a well-formed id', async (route) => {
        reached.mockClear();
        const userId = newUserId();

        const res = await post(urlFor(route, userId), 'admin:users');

        expect(res.status).toBe(200);
        expect(reached).toHaveBeenCalledWith(route.method, userId);
    });

    // ⛔ THE PRECEDENCE ASSERTION. If a refactor moves validation ahead of authorization, an unauthenticated
    // stranger learns which ids are well-formed from the status code alone. Nest's guards-before-pipes order
    // is what prevents that, and this is the test that notices if it stops being true.
    it.each(userIdRoutes)(
        '$method answers 403 — NOT 400 — for an unauthorized caller sending a malformed id',
        async (route) => {
            const res = await post(urlFor(route, 'target'), 'billing:read');

            expect(res.status).toBe(403);
        },
    );

    it.each(userIdRoutes)(
        '$method gives an unauthorized caller the SAME 403 for malformed and well-formed ids',
        async (route) => {
            const malformed = await post(urlFor(route, 'target'), '');
            const wellFormed = await post(urlFor(route, newUserId()), '');

            expect(malformed.status).toBe(wellFormed.status);
            expect(malformed.status).toBe(403);
        },
    );
});
