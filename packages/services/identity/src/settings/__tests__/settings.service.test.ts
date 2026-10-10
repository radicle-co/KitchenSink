import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { AuthorizerContext } from '../../auth/decorators/currentUser.decorator.js';
import type { UserId } from '../../types/index.js';
import { SETTINGS_DEFAULTS } from '../settings.schema.js';
import { SettingsService, type SettingsStore } from '../settings.service.js';

const ctx = { userId: '01HZZSETTINGSUSER000000000' as UserId } as AuthorizerContext;
const stored = (searchShortcut: boolean | null) => ({ userId: ctx.userId, searchShortcut, updatedAt: new Date(0) });

function build(
    options: { found?: ReturnType<typeof stored> | undefined; written?: ReturnType<typeof stored> | undefined } = {},
) {
    const dao = {
        findByUserId: vi.fn<SettingsStore['findByUserId']>().mockResolvedValue(options.found),
        upsertForActiveUser: vi.fn<SettingsStore['upsertForActiveUser']>().mockResolvedValue(options.written),
    } satisfies SettingsStore;

    return { dao, service: new SettingsService(dao) };
}

describe('SettingsService.getSettings', () => {
    it('returns the defaults for a user with no row and issues NO write', async () => {
        const { dao, service } = build();

        await expect(service.getSettings(ctx)).resolves.toEqual(SETTINGS_DEFAULTS);
        expect(dao.findByUserId).toHaveBeenCalledWith(ctx.userId);
        expect(dao.upsertForActiveUser).not.toHaveBeenCalled();
    });

    it('returns the stored choice, resolved', async () => {
        const { service } = build({ found: stored(false) });

        await expect(service.getSettings(ctx)).resolves.toEqual({ searchShortcut: false });
    });
});

describe('SettingsService.patchSettings', () => {
    it('writes only the supplied columns and answers the resolved settings', async () => {
        const { dao, service } = build({ written: stored(false) });

        await expect(service.patchSettings(ctx, { searchShortcut: false })).resolves.toEqual({
            searchShortcut: false,
        });
        expect(dao.upsertForActiveUser).toHaveBeenCalledWith(ctx.userId, { searchShortcut: false });
    });

    it('answers 403 "Account is closed" when the user is no longer active, so nothing is recreated', async () => {
        const { service } = build({ written: undefined });

        const failure = service.patchSettings(ctx, { searchShortcut: true });

        await expect(failure).rejects.toBeInstanceOf(ForbiddenException);
        await expect(failure).rejects.toThrow('Account is closed');
    });

    it('writes NOTHING for an empty body and returns the current settings', async () => {
        const { dao, service } = build({ found: stored(false) });

        await expect(service.patchSettings(ctx, {})).resolves.toEqual({ searchShortcut: false });
        expect(dao.upsertForActiveUser).not.toHaveBeenCalled();
    });

    it('does not mistake an explicit false for "not supplied"', async () => {
        const { dao, service } = build({ written: stored(false) });

        await service.patchSettings(ctx, { searchShortcut: false });

        expect(dao.upsertForActiveUser).toHaveBeenCalledTimes(1);
    });
});
