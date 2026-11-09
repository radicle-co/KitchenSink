/**
 * `FoodPublicationController` — the AUTHOR's half of publishing a food (ADR-0029 §5): ask for it, and read where the
 * request stands. Staff's half (`food:admin`) lives on `FoodsAdminController`.
 *
 * A thin Facade: the id guard, the caller, and a delegation to {@link FoodPublicationService}. Both routes are
 * `private, no-store` — the answer is the caller's own.
 *
 * ⚠️ The paths sit under `authored/`, beside `POST authored` and before every `:id` route in `FoodsController`; the
 * three-segment shape cannot be swallowed by a two-segment `:id/…` route, and the mocked integration tier proves it.
 *
 * @pattern Facade — id guard, caller narrowing and delegation only
 */
import { Controller, Get, Header, HttpStatus, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';

import { requireUserUlid } from '../auth/requireCaller.js';
import type { AuthenticatedRequest } from '../auth/authenticatedPrincipal.js';
import { apiError } from '../common/apiError.js';
import { isFoodId } from '../db/ulid.js';
import { OwnFoodListQueryDto } from './dto/publication.dto.js';
import type { OwnFoodList, PublicationRequestDetail } from './publication.schema.js';
import { FoodPublicationService } from './publication.service.js';

// The bare `v1/...` entry is the DEPRECATED ALIAS every food controller carries (ADR-0011).
@Controller(['api/v1/foods/authored', 'v1/foods/authored'])
export class FoodPublicationController {
    public constructor(@Inject(FoodPublicationService) private readonly publication: FoodPublicationService) {}

    /**
     * `GET /api/v1/foods/authored?cursor=` — the author's own foods, newest edit first, each with its publication state,
     * and the count of decisions they have not opened (the dot on Profile "Your foods"). Private, never cached.
     *
     * ⚠️ `FoodPublicationController` is registered BEFORE `FoodsController`: `GET authored` would otherwise be read as
     * `GET :id` with the id `authored`.
     */
    @Get()
    @Header('Cache-Control', 'private, no-store')
    public async list(@Query() query: OwnFoodListQueryDto, @Req() req: AuthenticatedRequest): Promise<OwnFoodList> {
        return this.publication.listOwn(requireUserUlid(req), query.cursor);
    }

    /**
     * `POST /api/v1/foods/authored/{id}/publication-request` — ask to make the author's private food public. `201` with
     * the new request; `200` with the one already pending. `409 PUBLICATION_NOT_REQUESTABLE` when the food is
     * withdrawn, not private, or this version was declined; `404` for a food that is not theirs.
     */
    @Post(':id/publication-request')
    @Header('Cache-Control', 'private, no-store')
    public async request(
        @Param('id') id: string,
        @Req() req: AuthenticatedRequest,
        @Res({ passthrough: true }) res: Response,
    ): Promise<PublicationRequestDetail> {
        this.requireId(id);

        const { created, detail } = await this.publication.request(requireUserUlid(req), id);
        res.status(created ? HttpStatus.CREATED : HttpStatus.OK);

        return detail;
    }

    /**
     * `GET /api/v1/foods/authored/{id}/publication-request` — the latest request and the version it names, so the
     * author sees what is waiting for staff and why a decline happened. `404 PUBLICATION_REQUEST_NOT_FOUND` when none.
     */
    @Get(':id/publication-request')
    @Header('Cache-Control', 'private, no-store')
    public async read(@Param('id') id: string, @Req() req: AuthenticatedRequest): Promise<PublicationRequestDetail> {
        this.requireId(id);

        return this.publication.read(requireUserUlid(req), id);
    }

    /** Validate the `id` path param is a structurally valid ULID → else `400`. */
    private requireId(id: string): void {
        if (!isFoodId(id)) {
            throw apiError('INVALID_ID', 'The id is not a valid food (ingredient) ULID');
        }
    }
}
