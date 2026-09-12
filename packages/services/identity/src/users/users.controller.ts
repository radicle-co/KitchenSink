import { Controller, Get, Patch, Post, Delete, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { UsersService } from './users.service.js';
import { CurrentAuthorizerContext } from '../auth/decorators/currentUser.decorator.js';
import type { AuthorizerContext } from '../auth/decorators/currentUser.decorator.js';
import { PatchUserMeBodyDto, DeleteUserMeResponseDto, EraseUserMeResponseDto } from './dto/user.dto.js';

// Canonically served under the `/api/{version}/` prefix. The bare `v1/...` entry is a DEPRECATED ALIAS:
// `/v1/*` is live in production and held by consumers configured OUTSIDE this repo (the Clerk dashboard
// webhook URL) as well as already-shipped mobile builds and cached web bundles, whose endpoints were
// inlined at build time. Removing it REQUIRES updating the Clerk dashboard first — see ADR-0011.
@Controller(['api/v1/users', 'v1/users'])
export class UsersController {
    constructor(private readonly usersService: UsersService) {}

    // NOTE (S-I2): the former `POST /api/v1/users/upsert` was removed — it had no callers (the read-through
    // auth middleware and the webhook provisioning path both go through the service/DAO directly), took
    // an unvalidated inline body, and ignored its authorizer context, i.e. dead attack surface on an
    // internet-facing service. `UsersService.upsertUser` is retained (covered by integration.test.ts).

    @Get('me')
    async getUserMe(@CurrentAuthorizerContext() ctx: AuthorizerContext) {
        return this.usersService.getUserMe(ctx);
    }

    @Patch('me')
    async patchUserMe(@CurrentAuthorizerContext() ctx: AuthorizerContext, @Body() body: PatchUserMeBodyDto) {
        return this.usersService.patchUserMe(ctx, body);
    }

    @Delete('me')
    @HttpCode(HttpStatus.ACCEPTED)
    async deleteUserMe(@CurrentAuthorizerContext() ctx: AuthorizerContext): Promise<DeleteUserMeResponseDto> {
        return this.usersService.deleteUserMe(ctx);
    }

    /**
     * `POST /api/v1/users/me/erasure` — IRREVERSIBLE account erasure of the CALLER'S OWN account
     * (plan U2). Distinct from `DELETE me`, which is the recoverable closure.
     *
     * `202`, not `201`: the work is asynchronous (identity scrubs synchronously, then the deletion-worker
     * deletes the Clerk account and fans out to recipe and food) and no resource is created at this URL.
     * A `POST` rather than a `DELETE` because the two lifecycle actions are different operations on the
     * same resource and must be separately addressable — overloading `DELETE me` with a flag would put the
     * irreversible action one boolean away from the recoverable one.
     *
     * The owner comes from the verified token and never from a body, so there is no body to smuggle an
     * `ownerId` through: a caller can only ever erase themselves.
     */
    @Post('me/erasure')
    @HttpCode(HttpStatus.ACCEPTED)
    async eraseUserMe(@CurrentAuthorizerContext() ctx: AuthorizerContext): Promise<EraseUserMeResponseDto> {
        return this.usersService.eraseUserMe(ctx);
    }
}
