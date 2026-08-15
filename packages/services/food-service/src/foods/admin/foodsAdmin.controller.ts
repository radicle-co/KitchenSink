/**
 * `FoodsAdminController` (T-184) — the admin-scoped operational-query surface under `/api/v1/foods/admin/*`
 * for the operations dashboard (FR-039/US-10). Read-only GETs exposing the queue depths, lifecycle
 * backlog, tombstone-row counts, and per-source rolling-window utilization.
 *
 * Auth precedence (FR-051): the `FoodAuthGuard` middleware enforces `401` (authn) ahead of this
 * controller; each route then requires the `food:admin` scope from the verified token's `public_metadata`
 * → `403` otherwise (authenticated-but-unscoped). No internal/DB error is leaked — they propagate to
 * Nest's generic `500`.
 *
 * @implements FR-039 FR-051
 */
import { Controller, Get, Req } from '@nestjs/common';

import { FOOD_ADMIN_SCOPE, hasScope, type AuthenticatedRequest } from '../../auth/authenticatedPrincipal.js';
import { apiError } from '../../common/apiError.js';
import { AdminMetricsService, type OperationalMetrics } from './adminMetrics.service.js';
import type { QueueDepthMetrics } from './adminMetrics.dao.js';

// Canonically served under the `/api/{version}/` prefix. The bare `v1/...` entry is a DEPRECATED ALIAS:
// `/v1/*` is live in production and held by consumers configured OUTSIDE this repo (the Clerk dashboard
// webhook URL) as well as already-shipped mobile builds and cached web bundles, whose endpoints were
// inlined at build time. Removing it REQUIRES updating the Clerk dashboard first — see ADR-0011.
@Controller(['api/v1/foods/admin', 'v1/foods/admin'])
export class FoodsAdminController {
    public constructor(private readonly metrics: AdminMetricsService) {}

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

    /** Require the `food:admin` scope from the verified token, else `403` (FR-039/FR-051). */
    private requireAdmin(req: AuthenticatedRequest): void {
        if (!hasScope(req.user, FOOD_ADMIN_SCOPE)) {
            throw apiError('FORBIDDEN', 'Operation requires elevated scope');
        }
    }
}
