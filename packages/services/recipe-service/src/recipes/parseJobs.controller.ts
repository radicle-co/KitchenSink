/**
 * The `/api/v1/recipe-parse-jobs` REST surface (plan U9, origin D9/R13).
 *
 * Thin controller over {@link ParseJobsService}, the `RecipesController` shape: `@OwnerId()` reads the
 * authenticated app-user ULID from `req.principal` (fail-closed `AuthMiddleware`), the controller-scoped
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
import { CreateParseJobDto, EditParseJobLineDto } from './dto/parseJob.dto.js';
import type { ParseJobResponse } from './parseJobs.schema.js';
import { OwnerId } from '../auth/currentPrincipal.decorator.js';
import { WriteRateLimit } from '../common/throttle/throttle.decorators.js';

// New surface: canonical `/api/v1/` prefix only — the bare `v1/...` alias exists for consumers that
// predate ADR-0011's prefix and is deliberately NOT extended to new resources.
@Controller('api/v1/recipe-parse-jobs')
@UsePipes(ZodValidationPipe)
export class ParseJobsController {
    public constructor(private readonly parseJobsService: ParseJobsService) {}

    /** `POST /api/v1/recipe-parse-jobs` — accept a pasted block; parsing continues asynchronously. */
    @Post()
    @HttpCode(HttpStatus.ACCEPTED)
    @WriteRateLimit()
    public async create(@OwnerId() ownerId: string, @Body() body: CreateParseJobDto): Promise<ParseJobResponse> {
        return this.parseJobsService.create(ownerId, body.text);
    }

    /** `GET /api/v1/recipe-parse-jobs/:id` — poll the owner's job. A stranger gets `404`. */
    @Get(':id')
    public async getById(
        @OwnerId() ownerId: string,
        @Param('id', ParseUUIDPipe) id: string,
    ): Promise<ParseJobResponse> {
        return this.parseJobsService.get(ownerId, id);
    }

    /** `POST /api/v1/recipe-parse-jobs/:id/retry` — re-drive exactly the `failed_retryable` lines. */
    @Post(':id/retry')
    @HttpCode(HttpStatus.ACCEPTED)
    @WriteRateLimit()
    public async retry(@OwnerId() ownerId: string, @Param('id', ParseUUIDPipe) id: string): Promise<ParseJobResponse> {
        return this.parseJobsService.retry(ownerId, id);
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
        @OwnerId() ownerId: string,
        @Param('id', ParseUUIDPipe) id: string,
        @Param('lineIndex', ParseIntPipe) lineIndex: number,
        @Body() body: EditParseJobLineDto,
    ): Promise<ParseJobResponse> {
        return this.parseJobsService.editLine(ownerId, id, lineIndex, body.sourceLine);
    }
}
