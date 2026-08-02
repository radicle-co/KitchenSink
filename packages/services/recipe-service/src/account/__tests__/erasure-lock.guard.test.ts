/**
 * HAZ-052-test — unit tests for {@link ErasureLockGuard}, the erasure write-lock (Catastrophic hazard
 * mitigation). Mocks {@link ErasureJobsDal}; no database.
 *
 * Requirement → test map:
 *
 *   - **The gap this closes** — before HAZ-052, `ERASURE_IN_PROGRESS` was defined and mapped to 423 by
 *     `ApiExceptionFilter` but never thrown anywhere, so a being-erased user could still mutate. This
 *     guard is the ONE authoritative seam that closes it.
 *   - **Mutating methods only** — POST/PUT/PATCH/DELETE consult the DAL; GET/HEAD never do (no extra
 *     round trip on the read path).
 *     → `describe('read methods never touch the DAL')` / `describe('mutating methods')`
 *   - **The lock statuses** — only a `queued`/`running` job (what `findActiveJob` returns) blocks; a
 *     terminal job does not exist in that set, so it never even reaches this guard's decision.
 *     → `describe('mutating methods')`
 *   - **`@SkipErasureLock()`** — the one exemption (`POST /api/v1/account/erasure` itself), checked BEFORE
 *     the DAL call so the exempted route also avoids the extra round trip.
 *     → `describe('the @SkipErasureLock() exemption')`
 *   - **Fail-closed auth is upstream, not duplicated here** — a mutating request with no principal is
 *     unreachable in production (`AuthMiddleware` already rejected it with 401), so this guard fails
 *     OPEN on that case rather than fabricate a 423 that belongs to the auth layer.
 *     → `describe('no principal on the request')`
 */
import 'reflect-metadata';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RecipeErrorCode } from '@kitchensink/recipe-core';

import type { ErasureJobsDal } from '../dal/erasure-jobs.dal.js';
import { ErasureLockGuard } from '../erasure-lock.guard.js';
import { SkipErasureLock } from '../skip-erasure-lock.decorator.js';
import { makeActiveErasureJob } from '../__fixtures__/erasure.fixtures.js';
import { isRecipeDomainError } from '../../recipes/recipe.error.js';

type DalMock = { findActiveJob: ReturnType<typeof vi.fn> };

const OWNER = 'owner-1';

/** A DAL mock defaulting to "no in-flight job" (the allow path). */
function makeDal(): DalMock {
    return { findActiveJob: vi.fn().mockResolvedValue(undefined) };
}

/** A bare controller class carrying an undecorated handler — the common (locked) case. */
class PlainController {
    public handler(): void {}
}

/** A controller whose handler is exempted — mirrors `AccountController.requestErasure`. */
class ExemptController {
    @SkipErasureLock()
    public handler(): void {}
}

/** Minimal `ExecutionContext` exposing only what {@link ErasureLockGuard} reads. */
function contextFor(
    method: string,
    principal: { userId: string } | undefined,
    handler: () => void = PlainController.prototype.handler,
    controllerClass: unknown = PlainController,
): ExecutionContext {
    const req = { method, principal };

    return {
        getHandler: () => handler,
        getClass: () => controllerClass,
        switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
}

let dal: DalMock;
let guard: ErasureLockGuard;

beforeEach(() => {
    dal = makeDal();
    guard = new ErasureLockGuard(dal as unknown as ErasureJobsDal, new Reflector());
});

describe('read methods never touch the DAL', () => {
    it.each(['GET', 'HEAD'])('allows a %s request without calling findActiveJob', async (method) => {
        const ctx = contextFor(method, { userId: OWNER });

        await expect(guard.canActivate(ctx)).resolves.toBe(true);
        expect(dal.findActiveJob).not.toHaveBeenCalled();
    });
});

describe('mutating methods', () => {
    it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('consults the DAL for a %s request', async (method) => {
        const ctx = contextFor(method, { userId: OWNER });

        await expect(guard.canActivate(ctx)).resolves.toBe(true);
        expect(dal.findActiveJob).toHaveBeenCalledExactlyOnceWith(OWNER);
    });

    it('rejects with ERASURE_IN_PROGRESS (→ 423 via ApiExceptionFilter) when a queued job is active', async () => {
        dal.findActiveJob.mockResolvedValue(makeActiveErasureJob({ status: 'queued' }));
        const ctx = contextFor('POST', { userId: OWNER });

        await expect(guard.canActivate(ctx)).rejects.toSatisfy(
            (error: unknown) => isRecipeDomainError(error) && error.code === RecipeErrorCode.ERASURE_IN_PROGRESS,
        );
    });

    it('rejects with ERASURE_IN_PROGRESS when a running job is active', async () => {
        dal.findActiveJob.mockResolvedValue(makeActiveErasureJob({ status: 'running' }));
        const ctx = contextFor('DELETE', { userId: OWNER });

        await expect(guard.canActivate(ctx)).rejects.toSatisfy(
            (error: unknown) => isRecipeDomainError(error) && error.code === RecipeErrorCode.ERASURE_IN_PROGRESS,
        );
    });

    it('allows the mutation when the DAL reports no in-flight job — a terminal (completed/failed) job never blocks', async () => {
        // `findActiveJob` only ever returns queued/running rows (T134 DAL contract); a completed/failed
        // job is outside that set, so it surfaces here as `undefined` — indistinguishable from "never
        // erased" from this guard's point of view, which is exactly the point: a terminal job must not
        // permanently lock the account.
        dal.findActiveJob.mockResolvedValue(undefined);
        const ctx = contextFor('PATCH', { userId: OWNER });

        await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('scopes the DAL lookup to the REQUESTING principal only — never a client-suppliable value', async () => {
        const ctx = contextFor('POST', { userId: 'a-different-owner' });

        await guard.canActivate(ctx);

        expect(dal.findActiveJob).toHaveBeenCalledExactlyOnceWith('a-different-owner');
    });
});

describe('the @SkipErasureLock() exemption', () => {
    it('allows a mutating request on an exempted handler WITHOUT calling the DAL, even with an active job', async () => {
        dal.findActiveJob.mockResolvedValue(makeActiveErasureJob());
        const ctx = contextFor('POST', { userId: OWNER }, ExemptController.prototype.handler, ExemptController);

        await expect(guard.canActivate(ctx)).resolves.toBe(true);
        expect(dal.findActiveJob).not.toHaveBeenCalled();
    });
});

describe('no principal on the request', () => {
    it('allows a mutating request with no principal without calling the DAL (AuthMiddleware already fail-closed upstream)', async () => {
        const ctx = contextFor('POST', undefined);

        await expect(guard.canActivate(ctx)).resolves.toBe(true);
        expect(dal.findActiveJob).not.toHaveBeenCalled();
    });
});

describe('DAL failure fails closed', () => {
    it('propagates a findActiveJob rejection instead of allowing the mutation through', async () => {
        // Regression guard: if a future edit wraps the DAL call in try/catch and returns `true` on
        // error, this test starts failing — a DB outage must reject the mutation, never silently
        // admit it. (Reasoning check: were the guard changed to catch-and-allow, this `rejects`
        // assertion would instead see a resolved `true` and fail.)
        const dalError = new Error('connection reset');
        dal.findActiveJob.mockRejectedValue(dalError);
        const ctx = contextFor('POST', { userId: OWNER });

        await expect(guard.canActivate(ctx)).rejects.toBe(dalError);
    });
});
