/**
 * Unit tests for {@link FoodsAdminController} (T-184) — the admin-scope gate over a mocked
 * {@link AdminMetricsService}. The `401` (authn) layer is the `FoodAuthGuard` middleware (covered
 * by the e2e); this suite pins that every operational GET requires the `food:admin` scope (FR-039) and
 * returns the service's metrics when the scope is present.
 *
 * Requirement → test mapping:
 * - FR-039 / FR-051 → authenticated-but-unscoped → 403 `FORBIDDEN`; scoped → 200 + metrics.
 *
 * The rejection is asserted by STATUS + published `code`, not by which `HttpException` subclass was constructed:
 * the status comes from the one `FOOD_ERROR_STATUS` table (`common/api-error.ts`), and this route used to emit the
 * legacy `{ error: 'Forbidden', message }` body that the 2026-08-12 convergence removed.
 */
import { HttpException, HttpStatus } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthenticatedRequest } from '../../../auth/authenticated-principal.js';
import type { ApiErrorBody } from '../../../common/api-error.schema.js';
import { AdminMetricsService } from '../admin-metrics.service.js';
import { FoodsAdminController } from '../foods-admin.controller.js';

const METRICS = {
    queue: { pending: 1, inFlight: 0, tombstone: 2 },
    backlog: { unresolved: 3, notFound: 4, failed: 0 },
    sources: [
        { source: 'usda', windowCount: 10, hardCap: 1000, pauseThreshold: 900, utilization: 0.01, paused: false },
    ],
};

function makeReq(scopes: string[] = []): AuthenticatedRequest {
    return { user: { sub: 'admin_1', scopes, permissions: [] } } as unknown as AuthenticatedRequest;
}

function makeController(): { controller: FoodsAdminController; service: Record<string, ReturnType<typeof vi.fn>> } {
    const service = {
        collect: vi.fn().mockResolvedValue(METRICS),
        queueDepths: vi.fn().mockResolvedValue(METRICS.queue),
    };

    return { controller: new FoodsAdminController(service as unknown as AdminMetricsService), service };
}

describe('FoodsAdminController scope gate (FR-039)', () => {
    let ctx: ReturnType<typeof makeController>;

    beforeEach(() => {
        ctx = makeController();
    });

    it.each([
        ['metrics', (c: FoodsAdminController) => c.getMetrics(makeReq([])), 'collect'],
        ['queue', (c: FoodsAdminController) => c.getQueue(makeReq(['some:other'])), 'queueDepths'],
    ])('rejects GET /admin/%s without the food:admin scope → 403 FORBIDDEN', async (_label, call, method) => {
        let thrown: unknown;

        try {
            await call(ctx.controller);
        } catch (error) {
            thrown = error;
        }

        expect(thrown).toBeInstanceOf(HttpException);
        expect((thrown as HttpException).getStatus()).toBe(HttpStatus.FORBIDDEN);
        expect(((thrown as HttpException).getResponse() as ApiErrorBody).code).toBe('FORBIDDEN');
        expect(ctx.service[method]).not.toHaveBeenCalled();
    });

    it('returns the full operational metrics with the food:admin scope', async () => {
        const result = await ctx.controller.getMetrics(makeReq(['food:admin']));

        expect(result).toEqual(METRICS);
        expect(ctx.service['collect']).toHaveBeenCalledOnce();
    });

    it('returns the queue depths with the food:admin scope', async () => {
        const result = await ctx.controller.getQueue(makeReq(['food:admin']));

        expect(result).toEqual(METRICS.queue);
    });
});
