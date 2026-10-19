import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Patch } from '@nestjs/common';

import { CurrentAuthorizerContext } from '../auth/decorators/currentUser.decorator.js';
import type { AuthorizerContext } from '../auth/decorators/currentUser.decorator.js';
import { PatchUserSettingsBodyDto } from './dto/settings.dto.js';
import type { UserSettings } from './settings.schema.js';
import { SettingsService } from './settings.service.js';

// ONLY the canonical `/api/v1/` path. The bare `v1/...` alias of ADR-0011 exists for consumers that shipped on
// those paths before the prefix did; this surface has none, so it takes no alias (pinned by
// `tests/apiRoutePaths.test.ts`).
@Controller('api/v1/users/me/settings')
export class SettingsController {
    constructor(private readonly settingsService: SettingsService) {}

    @Get()
    async getSettings(@CurrentAuthorizerContext() ctx: AuthorizerContext): Promise<UserSettings> {
        return this.settingsService.getSettings(ctx);
    }

    @Patch()
    async patchSettings(
        @CurrentAuthorizerContext() ctx: AuthorizerContext,
        @Body() body: PatchUserSettingsBodyDto,
    ): Promise<UserSettings> {
        return this.settingsService.patchSettings(ctx, body);
    }

    /** Restore every setting to "never chosen" (ADR-0059). `204` with no body, also when there was nothing to delete. */
    @Delete()
    @HttpCode(HttpStatus.NO_CONTENT)
    async resetSettings(@CurrentAuthorizerContext() ctx: AuthorizerContext): Promise<void> {
        await this.settingsService.resetSettings(ctx);
    }
}
