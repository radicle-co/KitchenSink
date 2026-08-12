import { Controller, Get, Post, Param, Query, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { AdminListUsersQueryDto } from './dto/admin-list-users.query.dto.js';
import { AdminUserIdParamDto } from './dto/admin-user-id.param.dto.js';
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

    // ⚠️ EVERY `:userId` ROUTE TAKES `@Param() params: AdminUserIdParamDto`, NOT `@Param('userId') userId: string`.
    // The single-key form has metatype `String`, which the global `ZodValidationPipe`
    // (`strictSchemaDeclaration: false`) passes straight through — so the five routes below used to hand an
    // arbitrary caller-supplied string into `eq(users.id, …)` with no format check at all. Annotating the whole
    // params object with the Zod DTO is what puts the pipe in the path. A new admin action must do the same;
    // `tests/admin-param-validation.test.ts` discovers every `:userId` route from Nest's own metadata and fails
    // on one that reverts to a bare string.

    /**
     * `GET /api/v1/admin/users` — filtered, paginated user list (admin-scoped).
     *
     * ONE validated DTO replaces five bare `@Query()` strings plus a hand-rolled `Number.parseInt`. The old form
     * let `?limit=abc` become `NaN` — which `filters.limit ?? 50` does not catch, since `??` tests only
     * null/undefined — so `query.limit(NaN).offset(NaN)` reached drizzle and `NaN` came back in the response.
     * The pipe now coerces and bounds both, and rejects a non-numeric value with a `400` instead.
     */
    @Get()
    async listUsers(@Query() query: AdminListUsersQueryDto) {
        return this.adminService.listUsers(query);
    }

    @Post(':userId/suspend')
    @HttpCode(HttpStatus.OK)
    async suspendUser(
        @Param() params: AdminUserIdParamDto,
        @CurrentAuthorizerContext() ctx: AuthorizerContext,
    ): Promise<AdminSuspendUserResponseDto> {
        return this.adminService.suspendUser(params.userId, ctx);
    }

    @Post(':userId/unsuspend')
    @HttpCode(HttpStatus.OK)
    async unsuspendUser(
        @Param() params: AdminUserIdParamDto,
        @CurrentAuthorizerContext() ctx: AuthorizerContext,
    ): Promise<AdminUnsuspendUserResponseDto> {
        return this.adminService.unsuspendUser(params.userId, ctx);
    }

    @Post(':userId/reactivate')
    @HttpCode(HttpStatus.OK)
    async reactivateUser(
        @Param() params: AdminUserIdParamDto,
        @CurrentAuthorizerContext() ctx: AuthorizerContext,
    ): Promise<AdminReactivateUserResponseDto> {
        return this.adminService.reactivateUser(params.userId, ctx);
    }

    @Post(':userId/impersonation/start')
    @HttpCode(HttpStatus.OK)
    async startImpersonation(
        @Param() params: AdminUserIdParamDto,
        @CurrentAuthorizerContext() ctx: AuthorizerContext,
    ): Promise<ImpersonationStartResponseDto> {
        return this.adminService.startImpersonation(params.userId, ctx);
    }

    @Post(':userId/impersonation/stop')
    @HttpCode(HttpStatus.OK)
    async stopImpersonation(
        @Param() params: AdminUserIdParamDto,
        @CurrentAuthorizerContext() ctx: AuthorizerContext,
    ): Promise<ImpersonationStopResponseDto> {
        return this.adminService.stopImpersonation(params.userId, ctx);
    }
}
