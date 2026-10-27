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
    chipFillRoleOf,
    chipFillVarOf,
    chipPressToneOf,
    chipPressVarOf,
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
    ['light', 'paperRaised', '#FFFFFF', '#E8E8E9', 1.22],
    ['light', 'inverse', '#171B20', '#2E3236', 1.34],
    ['dark', 'canvas', '#0E161E', '#293037', 1.37],
    ['dark', 'paper', '#172029', '#303941', 1.4],
    ['dark', 'paperOverlay', '#26313D', '#3E4853', 1.42],
    ['dark', 'muted', '#212B36', '#39434D', 1.42],
    ['dark', 'paperRaised', '#212B36', '#39434D', 1.42],
    ['dark', 'inverse', '#EBEFF2', '#D2D6D9', 1.26],
] as const;

describe('SURFACE_TONES', () => {
    it('covers canvas, paper, paperRaised, paperOverlay, muted and inverse, and nothing else', () => {
        const all = ['canvas', 'inverse', 'muted', 'paper', 'paperOverlay', 'paperRaised'];

        expect([...SURFACE_TONE_NAMES].sort()).toEqual(all);
        expect(Object.keys(SURFACE_TONES).sort()).toEqual(all);
    });

    it('names the fill role each surface paints', () => {
        expect(SURFACE_TONES.canvas.fill).toBe('canvas');
        expect(SURFACE_TONES.paper.fill).toBe('paper');
        expect(SURFACE_TONES.paperOverlay.fill).toBe('paperOverlay');
        expect(SURFACE_TONES.muted.fill).toBe('surfaceMuted');
        expect(SURFACE_TONES.paperRaised.fill).toBe('paperRaised');
        expect(SURFACE_TONES.inverse.fill).toBe('inverse');
    });

    // §10b: inverse presses with its OWN ink (inverseInk) laid over it, since the page ink would vanish on a charcoal fill.
    it('lays the inverse surface’s own ink over it, and the page ink over every other', () => {
        expect(SURFACE_TONES.inverse.ink).toBe('inverseInk');

        for (const name of SURFACE_TONE_NAMES.filter((tone) => tone !== 'inverse')) {
            expect(SURFACE_TONES[name].ink, name).toBe('ink');
        }
    });

    for (const [scheme, { colors, press }] of Object.entries(THEMES)) {
        for (const name of SURFACE_TONE_NAMES) {
            const fill = colors[SURFACE_TONES[name].fill];

            it(`${scheme} ${name}: a press is never the fill, and clears 1.2:1`, () => {
                expect(press[name]).not.toBe(fill);
                expect(ratio(press[name], fill)).toBeGreaterThanOrEqual(1.2);
            });

            it(`${scheme} ${name}: the focus ring holds 3:1 against the gap it sits in (SC 1.4.11)`, () => {
                // An inverse surface rings in its own role (`FOCUS_RING_CLASS.inverse`), flush; every other in `focusRing`.
                expect(
                    ratio(name === 'inverse' ? colors.inverseAction : colors.focusRing, fill),
                ).toBeGreaterThanOrEqual(3);
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

describe('a chip rests on a fill chosen per theme (§10a, §10b)', () => {
    const rest = (tone: SurfaceTone, scheme: 'light' | 'dark'): Role => chipFillRoleOf(tone, scheme);

    it('picks the resting fill per tone: paper on a muted surface, surfaceMuted elsewhere', () => {
        for (const scheme of ['light', 'dark'] as const) {
            expect(rest('muted', scheme)).toBe('paper');
            expect(rest('canvas', scheme)).toBe('surfaceMuted');
            expect(rest('paper', scheme)).toBe('surfaceMuted');
        }
    });

    // §10b: a surfaceMuted chip on a dark sheet, dialog or menu reads 1.09:1, so it rests on paper there (1.25:1).
    it('rests a chip on paperOverlay on surfaceMuted in light and on paper in dark', () => {
        expect(rest('paperOverlay', 'light')).toBe('surfaceMuted');
        expect(rest('paperOverlay', 'dark')).toBe('paper');
        expect(chipPressToneOf('paperOverlay', 'dark')).toBe('paper');
    });

    // §10b: dark paperRaised IS surfaceMuted (#212B36), so a surfaceMuted chip there is invisible.
    it('rests a chip on paperRaised on surfaceMuted in light and on paper in dark', () => {
        expect(rest('paperRaised', 'light')).toBe('surfaceMuted');
        expect(rest('paperRaised', 'dark')).toBe('paper');
    });

    it('presses to the table row of the surface it rests on, per theme', () => {
        expect(chipPressToneOf('muted', 'light')).toBe('paper');
        expect(chipPressToneOf('muted', 'dark')).toBe('paper');
        expect(chipPressToneOf('canvas', 'light')).toBe('muted');
        expect(chipPressToneOf('paperRaised', 'light')).toBe('muted');
        expect(chipPressToneOf('paperRaised', 'dark')).toBe('paper');
    });

    /**
     * The chip fills below 1.14:1 (§10b states 1.15; the unrounded floor is the measured 1.148, as for a muted card).
     * Each is a DECISION recorded, not a pass: the test requires this list to be exactly the failing set, so fixing a
     * fill (or breaking another) fails here by name.
     *  - light canvas: 1.05:1, accepted by `componentFixes.md` §4 (the row's label and the 32 px height carry it).
     * Dark paperOverlay was the second, at 1.09:1; §10b moved its chip onto paper (1.25:1), so it is no longer listed.
     */
    const BELOW_FLOOR = ['light canvas'];
    const CHIP_FLOOR = 1.14;

    it('holds every other tone’s chip fill at 1.14:1 (the ruled 1.15) or more against its fill, in both themes', () => {
        const below: string[] = [];

        for (const [scheme, { colors }] of Object.entries(THEMES)) {
            for (const name of SURFACE_TONE_NAMES) {
                const chip = colors[chipFillRoleOf(name, scheme as 'light' | 'dark')];

                if (ratio(chip, colors[SURFACE_TONES[name].fill]) < CHIP_FLOOR) {
                    below.push(`${scheme} ${name}`);
                }
            }
        }

        expect(below.sort()).toEqual([...BELOW_FLOOR].sort());
    });

    for (const [scheme, { colors, press }] of Object.entries(THEMES)) {
        it(`${scheme}: every chip press clears 1.2:1 against the fill the chip rests on`, () => {
            for (const name of SURFACE_TONE_NAMES) {
                const s = scheme as 'light' | 'dark';

                expect(
                    ratio(press[chipPressToneOf(name, s)], colors[chipFillRoleOf(name, s)]),
                    `${scheme} ${name}`,
                ).toBeGreaterThanOrEqual(1.2);
            }
        });
    }

    it('is emitted under --color-chip-fill-<tone> and --color-chip-press-<tone>', () => {
        expect(chipFillVarOf('paperRaised')).toBe('--color-chip-fill-paper-raised');
        expect(chipPressVarOf('paperRaised')).toBe('--color-chip-press-paper-raised');
        expect(chipFillVarOf('muted')).toBe('--color-chip-fill-muted');
    });
});

describe('the custom properties', () => {
    it('are --cm-surface and --cm-press', () => {
        expect(SURFACE_VAR).toBe('--cm-surface');
        expect(PRESS_VAR).toBe('--cm-press');
    });
});
