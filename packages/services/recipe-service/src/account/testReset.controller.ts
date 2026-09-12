/**
 * ADR-0040 — `POST /api/v1/account/test-reset` and `GET /api/v1/account/test-reset/{jobId}`: a test principal's
 * self-purge and its status query.
 *
 * @pattern Command — the thin HTTP adapter over {@link TestResetService}; every rule (claim AND registry, the `404`,
 *   self-only, repeatability) lives there.
 *
 * Served ONLY under the canonical `/api/{version}/` prefix: the deprecated bare `v1/…` alias ADR-0011 keeps exists for
 * clients that shipped against it, and nothing ever shipped against this route.
 *
 * ⛔ The job id is deliberately NOT a `ParseUUIDPipe`: a pipe runs before the handler, so a malformed id would answer a
 * `400` to a real user and reveal that the route exists. The service parses it AFTER its authorization gate.
 */
import { Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';

import { CurrentPrincipal } from '../auth/currentPrincipal.decorator.js';
import { actingPrincipalOf, type Principal } from '../auth/principal.js';
import { WriteRateLimit } from '../common/throttle/throttle.decorators.js';
import { SkipErasureLock } from './skipErasureLock.decorator.js';
import { TestResetService } from './testReset.service.js';
import type { TestResetAcceptedResponse, TestResetJobResponse } from './testReset.schema.js';

@Controller('api/v1/account/test-reset')
export class TestResetController {
    public constructor(private readonly resets: TestResetService) {}

    /**
     * Request a purge of everything the calling test principal owns. No body: the principal is the token.
     *
     * `@SkipErasureLock()` for the reason `AccountController.requestErasure` carries it — the write-lock engages
     * WHILE a reset is active, and a second request must receive the running job rather than a `423`.
     *
     * @param principal - The verified principal.
     * @returns `202` with the queued or already-running job.
     */
    @Post()
    @HttpCode(HttpStatus.ACCEPTED)
    @WriteRateLimit()
    @SkipErasureLock()
    public async requestReset(@CurrentPrincipal() principal: Principal): Promise<TestResetAcceptedResponse> {
        return this.resets.requestReset(actingPrincipalOf(principal));
    }

    /**
     * Read where one of the caller's own reset jobs stands — what CI polls until `completed`.
     *
     * @param principal - The verified principal.
     * @param jobId - The job id from `POST`'s response.
     * @returns The job's status body.
     */
    @Get(':jobId')
    public async getReset(
        @CurrentPrincipal() principal: Principal,
        @Param('jobId') jobId: string,
    ): Promise<TestResetJobResponse> {
        return this.resets.getReset(actingPrincipalOf(principal), jobId);
    }
}
