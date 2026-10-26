/**
 * The `/api/v1/recipe-parse-jobs` REST surface (plan U9, origin D9/R13).
 *
 * Thin controller over {@link ParseJobsService}, the `RecipesController` shape: `@CurrentPrincipal()` reads the
 * verified principal from `req.principal` (fail-closed `AuthMiddleware`): its app-user ULID owns the job, and its
 * acting slice tells the match projection whether the caller is a contained test principal. The controller-scoped
 * `ZodValidationPipe` enforces the AUTHORED wire DTOs (⚠️ load-bearing — the DTOs carry no
 * `class-validator` metadata, so Nest's own `ValidationPipe` would validate NOTHING), and every domain
 * failure is thrown as a `RecipeDomainError` for the global `ApiExceptionFilter`.
 *
 * ## The shape of the resource (D9's ruling)
 *
 * Parsing is an ASYNC JOB, never a polymorphic body on recipe create: `POST` answers `202 Accepted` with
 * the job view, the client POLLS `GET /:id`, and the finished proposals are REVIEWED by the cook — the
 * reviewed draft goes through ordinary `POST /recipes`, which re-validates every food id through
 * `by-food` admission (R19: a parse binds nothing).
 *
 * ADR-0071: every view a route answers with carries each proposed food's `match`, added by the one
 * {@link ParseJobMatchView} Content Enricher, so every route takes the caller's credential (food names the foods).
 *
 * Owner scoping is a `404`, never a `403`: a stranger polling another user's job must not learn the id
 * exists. Retry (`POST /:id/retry`) and line edit (`PATCH /:id/lines/:lineIndex`) answer `202` as well —
 * both re-open asynchronous work — and refuse an expired job with `409 PARSE_JOB_EXPIRED`.
 */
import {
    Body,
    Controller,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    ParseIntPipe,
    ParseUUIDPipe,
    Patch,
    Post,
    UsePipes,
} from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';

import { ParseJobsService } from './parseJobs.service.js';
import { MatchProposalService } from './matchProposal.service.js';
import { ParseJobMatchView } from './parseJobMatchView.js';
import { CreateParseJobDto } from './dto/createParseJob.dto.js';
import { EditParseJobLineDto } from './dto/editParseJobLine.dto.js';
import { WithdrawParseJobLinesDto } from './dto/withdrawParseJobLines.dto.js';
import type { ParseJobResponse } from './parseJobs.schema.js';
import { CurrentPrincipal } from '../auth/currentPrincipal.decorator.js';
import { actingPrincipalOf, type Principal } from '../auth/principal.js';
import { CallerBearerToken } from '../auth/CallerToken.decorator.js';
import type { CallerToken } from '../auth/CallerToken.js';
import { WriteRateLimit } from '../common/throttle/throttle.decorators.js';

// New surface: canonical `/api/v1/` prefix only — the bare `v1/...` alias exists for consumers that
// predate ADR-0011's prefix and is deliberately NOT extended to new resources.
@Controller('api/v1/recipe-parse-jobs')
@UsePipes(ZodValidationPipe)
export class ParseJobsController {
    public constructor(
        private readonly parseJobsService: ParseJobsService,
        private readonly matchProposals: MatchProposalService,
        // ADR-0071 — every route answering with a job view goes through the ONE match projection (a Content Enricher).
        private readonly matchView: ParseJobMatchView,
    ) {}

    /** `POST /api/v1/recipe-parse-jobs` — accept a pasted block; parsing continues asynchronously. */
    @Post()
    @HttpCode(HttpStatus.ACCEPTED)
    @WriteRateLimit()
    public async create(
        @CurrentPrincipal() principal: Principal,
        @CallerBearerToken() caller: CallerToken | undefined,
        @Body() body: CreateParseJobDto,
    ): Promise<ParseJobResponse> {
        return this.matchView.decorate(
            actingPrincipalOf(principal),
            caller,
            await this.parseJobsService.create(principal.userId, body.text),
        );
    }

    /** `GET /api/v1/recipe-parse-jobs/:id` — poll the owner's job. A stranger gets `404`. */
    @Get(':id')
    public async getById(
        @CurrentPrincipal() principal: Principal,
        @CallerBearerToken() caller: CallerToken | undefined,
        @Param('id', ParseUUIDPipe) id: string,
    ): Promise<ParseJobResponse> {
        return this.matchView.decorate(
            actingPrincipalOf(principal),
            caller,
            await this.parseJobsService.get(principal.userId, id),
        );
    }

    /** `POST /api/v1/recipe-parse-jobs/:id/retry` — re-drive exactly the `failed_retryable` lines. */
    @Post(':id/retry')
    @HttpCode(HttpStatus.ACCEPTED)
    @WriteRateLimit()
    public async retry(
        @CurrentPrincipal() principal: Principal,
        @CallerBearerToken() caller: CallerToken | undefined,
        @Param('id', ParseUUIDPipe) id: string,
    ): Promise<ParseJobResponse> {
        return this.matchView.decorate(
            actingPrincipalOf(principal),
            caller,
            await this.parseJobsService.retry(principal.userId, id),
        );
    }

    /**
     * `PATCH /api/v1/recipe-parse-jobs/:id/lines/:lineIndex` — replace one line's text; the stored digest
     * moves with it atomically (R17), the old landing is discarded by the worker's digest guard, and the
     * new phrase re-drives its own parse.
     */
    @Patch(':id/lines/:lineIndex')
    @HttpCode(HttpStatus.ACCEPTED)
    @WriteRateLimit()
    public async editLine(
        @CurrentPrincipal() principal: Principal,
        @CallerBearerToken() caller: CallerToken | undefined,
        @Param('id', ParseUUIDPipe) id: string,
        @Param('lineIndex', ParseIntPipe) lineIndex: number,
        @Body() body: EditParseJobLineDto,
    ): Promise<ParseJobResponse> {
        return this.matchView.decorate(
            actingPrincipalOf(principal),
            caller,
            await this.parseJobsService.editLine(principal.userId, id, lineIndex, body.sourceLine),
        );
    }

    /**
     * `POST /api/v1/recipe-parse-jobs/:id/withdraw-lines` — keep these lines as written: no engine will be asked for
     * them. Answers `200` (nothing asynchronous starts), idempotent, owner-only (a stranger gets `404`).
     */
    @Post(':id/withdraw-lines')
    @HttpCode(HttpStatus.OK)
    @WriteRateLimit()
    public async withdrawLines(
        @CurrentPrincipal() principal: Principal,
        @CallerBearerToken() caller: CallerToken | undefined,
        @Param('id', ParseUUIDPipe) id: string,
        @Body() body: WithdrawParseJobLinesDto,
    ): Promise<ParseJobResponse> {
        return this.matchView.decorate(
            actingPrincipalOf(principal),
            caller,
            await this.parseJobsService.withdrawLines(principal.userId, id, body.lineIndexes),
        );
    }

    /**
     * `POST /api/v1/recipe-parse-jobs/:id/matches` — match the parsed lines' foods to catalog foods, as PROPOSALS
     * (ADR-0071). The client calls it from its poll loop when newly parsed lines appear.
     *
     * Answers `202` with the job view: the gate's review of each proposal continues asynchronously. Idempotent (a
     * matched line is not matched or paid for again), owner-only (a stranger gets `404`), and refused past the TTL with
     * `409 PARSE_JOB_EXPIRED`. The food searches it makes are made AS the caller (#120).
     */
    @Post(':id/matches')
    @HttpCode(HttpStatus.ACCEPTED)
    @WriteRateLimit()
    public async proposeMatches(
        @CurrentPrincipal() principal: Principal,
        @CallerBearerToken() caller: CallerToken | undefined,
        @Param('id', ParseUUIDPipe) id: string,
    ): Promise<ParseJobResponse> {
        const acting = actingPrincipalOf(principal);

        await this.matchProposals.propose(acting, caller, id);

        return this.matchView.decorate(acting, caller, await this.parseJobsService.get(principal.userId, id));
    }
}
