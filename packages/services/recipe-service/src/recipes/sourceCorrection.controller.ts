/**
 * `POST /api/v1/recipes/{id}/source-correction` — staff change a confirmed source answer (ADR-0100).
 *
 * Its own controller, because its caller is staff and not a cook, and it must not widen `RecipesController`'s constructor. It is
 * canonical-prefix only: no shipped client holds a `v1/` alias of a route that did not exist.
 *
 * ⛔ The grant (`recipes:source:correct`) is decided by `evaluateSourceCorrectionScope`, a policy over the principal's scopes, not by
 * a Guard (ADR-0023, DD18): what is authorised is a value on the request and a row read under lock.
 */
import {
    Body,
    Controller,
    Get,
    Header,
    HttpCode,
    HttpStatus,
    Inject,
    Param,
    ParseUUIDPipe,
    Post,
    Query,
    UsePipes,
} from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';

import { CurrentPrincipal } from '../auth/currentPrincipal.decorator.js';
import type { Principal } from '../auth/principal.js';
import { WriteRateLimit } from '../common/throttle/throttle.decorators.js';
import { SourceHoldClearDto } from './dto/sourceHoldClear.dto.js';
import { SourceCorrectionDto } from './dto/sourceCorrection.dto.js';
import { SourceCorrectionPreviewQueryDto } from './dto/sourceCorrectionPreviewQuery.dto.js';
import type { SourceCorrectionPreview, SourceCorrectionResponse, SourceHoldClearResponse } from './recipes.schema.js';
import { SourceCorrectionService } from './sourceCorrection.service.js';
import { SourceHoldClearService } from './sourceHoldClear.service.js';

@Controller('api/v1/recipes')
@UsePipes(ZodValidationPipe)
export class SourceCorrectionController {
    public constructor(
        private readonly sourceCorrection: SourceCorrectionService,
        // `Pick` types emit `Object` as metadata, so the class token is named in the module and the type is narrowed here.
        @Inject(SourceHoldClearService) private readonly holdClear: Pick<SourceHoldClearService, 'clearByStaff'>,
    ) {}

    /** Correct a recipe's source answer. A mutation, so the erasure lock applies to the staff caller as it does to any write. */
    @Post(':id/source-correction')
    @HttpCode(HttpStatus.OK)
    @WriteRateLimit()
    public async correctSource(
        @CurrentPrincipal() principal: Principal,
        @Param('id', ParseUUIDPipe) id: string,
        @Body() body: SourceCorrectionDto,
    ): Promise<SourceCorrectionResponse> {
        return this.sourceCorrection.correct(principal, id, body);
    }

    /**
     * What staff see before they apply: the recipe's title, owner, answer and visibility. Read-only, `private, no-store` (the body
     * is another cook's private recipe), and answered under the same grant and the same single `404` as the correction.
     */
    @Get(':id/source-correction')
    @Header('Cache-Control', 'private, no-store')
    public async previewSource(
        @CurrentPrincipal() principal: Principal,
        @Param('id', ParseUUIDPipe) id: string,
        @Query() query: SourceCorrectionPreviewQueryDto,
    ): Promise<SourceCorrectionPreview> {
        return this.sourceCorrection.preview(principal, id, query.ownerAccountId);
    }

    /**
     * Clear a recipe's correction hold (ADR-0106). A mutation, so the erasure lock applies to the staff caller as to any write. The
     * earned clear has no route: `SourceHoldClearService.clearByEarnedRewrite` is reached only from the cook's rewrite.
     */
    @Post(':id/source-correction/hold-clear')
    @HttpCode(HttpStatus.OK)
    @WriteRateLimit()
    public async clearSourceHold(
        @CurrentPrincipal() principal: Principal,
        @Param('id', ParseUUIDPipe) id: string,
        @Body() body: SourceHoldClearDto,
    ): Promise<SourceHoldClearResponse> {
        return this.holdClear.clearByStaff(principal, id, body);
    }
}
