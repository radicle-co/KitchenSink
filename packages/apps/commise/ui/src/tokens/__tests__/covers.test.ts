/**
 * The typographic cover tints (`docs/design/uiOverhaul/darkTheme.md` §4, "Typographic recipe covers"): the same six
 * hues in both themes, each carrying `ink` lettering. Light values are the build spec's; dark ones are the hue at 22%
 * over dark `paper`. A cover NAMES its tint, so the theme picks the value at render.
 */
import { wcagContrast } from 'culori';
import { describe, expect, it } from 'vitest';

import { role, roleDark } from '../colors.js';
import { COVER_TINT_NAMES, coverTint, coverTintDark } from '../covers.js';

describe('cover tints', () => {
    it('names six hues, in a fixed order the hash buckets index', () => {
        expect(COVER_TINT_NAMES).toEqual(['seafoam', 'coral', 'sky', 'premium', 'success', 'warning']);
    });

    it('holds the spec values in both themes', () => {
        expect(coverTint).toEqual({
            seafoam: '#E6F0EF',
            coral: '#FAE9E4',
            sky: '#DFF0F8',
            premium: '#F6EBE0',
            success: '#E2F2EA',
            warning: '#FDEFD9',
        });
        expect(coverTintDark).toEqual({
            seafoam: '#22312E',
            coral: '#4A352E',
            sky: '#374245',
            premium: '#46392C',
            success: '#283C2E',
            warning: '#4D3C21',
        });
    });

    it.each(COVER_TINT_NAMES)('ink lettering reads on the %s cover in both themes', (name) => {
        expect(wcagContrast(role.ink, coverTint[name])).toBeGreaterThanOrEqual(4.5);
        expect(wcagContrast(roleDark.ink, coverTintDark[name])).toBeGreaterThanOrEqual(4.5);
    });
});
