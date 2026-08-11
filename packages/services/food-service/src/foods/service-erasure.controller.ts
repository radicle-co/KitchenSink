/**
 * The `/api/v1/internal/account` REST surface for the food service — the service-principal erasure route
 * (CR-002 / U4b / R11), the food mirror of recipe-service's U4a `ServiceErasureController`.
 *
 * A STRUCTURALLY-DISTINCT controller from {@link import('./foods.controller.js').FoodsController}, on its
 * own `internal` path prefix, so the machine-auth path never shares a handler, a body shape, or a guard
 * chain with the user-facing food API:
 *
 *  - It is NOT covered by the Clerk {@link import('../auth/food-auth.guard.js').FoodAuthGuard} middleware
 *    (mounted only on the foods controllers), which would 401 a machine token. Instead
 *    {@link FoodServiceErasureGuard} verifies the signed, single-target service token (food audience) and
 *    yields the bound {@link ServicePrincipal}.
 *  - The target owner comes ONLY from `@ServiceErasurePrincipal()` (the token's bound claim). There is NO
 *    request body: no `ownerId` to smuggle. The signed token IS the authorization.
 *
 * The response is `200` (the erase is a synchronous, idempotent DELETE-by-owner — food's only per-user
 * data is `fetch_requesters`, so there is no async job to hand off). An owner with no footprint erases 0
 * rows (idempotent no-op success).
 */
import { Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';

import { FoodServiceErasureGuard } from '../auth/food-service-erasure.guard.js';
import { ServiceErasurePrincipal } from '../auth/service-principal.decorator.js';
import type { ServicePrincipal } from '../auth/service-principal.js';
import { UserErasureService } from './user-erasure.service.js';
import type { FoodServiceErasureAcceptedResponse } from './dto/service-erasure.schema.js';

// Canonically served under the `/api/{version}/` prefix. The bare `v1/...` entry is a DEPRECATED ALIAS:
// `/v1/*` is live in production and held by consumers configured OUTSIDE this repo (the Clerk dashboard
// webhook URL) as well as already-shipped mobile builds and cached web bundles, whose endpoints were
// inlined at build time. Removing it REQUIRES updating the Clerk dashboard first — see ADR-0011.
@Controller(['api/v1/internal/account', 'v1/internal/account'])
@UseGuards(FoodServiceErasureGuard)
export class ServiceErasureController {
    public constructor(private readonly erasure: UserErasureService) {}

    /**
     * `POST /api/v1/internal/account/erasure` — erase the token-bound owner's food footprint (R11) on behalf of
     * a verified service principal (the identity deletion-worker / erasure-reconciliation, on a
     * `user.deleted`/close event).
     *
     * The owner is the verified token's bound claim (`@ServiceErasurePrincipal().ownerId`) — never a body
     * or query value.
     *
     * @param principal - The verified service principal (bound target owner, event id, actor).
     * @returns `200` with the erased requester id + the number of `fetch_requesters` rows removed.
     * @sideEffect Deletes the owner's `fetch_requesters` rows.
     */
    @Post('erasure')
    @HttpCode(HttpStatus.OK)
    public async eraseAccount(
        @ServiceErasurePrincipal() principal: ServicePrincipal,
    ): Promise<FoodServiceErasureAcceptedResponse> {
        const result = await this.erasure.eraseUser(principal.ownerId);

        return { requesterId: result.requesterId, deletedRequesterRows: result.deletedRequesterRows };
    }
}
