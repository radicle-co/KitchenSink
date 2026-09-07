/**
 * Unit tests for {@link FoodsAdminController} (T-184) — the admin-scope gate over a mocked
 * {@link AdminMetricsService} and {@link FoodRecoveryService}. The `401` (authn) layer is the
 * `FoodAuthGuard` middleware (covered by the e2e); this suite pins that every admin route requires the
 * `food:admin` scope (FR-039) and delegates to the right collaborator when the scope is present.
 *
 * Requirement → test mapping:
 * - FR-039 / FR-051 → authenticated-but-unscoped → 403 `FORBIDDEN`; scoped → 200 + metrics.
 * - U9 → the requeue is scope-gated like the GETs, validates the id AFTER the scope check (FR-051 puts
 *   `403` ahead of `400`), and reaches the recovery service — never the metrics service — carrying the
 *   VERIFIED operator, which is the only record of who authorised the resulting source calls (FR-048).
 *
 * The rejection is asserted by STATUS + published `code`, not by which `HttpException` subclass was constructed:
 * the status comes from the one `FOOD_ERROR_STATUS` table (`common/apiError.ts`), and this route used to emit the
 * legacy `{ error: 'Forbidden', message }` body that the 2026-08-12 convergence removed.
 */
import { HttpException, HttpStatus } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthenticatedRequest } from '../../../auth/authenticatedPrincipal.js';
import type { ApiErrorBody } from '../../../common/apiError.schema.js';
import { AdminMetricsService } from '../adminMetrics.service.js';
import { FoodRecoveryService } from '../foodRecovery.service.js';
import { FoodsAdminController } from '../foodsAdmin.controller.js';
import { PromotionsService } from '../../promotions/promotions.service.js';

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

/** A structurally valid food ULID — the requeue route rejects anything else with `400` before delegating. */
const FOOD_ID = '01J9ZK8N7QF3B2X4M6T0V5C1AB';

/** A pending promotion queue row, as the U12 routes serve it. */
const PROMOTION_ID = '00000000-0000-4000-8000-000000000001';
const PENDING_ROW = {
    id: PROMOTION_ID,
    normalizedName: 'quinoa blend',
    candidateFoodIds: [FOOD_ID],
    dataFingerprint: 'f'.repeat(64),
    status: 'pending',
    canonicalFoodId: null,
    createdAt: '2026-08-30T00:00:00.000Z',
    decidedAt: null,
};

function makeController(): {
    controller: FoodsAdminController;
    service: Record<string, ReturnType<typeof vi.fn>>;
    recovery: Record<string, ReturnType<typeof vi.fn>>;
    promotions: Record<string, ReturnType<typeof vi.fn>>;
} {
    const service = {
        collect: vi.fn().mockResolvedValue(METRICS),
        queueDepths: vi.fn().mockResolvedValue(METRICS.queue),
    };
    const recovery = { requeueFood: vi.fn().mockResolvedValue({ id: FOOD_ID, status: 'PENDING' }) };
    const promotions = {
        pending: vi.fn().mockResolvedValue([PENDING_ROW]),
        approve: vi.fn().mockResolvedValue({
            outcome: 'approved',
            canonicalFoodId: FOOD_ID,
            normalizedName: 'quinoa blend',
        }),
        reject: vi.fn().mockResolvedValue({ outcome: 'rejected' }),
    };

    return {
        controller: new FoodsAdminController(
            service as unknown as AdminMetricsService,
            recovery as unknown as FoodRecoveryService,
            promotions as unknown as PromotionsService,
        ),
        service,
        recovery,
        promotions,
    };
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

describe('FoodsAdminController.requeueFood (U9)', () => {
    let ctx: ReturnType<typeof makeController>;

    beforeEach(() => {
        ctx = makeController();
    });

    it('rejects the requeue without the food:admin scope → 403 FORBIDDEN, before any recovery work', async () => {
        let thrown: unknown;

        try {
            await ctx.controller.requeueFood(FOOD_ID, makeReq([]));
        } catch (error) {
            thrown = error;
        }

        expect((thrown as HttpException).getStatus()).toBe(HttpStatus.FORBIDDEN);
        expect(ctx.recovery['requeueFood']).not.toHaveBeenCalled();
    });

    // FR-051 orders the failures: the scope check precedes id validation, so an unscoped caller cannot use
    // the `400`/`403` difference to probe which ids are well-formed.
    it('checks the scope BEFORE the id, so a malformed id from an unscoped caller is still 403', async () => {
        let thrown: unknown;

        try {
            await ctx.controller.requeueFood('not-a-ulid', makeReq([]));
        } catch (error) {
            thrown = error;
        }

        expect((thrown as HttpException).getStatus()).toBe(HttpStatus.FORBIDDEN);
    });

    it('rejects a malformed id with 400 INVALID_ID and never reaches the recovery service', async () => {
        let thrown: unknown;

        try {
            await ctx.controller.requeueFood('not-a-ulid', makeReq(['food:admin']));
        } catch (error) {
            thrown = error;
        }

        expect((thrown as HttpException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
        expect(((thrown as HttpException).getResponse() as ApiErrorBody).code).toBe('INVALID_ID');
        expect(ctx.recovery['requeueFood']).not.toHaveBeenCalled();
    });

    // The re-home is only real if the controller stopped asking the metrics service to write. A mock that
    // still answered `requeueFood` on the metrics double would hide exactly that.
    //
    // ⚠️ REWRITTEN for the accountable-principal argument (U9 × FR-048). It previously asserted delegation
    // with the id ALONE, which is now an incomplete statement of the route's job: a requeue authorises
    // outbound source calls for a food that has no requester left to account for them (`tombstone` prunes
    // them, DSN-10), so WHO asked is what makes those calls attributable at all. Asserting only the id
    // would go green with the operator silently dropped.
    it('delegates to the RECOVERY service with the VERIFIED operator, leaving the metrics service untouched', async () => {
        const result = await ctx.controller.requeueFood(FOOD_ID, makeReq(['food:admin']));

        expect(result).toStrictEqual({ id: FOOD_ID, status: 'PENDING' });
        expect(ctx.recovery['requeueFood']).toHaveBeenCalledExactlyOnceWith(FOOD_ID, 'admin_1');
        expect(Object.keys(ctx.service)).not.toContain('requeueFood');
    });

    /**
     * The operator id comes from the VERIFIED token and nowhere else (FR-038) — the same rule that keeps a
     * client-suppliable header out of every other identity decision in this service. A body/header-sourced
     * operator would make the one audit record of who requeued a food forgeable by the person requeueing it.
     */
    it('takes the operator from the verified principal, never from anything the caller supplies', async () => {
        const req = makeReq(['food:admin']);
        (req as unknown as { body: unknown }).body = { operator: 'someone_else' };
        (req as unknown as { headers: Record<string, string> }).headers = { 'x-operator': 'someone_else' };

        await ctx.controller.requeueFood(FOOD_ID, req);

        expect(ctx.recovery['requeueFood']).toHaveBeenCalledExactlyOnceWith(FOOD_ID, 'admin_1');
    });
});

describe('U12 — the promotion moderation routes', () => {
    let ctx: ReturnType<typeof makeController>;

    beforeEach(() => {
        ctx = makeController();
    });

    it.each([
        ['pending list', (c: FoodsAdminController) => c.getPendingPromotions(makeReq([]))],
        ['approve', (c: FoodsAdminController) => c.approvePromotion(PROMOTION_ID, makeReq([]))],
        ['reject', (c: FoodsAdminController) => c.rejectPromotion(PROMOTION_ID, makeReq([]))],
    ])('%s refuses a caller without the food:admin scope → 403 FORBIDDEN', async (_label, call) => {
        let thrown: unknown;

        try {
            await call(ctx.controller);
        } catch (error) {
            thrown = error;
        }

        expect(thrown).toBeInstanceOf(HttpException);
        expect((thrown as HttpException).getStatus()).toBe(HttpStatus.FORBIDDEN);
        expect(ctx.promotions['pending']).not.toHaveBeenCalled();
        expect(ctx.promotions['approve']).not.toHaveBeenCalled();
        expect(ctx.promotions['reject']).not.toHaveBeenCalled();
    });

    it('lists the pending queue for a scoped operator', async () => {
        const result = await ctx.controller.getPendingPromotions(makeReq(['food:admin']));

        expect(result).toEqual({ pending: [PENDING_ROW] });
    });

    it('approves and reports the published canonical', async () => {
        const result = await ctx.controller.approvePromotion(PROMOTION_ID, makeReq(['food:admin']));

        expect(result).toEqual({ id: PROMOTION_ID, canonicalFoodId: FOOD_ID, normalizedName: 'quinoa blend' });
        expect(ctx.promotions['approve']).toHaveBeenCalledWith(PROMOTION_ID);
    });

    it('maps not_found → 404 PROMOTION_NOT_FOUND', async () => {
        ctx.promotions['approve']!.mockResolvedValue({ outcome: 'not_found' });

        let thrown: unknown;

        try {
            await ctx.controller.approvePromotion(PROMOTION_ID, makeReq(['food:admin']));
        } catch (error) {
            thrown = error;
        }

        expect((thrown as HttpException).getStatus()).toBe(HttpStatus.NOT_FOUND);
        expect(((thrown as HttpException).getResponse() as ApiErrorBody).code).toBe('PROMOTION_NOT_FOUND');
    });

    it.each(['not_pending', 'not_promotable'])(
        'maps %s → 409 PROMOTION_NOT_ACTIONABLE with the reason',
        async (reason) => {
            ctx.promotions['approve']!.mockResolvedValue({ outcome: reason });

            let thrown: unknown;

            try {
                await ctx.controller.approvePromotion(PROMOTION_ID, makeReq(['food:admin']));
            } catch (error) {
                thrown = error;
            }

            expect((thrown as HttpException).getStatus()).toBe(HttpStatus.CONFLICT);

            const body = (thrown as HttpException).getResponse() as ApiErrorBody;

            expect(body.code).toBe('PROMOTION_NOT_ACTIONABLE');
            expect(body.details?.['reason']).toBe(reason);
        },
    );

    it('rejects a candidacy and answers the typed outcome', async () => {
        const result = await ctx.controller.rejectPromotion(PROMOTION_ID, makeReq(['food:admin']));

        expect(result).toEqual({ id: PROMOTION_ID, status: 'rejected' });
        expect(ctx.promotions['reject']).toHaveBeenCalledWith(PROMOTION_ID);
    });

    it('refuses a malformed promotion id with 400 AFTER the scope check', async () => {
        let thrown: unknown;

        try {
            await ctx.controller.approvePromotion('not-a-uuid', makeReq(['food:admin']));
        } catch (error) {
            thrown = error;
        }

        expect((thrown as HttpException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
        expect(ctx.promotions['approve']).not.toHaveBeenCalled();
    });
});
