/**
 * `FoodsAdminController` (T-184) — the admin-scoped surface under `/api/v1/foods/admin/*` for the operations
 * dashboard (FR-039/US-10): read-only GETs exposing the queue depths, lifecycle backlog, tombstone-row counts
 * and per-source rolling-window utilization, plus U9's operator requeue.
 *
 * A thin Facade over the CQRS pair behind it — the scope gate, the id guard, and a delegation. The queries go
 * to `AdminMetricsService` and the one command to `FoodRecoveryService`; nothing here decides anything else.
 *
 * Auth precedence (FR-051): the `FoodAuthGuard` middleware enforces `401` (authn) ahead of this
 * controller; each route then requires the `food:admin` scope from the verified token's `public_metadata`
 * → `403` otherwise (authenticated-but-unscoped). No internal/DB error is leaked — they propagate to
 * Nest's generic `500`.
 *
 * @implements FR-039 FR-051
 */
import { Controller, Get, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';

import { FOOD_ADMIN_SCOPE, hasScope, type AuthenticatedRequest } from '../../auth/authenticatedPrincipal.js';
import { apiError } from '../../common/apiError.js';
import { isFoodId } from '../../db/ulid.js';
import { AdminMetricsService, type OperationalMetrics } from './adminMetrics.service.js';
import { FoodRecoveryService, type RequeueResponse } from './foodRecovery.service.js';
import type { QueueDepthMetrics } from './adminMetrics.dao.js';

// Canonically served under the `/api/{version}/` prefix. The bare `v1/...` entry is a DEPRECATED ALIAS:
// `/v1/*` is live in production and held by consumers configured OUTSIDE this repo (the Clerk dashboard
// webhook URL) as well as already-shipped mobile builds and cached web bundles, whose endpoints were
// inlined at build time. Removing it REQUIRES updating the Clerk dashboard first — see ADR-0011.
@Controller(['api/v1/foods/admin', 'v1/foods/admin'])
export class FoodsAdminController {
    public constructor(
        private readonly metrics: AdminMetricsService,
        private readonly recovery: FoodRecoveryService,
    ) {}

    /** `GET /api/v1/foods/admin/metrics` — full operational dashboard signals (admin-scoped, FR-039). */
    @Get('metrics')
    public async getMetrics(@Req() req: AuthenticatedRequest): Promise<OperationalMetrics> {
        this.requireAdmin(req);

        return this.metrics.collect();
    }

    /** `GET /api/v1/foods/admin/queue` — focused `fetch_queue` depth signals (admin-scoped, FR-039). */
    @Get('queue')
    public async getQueue(@Req() req: AuthenticatedRequest): Promise<QueueDepthMetrics> {
        this.requireAdmin(req);

        return this.metrics.queueDepths();
    }

    /**
     * `POST /api/v1/foods/admin/foods/:id/requeue` — the operator escape hatch for a blackholed food (U9).
     *
     * ⛔ **This exists because the retry budget is a trap without it.** Five real failures tombstone a food
     * `FAILED` permanently. A transient USDA outage or a bad API key therefore blackholes that food for
     * EVERY user, forever, and the only recovery would be editing the database by hand — which is not a
     * recovery procedure, it is an incident. This clears the attempt count and the terminal mark so the
     * normal drain picks the food up again.
     *
     * Admin-scoped like every other route here: it resets state a user could otherwise use to force
     * unbounded source calls by repeatedly exhausting and clearing a budget.
     *
     * Idempotent — requeuing an already-pending food is a no-op that still answers `202`. A food that is
     * not blackholed at all (`RESOLVED`/`UNRESOLVED`) is a `409` naming `POST /{id}/refetch`, not a `500`.
     */
    @Post('foods/:id/requeue')
    @HttpCode(HttpStatus.ACCEPTED)
    public async requeueFood(@Param('id') id: string, @Req() req: AuthenticatedRequest): Promise<RequeueResponse> {
        this.requireAdmin(req);

        // Same guard every other `:id` route applies. Without it a malformed id reaches two DAO writes and
        // fails as a 500 rather than the 400 the caller can act on — and the route-input inventory in
        // `routeValidation.test.ts` requires every raw param to name the validator that covers it.
        if (!isFoodId(id)) {
            throw apiError('INVALID_ID', 'The id is not a valid food (ingredient) ULID');
        }

        // The verified `sub` — documented on `AuthenticatedPrincipal` as the trace/audit identity — is the
        // accountable principal behind the source calls this requeue authorises (FR-048). `requireAdmin`
        // has already proven `req.user` is present and scoped. It reaches the AUDIT LOG only: the requeue
        // records the CONSTANT `svc_admin_requeue` in `fetch_requesters`, never an operator's own id,
        // because that table is this service's user-erasure surface.
        return this.recovery.requeueFood(id, req.user?.sub ?? '');
    }

    /** Require the `food:admin` scope from the verified token, else `403` (FR-039/FR-051). */
    private requireAdmin(req: AuthenticatedRequest): void {
        if (!hasScope(req.user, FOOD_ADMIN_SCOPE)) {
            throw apiError('FORBIDDEN', 'Operation requires elevated scope');
        }
    }
}
