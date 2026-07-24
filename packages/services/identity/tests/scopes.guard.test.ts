/**
 * Unit tests for {@link ScopesGuard} — the declarative authorization Guard (see the pattern JSDoc on the
 * guard itself). These pin the contract that replaces the old imperative `assertAdmin(ctx)`: a required
 * scope satisfied via either `scopes` OR `permissions` passes; an unsatisfied requirement throws
 * `ForbiddenException`; and the guard fails closed (throws, never allows) when `req.user` is absent.
 */
import { describe, it, expect, vi } from 'vitest';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';

import { ScopesGuard } from '../src/auth/guards/scopes.guard.js';
import type { AuthorizerContext } from '../src/auth/decorators/current-user.decorator.js';

function makeUser(overrides: Partial<AuthorizerContext> = {}): AuthorizerContext {
    return {
        userId: '01HZZSCOPESGUARDUSER00000' as AuthorizerContext['userId'],
        email: 'admin@example.com',
        clerkUserId: 'user_admin',
        scopes: [],
        permissions: [],
        tokenType: 'user',
        ...overrides,
    };
}

/** Build a mock `ExecutionContext` whose `switchToHttp().getRequest()` returns `{ user }`. */
function makeContext(user: AuthorizerContext | undefined): ExecutionContext {
    return {
        switchToHttp: () => ({
            getRequest: () => ({ user }),
        }),
        getHandler: () => {},
        getClass: () => {},
    } as unknown as ExecutionContext;
}

/** Build a mock `Reflector` whose `getAllAndOverride` returns the given required scopes. */
function makeReflector(requiredScopes: string[] | undefined): Reflector {
    return { getAllAndOverride: vi.fn().mockReturnValue(requiredScopes) } as unknown as Reflector;
}

describe('ScopesGuard', () => {
    it('returns true when the required scope is present in req.user.scopes', () => {
        const guard = new ScopesGuard(makeReflector(['admin:users']));
        const context = makeContext(makeUser({ scopes: ['admin:users'] }));

        expect(guard.canActivate(context)).toBe(true);
    });

    it('returns true when the required scope is present in req.user.permissions (scopes OR permissions)', () => {
        const guard = new ScopesGuard(makeReflector(['admin:users']));
        const context = makeContext(makeUser({ permissions: ['admin:users'] }));

        expect(guard.canActivate(context)).toBe(true);
    });

    it('throws ForbiddenException when neither scopes nor permissions include the required scope', () => {
        const guard = new ScopesGuard(makeReflector(['admin:users']));
        const context = makeContext(makeUser({ scopes: ['billing:read'], permissions: [] }));

        expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('requires EVERY listed scope — fails when only some are granted', () => {
        const guard = new ScopesGuard(makeReflector(['admin:users', 'billing:read']));
        const context = makeContext(makeUser({ scopes: ['admin:users'], permissions: [] }));

        expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('passes when every listed scope is granted across scopes + permissions combined', () => {
        const guard = new ScopesGuard(makeReflector(['admin:users', 'billing:read']));
        const context = makeContext(makeUser({ scopes: ['admin:users'], permissions: ['billing:read'] }));

        expect(guard.canActivate(context)).toBe(true);
    });

    it('fails closed: throws ForbiddenException when req.user is absent, even with scopes required', () => {
        const guard = new ScopesGuard(makeReflector(['admin:users']));
        const context = makeContext(undefined);

        expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('does not allow via a falsy/empty scopes+permissions bypass when req.user is absent', () => {
        // Regression guard: canActivate must check `user` presence BEFORE reading .scopes/.permissions,
        // not rely on a default that could accidentally read as "no requirement, so allow".
        const guard = new ScopesGuard(makeReflector(['admin:users']));

        expect(() => guard.canActivate(makeContext(undefined))).toThrow('Admin user scope required');
    });

    it('allows the request through when no scopes are required (no @RequireScopes metadata)', () => {
        const guard = new ScopesGuard(makeReflector(undefined));
        const context = makeContext(undefined);

        expect(guard.canActivate(context)).toBe(true);
    });

    it('reads metadata from both the handler and the class via getAllAndOverride', () => {
        const reflector = makeReflector(['admin:users']);
        const guard = new ScopesGuard(reflector);
        const context = makeContext(makeUser({ scopes: ['admin:users'] }));
        const handler = context.getHandler();
        const klass = context.getClass();

        guard.canActivate(context);

        expect(reflector.getAllAndOverride).toHaveBeenCalledWith('requiredScopes', [handler, klass]);
    });
});
