import { describe, expect, it } from 'vitest';

import { SETTINGS_DEFAULTS } from '../../settings.schema.js';
import { resolveSettings } from '../resolveSettings.js';

const row = (searchShortcut: boolean | null) => ({ userId: 'u', searchShortcut, updatedAt: new Date(0) });

describe('resolveSettings (ADR-0059: NULL means never chosen)', () => {
    it.each([
        ['no row', undefined, true],
        ['a row whose column was never chosen (NULL)', row(null), true],
        ['a row holding false', row(false), false],
        ['a row holding true', row(true), true],
    ])('%s -> searchShortcut %s', (_label, input, expected) => {
        expect(resolveSettings(input)).toEqual({ searchShortcut: expected });
    });

    it('takes the default from the published defaults, not from a copy', () => {
        expect(resolveSettings(undefined)).toEqual(SETTINGS_DEFAULTS);
    });

    it('returns a fresh object, so a caller cannot mutate the frozen defaults', () => {
        expect(resolveSettings(undefined)).not.toBe(SETTINGS_DEFAULTS);
    });
});
