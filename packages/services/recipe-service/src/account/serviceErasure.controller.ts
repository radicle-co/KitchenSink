/**
 * The `/api/v1/internal/account` REST surface — the GREENFIELD service-principal erasure route (CR-002 / U4a).
 *
 * A STRUCTURALLY-DISTINCT controller from `AccountController`, on its own `internal` path prefix, so
 * the machine-auth path never shares a handler, a body shape, or a guard chain with the user path:
 *
 *  - It is EXCLUDED from the global Clerk `AuthMiddleware` (see
 *    `AppModule.configure`) — that middleware only admits user session tokens with an `external_id`, and
 *    would 401 a machine token before any guard ran. Instead {@link ServiceErasureGuard} verifies the
 *    signed, single-target service token and yields the bound {@link ServicePrincipal}.
 *  - The target owner comes ONLY from `@ServiceErasurePrincipal()` (the token's bound claim). There is NO
 *    request body: no `ownerId` to smuggle, and no confirmation phrase — the token IS the authorization,
 *    which is why {@link ErasureService.requestServiceErasure} skips the phrase the user path requires.
 *  - `@SkipErasureLock()`: like the user erasure route, this route CREATES the erasure job, so the HAZ-052
 *    write-lock (which would otherwise 423 a mutating request once a job exists) must not shadow it.
 *
 * The response is `202` (async hand-off, no resource created at this URL). An already-erased account is an
 * idempotent no-op success (`status: 'completed'`), not a `410` — the deletion-worker caller only needs
 * "the erasure is handled".
 */
import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards, UsePipes } from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';

import { ErasureService } from './erasure.service.js';
import { SkipErasureLock } from './skipErasureLock.decorator.js';
import { ServiceErasureGuard } from '../auth/serviceErasure.guard.js';
import { ServiceErasurePrincipal } from '../auth/servicePrincipal.decorator.js';
import type { ServicePrincipal } from '../auth/servicePrincipal.js';
import type { ServiceErasureAcceptedResponse } from './dto/serviceErasure.dto.js';
import { IngredientsDal } from '../ingredients/dal/ingredients.dal.js';
import { ServiceFoodReferencesDto } from './dto/serviceFoodReferences.dto.js';
import type { ServiceFoodReferencesResponse } from './account.schema.js';

// Canonically served under the `/api/{version}/` prefix. The bare `v1/...` entry is a DEPRECATED ALIAS:
// `/v1/*` is live in production and held by consumers configured OUTSIDE this repo (the Clerk dashboard
// webhook URL) as well as already-shipped mobile builds and cached web bundles, whose endpoints were
// inlined at build time. Removing it REQUIRES updating the Clerk dashboard first — see ADR-0011.
@Controller(['api/v1/internal/account', 'v1/internal/account'])
@UseGuards(ServiceErasureGuard)
// ⚠️ Required since U18 gave this controller its first @Body() (the food-references query): the DTO is a
// `createZodDto` class, which validates ONLY under nestjs-zod's pipe — Nest's own ValidationPipe would
// validate NOTHING while looking wired. The erasure route itself still takes no body.
@UsePipes(ZodValidationPipe)
export class ServiceErasureController {
    public constructor(
        private readonly erasure: ErasureService,
        // U18 — its OWN IngredientsDal instance (the embedded-DAL pattern) for the reference query.
        private readonly ingredientsDal: IngredientsDal,
    ) {}

    /**
     * `POST /api/v1/internal/account/erasure` — trigger erasure of the token-bound target account on behalf of
     * a verified service principal (the identity deletion-worker, on a `user.deleted`/close event).
     *
     * The owner is the verified token's bound claim (`@ServiceErasurePrincipal().ownerId`) — never a body
     * or query value. No confirmation phrase (the signed single-target token is the authorization).
     *
     * @param principal - The verified service principal (bound target owner, event id, actor).
     * @returns `202` with the job id + status, or an already-erased no-op (`status: 'completed'`).
     */
    @Post('erasure')
    @HttpCode(HttpStatus.ACCEPTED)
    @SkipErasureLock()
    public async eraseAccount(
        @ServiceErasurePrincipal() principal: ServicePrincipal,
    ): Promise<ServiceErasureAcceptedResponse> {
        return this.erasure.requestServiceErasure(principal);
    }
    /**
     * `POST /api/v1/internal/account/food-references` (plan U18) — which of the token-bound owner's
     * authored food ids live recipes still reference (Q3b's orphan arm). The worker calls this BETWEEN
     * food's erasure `begin` (tombstone) and its completing erasure; the recipe leg has already run, so
     * the survivors counted here are other users' recipes and the owner's kept pseudonymized ones.
     *
     * The body carries the query's SUBJECT only — the authorization is the verified single-target token,
     * exactly as on the erasure route above.
     */
    @Post('food-references')
    @HttpCode(HttpStatus.OK)
    public async foodReferences(
        @ServiceErasurePrincipal() _principal: ServicePrincipal,
        @Body() body: ServiceFoodReferencesDto,
    ): Promise<ServiceFoodReferencesResponse> {
        return { referencedFoodIds: await this.ingredientsDal.referencedFoodIdsAmong(body.foodIds) };
    }
}
