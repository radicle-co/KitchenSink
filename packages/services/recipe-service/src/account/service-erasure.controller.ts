/**
 * The `/v1/internal/account` REST surface — the GREENFIELD service-principal erasure route (CR-002 / U4a).
 *
 * A STRUCTURALLY-DISTINCT controller from {@link AccountController}, on its own `internal` path prefix, so
 * the machine-auth path never shares a handler, a body shape, or a guard chain with the user path:
 *
 *  - It is EXCLUDED from the global Clerk {@link import('../auth/auth.middleware.js').AuthMiddleware} (see
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
import { Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';

import { ErasureService } from './erasure.service.js';
import { SkipErasureLock } from './skip-erasure-lock.decorator.js';
import { ServiceErasureGuard } from '../auth/service-erasure.guard.js';
import { ServiceErasurePrincipal } from '../auth/service-principal.decorator.js';
import type { ServicePrincipal } from '../auth/service-principal.js';
import type { ServiceErasureAcceptedResponse } from './dto/service-erasure.dto.js';

@Controller('v1/internal/account')
@UseGuards(ServiceErasureGuard)
export class ServiceErasureController {
    public constructor(private readonly erasure: ErasureService) {}

    /**
     * `POST /v1/internal/account/erasure` — trigger erasure of the token-bound target account on behalf of
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
}
