import { describe, expect, it } from 'vitest';

import { resolveDeviceLocale } from '../../src/i18n/resolveLocale';

describe('resolveDeviceLocale', () => {
    it('resolves a supported device locale (exact or language-subtag)', () => {
        expect(resolveDeviceLocale(['en-US', 'en'])).toBe('en');
        expect(resolveDeviceLocale(['en-GB'])).toBe('en');
    });

    it('honors device preference order', () => {
        expect(resolveDeviceLocale(['fr-FR', 'en-US'])).toBe('en');
    });

    it('falls back to the default (en) for unsupported device locales', () => {
        expect(resolveDeviceLocale(['fr-FR', 'de-DE'])).toBe('en');
    });

    it('falls back to the default for an empty device list', () => {
        expect(resolveDeviceLocale([])).toBe('en');
    });
});
