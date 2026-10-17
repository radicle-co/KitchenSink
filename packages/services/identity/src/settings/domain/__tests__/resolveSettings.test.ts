import { describe, expect, it } from 'vitest';

import { SETTINGS_DEFAULTS } from '../../settings.schema.js';
import { resolveSettings } from '../resolveSettings.js';

const row = (searchShortcut: boolean | null, recipeViewMode: 'grid' | 'list' | null = null) => ({
    userId: 'u',
    searchShortcut,
    recipeViewMode,
    updatedAt: new Date(0),
});

describe('resolveSettings (ADR-0059: NULL means never chosen)', () => {
    it.each([
        ['no row', undefined, true],
        ['a row whose column was never chosen (NULL)', row(null), true],
        ['a row holding false', row(false), false],
        ['a row holding true', row(true), true],
    ])('%s -> searchShortcut %s', (_label, input, expected) => {
        expect(resolveSettings(input)).toMatchObject({ searchShortcut: expected });
    });

    it.each([
        ['no row', undefined, 'auto'],
        ['a row whose view was never chosen (NULL)', row(null, null), 'auto'],
        ['a row holding grid', row(null, 'grid'), 'grid'],
        ['a row holding list', row(null, 'list'), 'list'],
    ])('%s -> recipeViewMode %s ("auto" = the width picks, on the client)', (_label, input, expected) => {
        expect(resolveSettings(input)).toMatchObject({ recipeViewMode: expected });
    });

    it('resolves the two settings independently', () => {
        expect(resolveSettings(row(false, null))).toEqual({ searchShortcut: false, recipeViewMode: 'auto' });
        expect(resolveSettings(row(null, 'list'))).toEqual({ searchShortcut: true, recipeViewMode: 'list' });
    });

    it('takes the default from the published defaults, not from a copy', () => {
        expect(resolveSettings(undefined)).toEqual(SETTINGS_DEFAULTS);
    });

    it('returns a fresh object, so a caller cannot mutate the frozen defaults', () => {
        expect(resolveSettings(undefined)).not.toBe(SETTINGS_DEFAULTS);
    });
});
