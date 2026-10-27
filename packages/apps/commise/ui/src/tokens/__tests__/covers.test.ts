/**
 * The typographic cover tints (`docs/design/uiOverhaul/darkTheme.md` §4, "Typographic recipe covers"): the same six
 * hues in both themes, each carrying `ink` lettering. Values are the redesign's (pinned to the design sources in `redesignPin.test.ts`). A cover NAMES its tint, so the theme picks the value at render.
 */
import { wcagContrast } from 'culori';
import { describe, expect, it } from 'vitest';

import { role, roleDark } from '../colors.js';
import { COVER_TINT_NAMES, coverTint, coverTintDark } from '../covers.js';

describe('cover tints', () => {
    it('names six hues, in a fixed order the hash buckets index', () => {
        expect(COVER_TINT_NAMES).toEqual(['steel', 'coral', 'sky', 'premium', 'success', 'warning']);
    });

    // REWRITTEN for the redesign: the pale washes of the cool palette (light) and their dusk versions (dark). The first
    // tint was `seafoam`; it is `steel` now, at the same position, so the hash still indexes the same slot.
    it('holds the redesign values in both themes', () => {
        expect(coverTint).toEqual({
            steel: '#E1EDFA',
            coral: '#F7E9D7',
            sky: '#DDEEFC',
            premium: '#F5E9DF',
            success: '#E4EDF2',
            warning: '#F7E9D7',
        });
        expect(coverTintDark).toEqual({
            steel: '#202B37',
            coral: '#342817',
            sky: '#1C2C38',
            premium: '#32281F',
            success: '#232B30',
            warning: '#342817',
        });
    });

    it.each(COVER_TINT_NAMES)('ink lettering reads on the %s cover in both themes', (name) => {
        expect(wcagContrast(role.ink, coverTint[name])).toBeGreaterThanOrEqual(4.5);
        expect(wcagContrast(roleDark.ink, coverTintDark[name])).toBeGreaterThanOrEqual(4.5);
    });
});
