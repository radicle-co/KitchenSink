/**
 * The `/api/v1/import` REST surface (ADR-0072 §1): each route is mapped to ONE service method.
 *
 * DESIGN PATTERN: **Facade over three services** (`ImportService` for the header and items, `ImportStepService` for the
 * wizard's reads and decisions, `ImportAdvanceService` for the bounded step that pays, matches and saves). The controller is
 * thin, the `ParseJobsController` shape: `@CurrentPrincipal()` is the verified caller (the owner of every import it names),
 * the controller-scoped `ZodValidationPipe` enforces the AUTHORED wire DTOs (⚠️ load-bearing: the DTOs carry no
 * `class-validator` metadata, so Nest's own `ValidationPipe` would validate NOTHING), and every domain failure is a
 * `RecipeDomainError` for the global `ApiExceptionFilter`.
 *
 * ⛔ Three rules a reader would otherwise "fix":
 *
 *  - **Literal routes come BEFORE `:importId`.** `to-check-count` is a word, and `:importId` is parsed as a UUID, so a
 *    route declared after it is unreachable (`400`, not the count).
 *  - **A stranger gets `404`**, never `403`: the services answer it, and this controller adds nothing to it.
 *  - **`advance` answers `200`**, not the `POST` default `201`: it creates nothing, and the allowance state is in the body.
 *
 * Every read that names foods takes the caller's credential (food names the foods as the caller) and a deadline inside the
 * client's timeout, the budget `ParseJobsController` holds for its match route.
 */
import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    Inject,
    Param,
    ParseUUIDPipe,
    Post,
    Put,
    Query,
    UsePipes,
} from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';

import { CallerBearerToken } from '../auth/CallerToken.decorator.js';
import type { CallerToken } from '../auth/CallerToken.js';
import { CurrentPrincipal } from '../auth/currentPrincipal.decorator.js';
import type { Principal } from '../auth/principal.js';
import { WriteRateLimit } from '../common/throttle/throttle.decorators.js';
import { MATCH_REQUEST_DEADLINE_MS } from '../config/matchBudget.js';
import type {
    ImportFlaggedResponse,
    ImportListResponse,
    ImportPickResponse,
    ImportStepResponse,
    ImportToCheckCountResponse,
    ImportToCheckResponse,
    ImportView,
} from '../recipes/import.schema.js';
import { AdvanceImportDto } from './dto/advanceImport.dto.js';
import { CreateImportDto } from './dto/createImport.dto.js';
import { GetImportQueryDto } from './dto/getImportQuery.dto.js';
import { ImportCursorDto } from './dto/importCursor.dto.js';
import { ImportListQueryDto } from './dto/importListQuery.dto.js';
import { ImportOrdinalParamDto } from './dto/importOrdinalParam.dto.js';
import { ImportPickDto } from './dto/importPick.dto.js';
import { LeaveImportDto } from './dto/leaveImport.dto.js';
import { PutImportItemsDto } from './dto/putImportItems.dto.js';
import { RecordImportChoicesBatchDto } from './dto/recordImportChoicesBatch.dto.js';
import { RecordImportChoicesDto } from './dto/recordImportChoices.dto.js';
import { ImportService } from './import.service.js';
import { ImportAdvanceService } from './importAdvance.service.js';
import { ImportStepService } from './importStep.service.js';

// New surface: canonical `/api/v1/` prefix only, as `ParseJobsController` (the bare `v1/` alias is for pre-ADR-0011 consumers).
@Controller('api/v1/import')
@UsePipes(ZodValidationPipe)
export class ImportController {
    public constructor(
        @Inject(ImportService)
        private readonly imports: Pick<
            ImportService,
            'create' | 'list' | 'putItems' | 'getView' | 'delete' | 'moveCursor' | 'recordChoicesBatch' | 'leave'
        >,
        @Inject(ImportStepService)
        private readonly steps: Pick<
            ImportStepService,
            'toCheckCount' | 'step' | 'pick' | 'recordChoices' | 'flagged' | 'toCheck'
        >,
        @Inject(ImportAdvanceService) private readonly advancer: Pick<ImportAdvanceService, 'advance'>,
    ) {}

    /** `POST /api/v1/import` — create an import with its first chunk, or answer the one this id already is. `201`. */
    @Post()
    @HttpCode(HttpStatus.CREATED)
    @WriteRateLimit()
    public create(@CurrentPrincipal() principal: Principal, @Body() body: CreateImportDto): Promise<ImportView> {
        return this.imports.create(principal, body);
    }

    /** `GET /api/v1/import` — the caller's imports, newest first. */
    @Get()
    public list(
        @CurrentPrincipal() principal: Principal,
        @Query() query: ImportListQueryDto,
    ): Promise<ImportListResponse> {
        return this.imports.list(principal, query);
    }

    /** `GET /api/v1/import/to-check-count` — the library-wide count of lines to check. ⛔ Declared before `:importId`. */
    @Get('to-check-count')
    public toCheckCount(@CurrentPrincipal() principal: Principal): Promise<ImportToCheckCountResponse> {
        return this.steps.toCheckCount(principal);
    }

    /** `PUT /api/v1/import/:importId/items` — more of the file, or a corrected recipe. */
    @Put(':importId/items')
    @WriteRateLimit()
    public putItems(
        @CurrentPrincipal() principal: Principal,
        @Param('importId', ParseUUIDPipe) importId: string,
        @Body() body: PutImportItemsDto,
    ): Promise<ImportView> {
        return this.imports.putItems(principal, importId, body);
    }

    /** `GET /api/v1/import/:importId` — one page of the import's items. A stranger gets `404`. */
    @Get(':importId')
    public getView(
        @CurrentPrincipal() principal: Principal,
        @Param('importId', ParseUUIDPipe) importId: string,
        @Query() query: GetImportQueryDto,
    ): Promise<ImportView> {
        return this.imports.getView(principal, importId, query);
    }

    /** `DELETE /api/v1/import/:importId` — delete the import's working data; saved recipes stay. `204`. */
    @Delete(':importId')
    @HttpCode(HttpStatus.NO_CONTENT)
    @WriteRateLimit()
    public remove(
        @CurrentPrincipal() principal: Principal,
        @Param('importId', ParseUUIDPipe) importId: string,
    ): Promise<void> {
        return this.imports.delete(principal, importId);
    }

    /**
     * `POST /api/v1/import/:importId/advance` — one bounded step: pay, start parsing, match, save. Always `200` with the
     * view (the allowance state is in it). The body is empty by contract and the step runs AS the caller.
     */
    @Post(':importId/advance')
    @HttpCode(HttpStatus.OK)
    @WriteRateLimit()
    public advance(
        @CurrentPrincipal() principal: Principal,
        @CallerBearerToken() caller: CallerToken | undefined,
        @Param('importId', ParseUUIDPipe) importId: string,
        @Body() _body: AdvanceImportDto,
    ): Promise<ImportView> {
        return this.advancer.advance(principal, caller, importId);
    }

    /** `GET /api/v1/import/:importId/steps/:ordinal` — one item with its match lines, as the wizard shows it. */
    @Get(':importId/steps/:ordinal')
    public step(
        @CurrentPrincipal() principal: Principal,
        @CallerBearerToken() caller: CallerToken | undefined,
        @Param('importId', ParseUUIDPipe) importId: string,
        @Param() { ordinal }: ImportOrdinalParamDto,
    ): Promise<ImportStepResponse> {
        return this.steps.step(principal, caller, importId, ordinal, requestDeadline());
    }

    /** `POST /api/v1/import/:importId/cursor` — move the wizard. A stale `from` is `409 IMPORT_CURSOR_MOVED`. */
    @Post(':importId/cursor')
    @HttpCode(HttpStatus.OK)
    @WriteRateLimit()
    public moveCursor(
        @CurrentPrincipal() principal: Principal,
        @Param('importId', ParseUUIDPipe) importId: string,
        @Body() body: ImportCursorDto,
    ): Promise<ImportView> {
        return this.imports.moveCursor(principal, importId, body);
    }

    /** `PUT /api/v1/import/:importId/items/:ordinal/pick` — the cook's decision on one food of one line. */
    @Put(':importId/items/:ordinal/pick')
    @WriteRateLimit()
    public pick(
        @CurrentPrincipal() principal: Principal,
        @CallerBearerToken() caller: CallerToken | undefined,
        @Param('importId', ParseUUIDPipe) importId: string,
        @Param() { ordinal }: ImportOrdinalParamDto,
        @Body() body: ImportPickDto,
    ): Promise<ImportPickResponse> {
        return this.steps.pick(principal, caller, importId, ordinal, body, requestDeadline());
    }

    /** `POST /api/v1/import/:importId/items/:ordinal` — the cook's choices on one item; answers its step. */
    @Post(':importId/items/:ordinal')
    @HttpCode(HttpStatus.OK)
    @WriteRateLimit()
    public recordChoices(
        @CurrentPrincipal() principal: Principal,
        @CallerBearerToken() caller: CallerToken | undefined,
        @Param('importId', ParseUUIDPipe) importId: string,
        @Param() { ordinal }: ImportOrdinalParamDto,
        @Body() body: RecordImportChoicesDto,
    ): Promise<ImportStepResponse> {
        return this.steps.recordChoices(principal, caller, importId, ordinal, body, requestDeadline());
    }

    /** `POST /api/v1/import/:importId/choices` — the same choices for several items at once. */
    @Post(':importId/choices')
    @HttpCode(HttpStatus.OK)
    @WriteRateLimit()
    public recordChoicesBatch(
        @CurrentPrincipal() principal: Principal,
        @Param('importId', ParseUUIDPipe) importId: string,
        @Body() body: RecordImportChoicesBatchDto,
    ): Promise<ImportView> {
        return this.imports.recordChoicesBatch(principal, importId, body);
    }

    /** `POST /api/v1/import/:importId/leave` — "Save and leave": close the review. */
    @Post(':importId/leave')
    @HttpCode(HttpStatus.OK)
    @WriteRateLimit()
    public leave(
        @CurrentPrincipal() principal: Principal,
        @Param('importId', ParseUUIDPipe) importId: string,
        @Body() _body: LeaveImportDto,
    ): Promise<ImportView> {
        return this.imports.leave(principal, importId);
    }

    /** `GET /api/v1/import/:importId/flagged` — bound lines the review gate did not agree with, or is still checking. */
    @Get(':importId/flagged')
    public flagged(
        @CurrentPrincipal() principal: Principal,
        @CallerBearerToken() caller: CallerToken | undefined,
        @Param('importId', ParseUUIDPipe) importId: string,
        @Query() query: ImportListQueryDto,
    ): Promise<ImportFlaggedResponse> {
        return this.steps.flagged(principal, caller, importId, query, requestDeadline());
    }

    /** `GET /api/v1/import/:importId/to-check` — lines saved as written because nothing may bind without the cook. */
    @Get(':importId/to-check')
    public toCheck(
        @CurrentPrincipal() principal: Principal,
        @CallerBearerToken() caller: CallerToken | undefined,
        @Param('importId', ParseUUIDPipe) importId: string,
        @Query() query: ImportListQueryDto,
    ): Promise<ImportToCheckResponse> {
        return this.steps.toCheck(principal, caller, importId, query, requestDeadline());
    }
}

/** The budget of a read that asks food: inside the client's timeout, the same one the paste match route holds. */
function requestDeadline(): AbortSignal {
    return AbortSignal.timeout(MATCH_REQUEST_DEADLINE_MS);
}
