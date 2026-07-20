import { Controller, Get, Patch, Delete, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { UsersService } from './users.service.js';
import { CurrentAuthorizerContext } from '../auth/decorators/current-user.decorator.js';
import type { AuthorizerContext } from '../auth/decorators/current-user.decorator.js';
import { PatchUserMeBodyDto, DeleteUserMeResponseDto } from './dto/user.dto.js';

@Controller('v1/users')
export class UsersController {
    constructor(private readonly usersService: UsersService) {}

    // NOTE (S-I2): the former `POST /v1/users/upsert` was removed — it had no callers (the read-through
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
}
