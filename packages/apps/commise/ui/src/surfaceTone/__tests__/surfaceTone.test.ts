/**
 * The surface-tone table (`componentFixes.md` §10, §10a): ONE table says, per surface, what its fill is and what a
 * chip rests on there; the press is DERIVED from the fill (ink laid over it, 10% light and 12% dark) and measured here
 * against the design session's eight values. Everything else (the web classes, the native context, the focus-ring gap)
 * reads this table, so these tests pin the table, the derivation and the contrast.
 *
 * Mutation lens: point a press at lineDivider, drop the alpha to 6%, drop a tone, or give a chip a muted resting fill
 * on a muted surface, and a test below fails by name.
 */
import { describe, expect, it } from 'vitest';

import { mixOver, role, roleDark, type Role } from '../../tokens/colors.js';
import { ratio } from '../../tokens/__tests__/utils/contrast.js';
import {
    chipPressToneOf,
    PRESS_INK_ALPHA,
    PRESS_VAR,
    pressFillsOf,
    pressVarOf,
    SURFACE_TONES,
    SURFACE_TONE_NAMES,
    SURFACE_VAR,
    type SurfaceTone,
} from '../surfaceTone.js';

const THEMES = {
    light: { colors: role, press: pressFillsOf(role, 'light') },
    dark: { colors: roleDark, press: pressFillsOf(roleDark, 'dark') },
} as const;

/** The design table (§10a): theme, tone, fill, press and the measured ratio. */
const MEASURED = [
    ['light', 'canvas', '#EFF3F6', '#D9DDE1', 1.22],
    ['light', 'paper', '#FCFDFF', '#E5E6E9', 1.23],
    ['light', 'paperOverlay', '#FFFFFF', '#E8E8E9', 1.22],
    ['light', 'muted', '#E9EDF2', '#D4D8DD', 1.22],
    ['dark', 'canvas', '#0E161E', '#293037', 1.37],
    ['dark', 'paper', '#172029', '#303941', 1.4],
    ['dark', 'paperOverlay', '#26313D', '#3E4853', 1.42],
    ['dark', 'muted', '#212B36', '#39434D', 1.42],
] as const;

describe('SURFACE_TONES', () => {
    it('covers canvas, paper, paperOverlay and muted, and nothing else', () => {
        expect([...SURFACE_TONE_NAMES].sort()).toEqual(['canvas', 'muted', 'paper', 'paperOverlay']);
        expect(Object.keys(SURFACE_TONES).sort()).toEqual(['canvas', 'muted', 'paper', 'paperOverlay']);
    });

    it('names the fill role each surface paints', () => {
        expect(SURFACE_TONES.canvas.fill).toBe('canvas');
        expect(SURFACE_TONES.paper.fill).toBe('paper');
        expect(SURFACE_TONES.paperOverlay.fill).toBe('paperOverlay');
        expect(SURFACE_TONES.muted.fill).toBe('surfaceMuted');
    });

    for (const [scheme, { colors, press }] of Object.entries(THEMES)) {
        for (const name of SURFACE_TONE_NAMES) {
            const fill = colors[SURFACE_TONES[name].fill];

            it(`${scheme} ${name}: a press is never the fill, and clears 1.2:1`, () => {
                expect(press[name]).not.toBe(fill);
                expect(ratio(press[name], fill)).toBeGreaterThanOrEqual(1.2);
            });

            it(`${scheme} ${name}: the focus ring holds 3:1 against the gap it sits in (SC 1.4.11)`, () => {
                expect(ratio(colors.focusRing, fill)).toBeGreaterThanOrEqual(3);
            });
        }
    }
});

describe('the derived press (§10a)', () => {
    for (const [scheme, tone, fill, press, measured] of MEASURED) {
        it(`${scheme} ${tone}: ${fill} presses to ${press} (${String(measured)}:1)`, () => {
            const theme = THEMES[scheme];

            expect(theme.colors[SURFACE_TONES[tone].fill].toUpperCase()).toBe(fill);
            expect(theme.press[tone].toUpperCase()).toBe(press);
            expect(ratio(theme.press[tone], fill)).toBeCloseTo(measured, 1);
        });
    }

    it('is the theme’s ink over the fill: 10% in light and 12% in dark', () => {
        expect(PRESS_INK_ALPHA).toEqual({ light: 0.1, dark: 0.12 });
        expect(THEMES.light.press.muted).toBe(mixOver(role.ink, role.surfaceMuted, 0.1));
        expect(THEMES.dark.press.muted).toBe(mixOver(roleDark.ink, roleDark.surfaceMuted, 0.12));
    });

    it('is emitted under --color-press-<tone>', () => {
        expect(pressVarOf('canvas')).toBe('--color-press-canvas');
        expect(pressVarOf('paperOverlay')).toBe('--color-press-paper-overlay');
        expect(pressVarOf('muted')).toBe('--color-press-muted');
    });
});

describe('a chip rests on paper on a muted surface, and on surfaceMuted everywhere else (§10a)', () => {
    it('picks the resting fill per tone', () => {
        const rest = (tone: SurfaceTone): Role => SURFACE_TONES[tone].chipFill;

        expect(rest('muted')).toBe('paper');
        expect(rest('canvas')).toBe('surfaceMuted');
        expect(rest('paper')).toBe('surfaceMuted');
        expect(rest('paperOverlay')).toBe('surfaceMuted');
    });

    it('presses to the table row of the surface it rests on', () => {
        expect(chipPressToneOf('muted')).toBe('paper');
        expect(chipPressToneOf('canvas')).toBe('muted');
        expect(chipPressToneOf('paper')).toBe('muted');
        expect(chipPressToneOf('paperOverlay')).toBe('muted');
    });

    for (const [scheme, { colors, press }] of Object.entries(THEMES)) {
        it(`${scheme}: a chip on a muted card reads (>= 1.14:1, the measured 1.16 and 1.15 unrounded) and every chip press clears 1.2:1`, () => {
            // §10a measured 1.16 (light) and 1.15 (dark) for paper on a muted surface. The other surfaces keep the
            // chip's existing resting fill ("as now"), so only the muted case carries a new floor.
            expect(
                ratio(colors[SURFACE_TONES.muted.chipFill], colors[SURFACE_TONES.muted.fill]),
            ).toBeGreaterThanOrEqual(1.14);

            for (const name of SURFACE_TONE_NAMES) {
                expect(
                    ratio(press[chipPressToneOf(name)], colors[SURFACE_TONES[name].chipFill]),
                ).toBeGreaterThanOrEqual(1.2);
            }
        });
    }
});

describe('the custom properties', () => {
    it('are --cm-surface and --cm-press', () => {
        expect(SURFACE_VAR).toBe('--cm-surface');
        expect(PRESS_VAR).toBe('--cm-press');
    });
});
