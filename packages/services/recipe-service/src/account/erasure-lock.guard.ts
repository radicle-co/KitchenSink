/**
 * `ErasureLockGuard` — the HAZ-052 (Catastrophic) mitigation: the erasure write-lock.
 *
 * **The gap this closes.** `RecipeErrorCode.ERASURE_IN_PROGRESS` was defined and mapped to `423 Locked`
 * by `ApiExceptionFilter` from the start, but nothing ever THREW it. `AuthMiddleware`/`ClerkAuthService`
 * only verify the Clerk JWT — they never touch Clerk, and `AccountModule.requestErasure` never revokes
 * the caller's session — so during the async window between "erasure job written" and "worker marks it
 * completed", the being-erased user's session stayed valid and every mutating endpoint kept accepting
 * writes: a genuine unguarded-mutation race against the erasure (re-creating data mid-erase, or handing
 * the worker a partial/inconsistent set to purge).
 *
 * **The enforcement seam: ONE global `CanActivate`, not a per-service check.** Registered once as an
 * `APP_GUARD` in `AppModule` (mirroring `UserThrottlerGuard`), so it runs on every controller without
 * being — or having to be — remembered per handler. The alternative (a check inside each mutating
 * service method: `RecipesService.create`, `CollectionsService.addRecipe`, `PhotosService.confirm`, …)
 * scales with the number of writers and is exactly the shape that lets a future write silently ship
 * unlocked; a single seam applied to the HTTP method itself cannot be forgotten by a new controller. The
 * cost of centralizing here is that the guard is coarse — it does not know or care WHICH resource is
 * being mutated, only that the caller has an erasure in flight — which is precisely the "coarse lock"
 * HAZ-052's own mitigation text calls for: the erasure is a hard purge of everything the owner has, so a
 * lock scoped any finer would still have to cover the same set.
 *
 * **What "in progress" means, precisely.** `ErasureJobsDal.findActiveJob` only ever returns a
 * `queued`/`running` row — the two non-terminal statuses of `account_erasure_jobs`
 * (`ACTIVE_ERASURE_JOB_STATUSES`). A `completed` or `failed` job is outside that set and therefore
 * invisible here, so it can never permanently lock the account: `completed` has nothing left to protect
 * (the account is gone, and a live Clerk session for it would be a Clerk-side concern, not this guard's),
 * and `failed` must allow the account to keep working (and a future erasure retry to succeed) rather than
 * fossilizing the last attempt's lock forever.
 *
 * **Concurrency.** The lock is intentionally coarse-grained rather than transactionally exact: a mutation
 * that begins in the instant BEFORE `ErasureService.requestErasure` inserts the job row is not caught —
 * there is no mutex spanning both operations, and adding one would serialize every write in the service
 * behind every erasure check for a race window measured in milliseconds. What matters is that once the
 * row exists, EVERY subsequent mutating request from that owner sees it (`findActiveJob` reads
 * read-committed Postgres state) and is rejected — the worker itself is idempotent (T134/T136b), so a
 * mutation that lands microseconds before the lock engages is, at worst, re-purged on the worker's next
 * pass, never silently kept.
 *
 * **Reads are exempt.** GET/HEAD requests never call the DAL — the HTTP method is checked BEFORE any I/O,
 * so a being-erased owner's reads pay no extra round trip and are never blocked (HAZ-052 rejects
 * MUTATIONS, not visibility).
 *
 * **The erasure-request endpoint itself is exempt** (`@SkipErasureLock()` on
 * `AccountController.requestErasure`) — see that decorator's docstring for why.
 *
 * **The worker path is unaffected, by construction, not by an exemption.** `recipe-workers`'
 * `account-erasure-worker` is an SQS-triggered Lambda that talks to Postgres/S3 directly; it never goes
 * through `AuthMiddleware`, Nest's HTTP pipeline, or this guard at all, so there is nothing to skip.
 */
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { AuthenticatedRequest } from '../auth/principal.js';
import { ErasureJobsDal } from './dal/erasure-jobs.dal.js';
import { erasureInProgressError } from './erasure-lock.error.js';
import { SKIP_ERASURE_LOCK } from './skip-erasure-lock.decorator.js';

/** HTTP methods this guard treats as mutating. Every other method (GET/HEAD/…) is allowed unconditionally. */
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

@Injectable()
export class ErasureLockGuard implements CanActivate {
    public constructor(
        private readonly jobs: ErasureJobsDal,
        private readonly reflector: Reflector,
    ) {}

    /**
     * Allow the request, or reject a mutation from an owner with an in-flight erasure job.
     *
     * @param context - The Nest execution context for the current request.
     * @returns `true` when the request may proceed.
     * @throws {RecipeDomainError} `ERASURE_IN_PROGRESS` (→ 423) when the caller has a `queued`/`running`
     *   erasure job and the route is not `@SkipErasureLock()`-exempted.
     * @sideEffect Reads `account_erasure_jobs` via the DAL, ONLY for mutating, non-exempt requests.
     */
    public async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

        // GET/HEAD are exempt because no read handler mutates owner-scoped, erasable data; the sole
        // GET-write — ingredients status refresh (`GET /v1/ingredients/{id}/status` → `refreshStatus`) —
        // touches only the global dedup catalog, out of erasure scope. A future GET that writes
        // owner-owned data MUST NOT rely on this exemption.
        if (!MUTATING_METHODS.has(request.method)) {
            return true;
        }

        const skip = this.reflector.getAllAndOverride<boolean>(SKIP_ERASURE_LOCK, [
            context.getHandler(),
            context.getClass(),
        ]);

        if (skip === true) {
            return true;
        }

        const ownerId = request.principal?.userId;

        if (ownerId === undefined) {
            // Unreachable in production: the fail-closed AuthMiddleware runs before every guard and
            // already rejected an unauthenticated non-public route with 401. Failing OPEN here (rather
            // than fabricating a 423) keeps the "no auth" decision owned by the auth layer alone.
            return true;
        }

        const active = await this.jobs.findActiveJob(ownerId);

        if (active !== undefined) {
            throw erasureInProgressError(ownerId);
        }

        return true;
    }
}
