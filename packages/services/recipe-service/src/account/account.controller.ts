/**
 * T135 — the `/api/v1/account` REST surface (GDPR account erasure).
 *
 * Thin controller: the `@OwnerId()` decorator reads the authenticated owner key from `req.principal`
 * (set by the fail-closed `AuthMiddleware`) and every decision is delegated to {@link ErasureService}.
 * The service's `GoneException`/`BadRequestException`/`ServiceUnavailableException` are translated to
 * HTTP by the global `ApiExceptionFilter`, which passes framework exceptions through untouched — so the
 * `410` body is exactly the contract's `{ code: 'ALREADY_ERASED', message: … }`. A controller-scoped
 * `ValidationPipe` enforces the DTO.
 */
import { Body, Controller, Get, HttpCode, HttpStatus, Post, UsePipes, ValidationPipe } from '@nestjs/common';

import { OwnerId } from '../auth/current-principal.decorator.js';
import { ErasureService } from './erasure.service.js';
import { AccountExportService } from './export.service.js';
import { ErasureRequestDto, type ErasureRequestAcceptedResponse } from './dto/erasure.dto.js';
import type { AccountExport } from './dto/export.dto.js';
import { ExportRateLimit, WriteRateLimit } from '../common/throttle/throttle.decorators.js';
import { SkipErasureLock } from './skip-erasure-lock.decorator.js';

// Canonically served under the `/api/{version}/` prefix. The bare `v1/...` entry is a DEPRECATED ALIAS:
// `/v1/*` is live in production and held by consumers configured OUTSIDE this repo (the Clerk dashboard
// webhook URL) as well as already-shipped mobile builds and cached web bundles, whose endpoints were
// inlined at build time. Removing it REQUIRES updating the Clerk dashboard first — see ADR-0011.
@Controller(['api/v1/account', 'v1/account'])
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: false }))
export class AccountController {
    public constructor(
        private readonly erasure: ErasureService,
        private readonly exporter: AccountExportService,
    ) {}

    /**
     * `GET /api/v1/account/export` — the CALLER'S OWN recipe-domain personal data as one structured,
     * machine-readable JSON document (GDPR Art. 15 access + Art. 20 portability). The read-only mirror of
     * the erasure endpoint: it returns the same owner-scoped roots erasure removes/keeps.
     *
     * The owner is taken from the VERIFIED token (`@OwnerId()`) and never from the request — there is no
     * body or query parameter that can redirect the export at another account, exactly as with erasure.
     *
     * Rate-limited with the dedicated (tightest) export cap rather than the generous read default: the
     * export assembles six owner-scoped tables into one payload, so it is the heaviest single read and a
     * data-egress surface, while a genuine "download my data" request is infrequent.
     *
     * NOT `@SkipErasureLock()`-relevant: `ErasureLockGuard` only locks MUTATING requests, and this is a
     * read — an in-flight erasure does not block the caller from exporting what is still held.
     */
    @Get('export')
    @ExportRateLimit()
    public async exportAccount(@OwnerId() ownerId: string): Promise<AccountExport> {
        return this.exporter.exportForOwner(ownerId);
    }

    /**
     * `POST /api/v1/account/erasure` — request GDPR erasure of the CALLER'S OWN account data.
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
     *
     * `@SkipErasureLock()` (HAZ-052): this route is a POST — normally exactly what `ErasureLockGuard`
     * locks — but it is the route that REPORTS "erasure already in flight" via its own idempotent C-007
     * outcome map (202 with the existing job, never a second enqueue). Locking it would shadow that
     * behaviour with a 423 the moment the job it is meant to report on exists.
     */
    @Post('erasure')
    @HttpCode(HttpStatus.ACCEPTED)
    @WriteRateLimit()
    @SkipErasureLock()
    public async requestErasure(
        @OwnerId() ownerId: string,
        @Body() body?: ErasureRequestDto,
    ): Promise<ErasureRequestAcceptedResponse> {
        return this.erasure.requestErasure(ownerId, body);
    }
}
