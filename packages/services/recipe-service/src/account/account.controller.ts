/**
 * T135 — the `/v1/account` REST surface (GDPR account erasure).
 *
 * Thin controller: the `@OwnerId()` decorator reads the authenticated owner key from `req.principal`
 * (set by the fail-closed `AuthMiddleware`) and every decision is delegated to {@link ErasureService}.
 * The service's `GoneException`/`BadRequestException`/`ServiceUnavailableException` are translated to
 * HTTP by the global `ApiExceptionFilter`, which passes framework exceptions through untouched — so the
 * `410` body is exactly the contract's `{ code: 'ALREADY_ERASED', message: … }`. A controller-scoped
 * `ValidationPipe` enforces the DTO.
 */
import { Body, Controller, HttpCode, HttpStatus, Post, UsePipes, ValidationPipe } from '@nestjs/common';

import { OwnerId } from '../auth/current-principal.decorator.js';
import { ErasureService } from './erasure.service.js';
import { ErasureRequestDto, type ErasureRequestAcceptedResponse } from './dto/erasure.dto.js';
import { WriteRateLimit } from '../common/throttle/throttle.decorators.js';

@Controller('v1/account')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: false }))
export class AccountController {
    public constructor(private readonly erasure: ErasureService) {}

    /**
     * `POST /v1/account/erasure` — request GDPR erasure of the CALLER'S OWN account data.
     *
     * Returns `202` (not the POST default `201`) per the contract: the work is asynchronous and no
     * resource is created at this URL. The owner is taken from the verified token and never from the
     * body — an `ownerId` a client tried to smuggle in is stripped by the `whitelist` pipe and would be
     * ignored regardless, because it is simply not read.
     *
     * The body is optional; Express yields `{}` when none is sent, which the DTO accepts.
     *
     * Rate-limited as a write (not a bespoke tighter limit): erasure is an authenticated, self-only,
     * idempotent async-enqueue (repeat calls return `410 ALREADY_ERASED` or re-accept the same job), so
     * the generous write cap is sufficient and a dedicated group would be unjustified indirection.
     */
    @Post('erasure')
    @HttpCode(HttpStatus.ACCEPTED)
    @WriteRateLimit()
    public async requestErasure(
        @OwnerId() ownerId: string,
        @Body() body?: ErasureRequestDto,
    ): Promise<ErasureRequestAcceptedResponse> {
        return this.erasure.requestErasure(ownerId, body);
    }
}
