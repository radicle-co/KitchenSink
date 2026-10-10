import { describe, expect, it } from 'vitest';

import { patchUserSettingsRequestSchema, SETTINGS_DEFAULTS, userSettingsSchema } from '../settings.schema.js';

describe('patchUserSettingsRequestSchema', () => {
    it('accepts an empty body (a no-op the service answers without writing)', () => {
        expect(patchUserSettingsRequestSchema.safeParse({}).success).toBe(true);
    });

    it('accepts a boolean searchShortcut', () => {
        expect(patchUserSettingsRequestSchema.parse({ searchShortcut: false })).toEqual({ searchShortcut: false });
    });

    it.each([['yes'], [1], [null]])('rejects a non-boolean searchShortcut (%s)', (value) => {
        expect(patchUserSettingsRequestSchema.safeParse({ searchShortcut: value }).success).toBe(false);
    });

    it('rejects an unknown key — PATCH is strict, so the server deploys before the clients', () => {
        expect(patchUserSettingsRequestSchema.safeParse({ searchShortcut: true, theme: 'dark' }).success).toBe(false);
    });
});

describe('userSettingsSchema', () => {
    it('requires a fully resolved searchShortcut', () => {
        expect(userSettingsSchema.safeParse({}).success).toBe(false);
        expect(userSettingsSchema.safeParse({ searchShortcut: null }).success).toBe(false);
    });

    it('is NOT strict, so an old client ignores a key a newer server adds', () => {
        expect(userSettingsSchema.parse({ searchShortcut: true, futureSetting: 1 })).toEqual({ searchShortcut: true });
    });

    it('accepts the published defaults', () => {
        expect(userSettingsSchema.parse(SETTINGS_DEFAULTS)).toEqual(SETTINGS_DEFAULTS);
    });

    it('freezes the defaults', () => {
        expect(Object.isFrozen(SETTINGS_DEFAULTS)).toBe(true);
    });
});
