import { Controller, Get, Post, Param, Query, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { AdminService } from './admin.service.js';
import { CurrentAuthorizerContext } from '../auth/decorators/current-user.decorator.js';
import type { AuthorizerContext } from '../auth/decorators/current-user.decorator.js';
import { ScopesGuard } from '../auth/guards/scopes.guard.js';
import { RequireScopes } from '../auth/decorators/require-scopes.decorator.js';
import {
    AdminSuspendUserResponseDto,
    AdminUnsuspendUserResponseDto,
    AdminReactivateUserResponseDto,
    ImpersonationStartResponseDto,
    ImpersonationStopResponseDto,
} from './dto/admin.dto.js';

// Controller-level (not global `APP_GUARD`): every route under `v1/admin/users` requires `admin:users`,
// and scoping the guard here — rather than app-wide — keeps its blast radius to this controller instead
// of gating every route in the service. See the Guard pattern JSDoc on `ScopesGuard` for why this
// replaces the old imperative `assertAdmin(ctx)` call the service used to repeat per-method.
@UseGuards(ScopesGuard)
@RequireScopes('admin:users')
// Canonically served under the `/api/{version}/` prefix. The bare `v1/...` entry is a DEPRECATED ALIAS:
// `/v1/*` is live in production and held by consumers configured OUTSIDE this repo (the Clerk dashboard
// webhook URL) as well as already-shipped mobile builds and cached web bundles, whose endpoints were
// inlined at build time. Removing it REQUIRES updating the Clerk dashboard first — see ADR-0011.
@Controller(['api/v1/admin/users', 'v1/admin/users'])
export class AdminController {
    constructor(private readonly adminService: AdminService) {}

    @Get()
    async listUsers(
        @Query('email') email?: string,
        @Query('name') name?: string,
        @Query('sub') sub?: string,
        @Query('limit') limit?: string,
        @Query('offset') offset?: string,
    ) {
        return this.adminService.listUsers({
            email,
            name,
            sub,
            limit: limit ? Number.parseInt(limit, 10) : undefined,
            offset: offset ? Number.parseInt(offset, 10) : undefined,
        });
    }

    @Post(':userId/suspend')
    @HttpCode(HttpStatus.OK)
    async suspendUser(
        @Param('userId') userId: string,
        @CurrentAuthorizerContext() ctx: AuthorizerContext,
    ): Promise<AdminSuspendUserResponseDto> {
        return this.adminService.suspendUser(userId, ctx);
    }

    @Post(':userId/unsuspend')
    @HttpCode(HttpStatus.OK)
    async unsuspendUser(
        @Param('userId') userId: string,
        @CurrentAuthorizerContext() ctx: AuthorizerContext,
    ): Promise<AdminUnsuspendUserResponseDto> {
        return this.adminService.unsuspendUser(userId, ctx);
    }

    @Post(':userId/reactivate')
    @HttpCode(HttpStatus.OK)
    async reactivateUser(
        @Param('userId') userId: string,
        @CurrentAuthorizerContext() ctx: AuthorizerContext,
    ): Promise<AdminReactivateUserResponseDto> {
        return this.adminService.reactivateUser(userId, ctx);
    }

    @Post(':userId/impersonation/start')
    @HttpCode(HttpStatus.OK)
    async startImpersonation(
        @Param('userId') userId: string,
        @CurrentAuthorizerContext() ctx: AuthorizerContext,
    ): Promise<ImpersonationStartResponseDto> {
        return this.adminService.startImpersonation(userId, ctx);
    }

    @Post(':userId/impersonation/stop')
    @HttpCode(HttpStatus.OK)
    async stopImpersonation(
        @Param('userId') userId: string,
        @CurrentAuthorizerContext() ctx: AuthorizerContext,
    ): Promise<ImpersonationStopResponseDto> {
        return this.adminService.stopImpersonation(userId, ctx);
    }
}
