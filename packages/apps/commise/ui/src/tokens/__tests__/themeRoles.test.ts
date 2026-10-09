/**
 * Both themes of every colour role (`docs/design/uiOverhaul/darkTheme.md`; `ownerDecisions.md` D11 and D15).
 *
 * The values are pinned to the spec's §1 table, and every pair the spec's §3 lists is MEASURED here in both themes, so
 * a re-themed role moves the ratio and fails on the pair it breaks, not on a spelling. `roleDark` is typed
 * `Record<Role, string>`, so a role with no dark value does not compile; this file proves the values are the spec's.
 */
import { converter, formatHex, wcagContrast } from 'culori';
import { describe, expect, it } from 'vitest';

import { palette, role, roleDark, tint, type Role } from '../colors.js';

const toRgb = converter('rgb');

/** WCAG 2.x AA: 4.5:1 for text (SC 1.4.3), 3:1 for edges, state and graphics (SC 1.4.11). */
const AA_TEXT = 4.5;
const AA_NON_TEXT = 3;

/** An `rgba()` (or hex) composited over an opaque surface, as the hex the eye sees. Pure. */
function over(colour: string, surface: string): string {
    const top = toRgb(colour);
    const bottom = toRgb(surface);

    if (top === undefined || bottom === undefined) {
        throw new Error(`Cannot composite ${colour} over ${surface}.`);
    }

    const alpha = top.alpha ?? 1;

    return formatHex({
        mode: 'rgb',
        r: top.r * alpha + bottom.r * (1 - alpha),
        g: top.g * alpha + bottom.g * (1 - alpha),
        b: top.b * alpha + bottom.b * (1 - alpha),
    });
}

describe('D11 — the warm greys and the one value the dark spec changed in light', () => {
    it('warms slate, pewter and mist, and turns pearl into linen', () => {
        expect(palette.slate).toBe('#6B645C');
        expect(palette.pewter).toBe('#8A847C');
        expect(palette.mist).toBe('#C9C1B6');
        expect(palette.pearl).toBe('#F3EEE6');
    });

    it('darkens the caution text to #8C5A00, which closes three light gaps', () => {
        expect(palette['warning-dark']).toBe('#8C5A00');
        expect(role.attention).toBe('#8C5A00');
    });
});

describe('the new roles (darkTheme.md §1)', () => {
    it('adds them in light at the spec values', () => {
        expect(role).toMatchObject({
            paperRaised: '#FFFFFF',
            paperOverlay: '#FFFFFF',
            surfaceMuted: '#F3EEE6',
            inverse: '#2D3436',
            inverseInk: '#FFFFFF',
            inverseAction: '#5BA8A0',
            onAction: '#FFFFFF',
            actionPressed: '#2A6B65',
            photoChip: tint(palette.white, 0.92),
            scrim: tint(palette.charcoal, 0.4),
        });
    });
});

describe('roleDark (darkTheme.md §1)', () => {
    it('gives every role a dark value — the same key set as role', () => {
        expect(Object.keys(roleDark).sort()).toEqual(Object.keys(role).sort());
    });

    it('holds the spec value for every role', () => {
        expect(roleDark).toEqual({
            canvas: '#141210',
            paper: '#1E1B18',
            paperRaised: '#272320',
            paperOverlay: '#302C28',
            surfaceMuted: '#2B2825',
            ink: '#EDE9E4',
            inkMuted: '#B6B0A9',
            lineControl: '#857F79',
            lineDivider: '#3B3734',
            action: '#31807A',
            actionText: '#7DC7C0',
            onAction: '#FFFFFF',
            actionPressed: '#2A6B65',
            selectedFill: '#243935',
            selectedEdge: '#65B5AE',
            hereBar: '#65B5AE',
            focusRing: '#7DC7C0',
            rating: '#EAA950',
            attention: '#EFBA64',
            attentionTint: 'rgba(245, 176, 65, 0.2)',
            danger: '#C05238',
            dangerText: '#EC8E76',
            inverse: '#EDE9E4',
            inverseInk: '#2D3436',
            inverseAction: '#2A6B65',
            photoChip: tint('#302C28', 0.92),
            scrim: tint('#000000', 0.6),
        } satisfies Record<Role, string>);
    });
});

/** Both themes, for the pairs measured once per theme. */
const THEMES = [
    ['light', role],
    ['dark', roleDark],
] as const;

describe.each(THEMES)('the %s theme — text roles clear 4.5:1 on every surface (§3.1)', (_name, theme) => {
    const surfaces = ['canvas', 'paper', 'paperRaised', 'paperOverlay', 'surfaceMuted'] as const;
    const texts = ['ink', 'inkMuted', 'actionText', 'attention', 'dangerText'] as const;

    for (const text of texts) {
        for (const surface of surfaces) {
            it(`${text} on ${surface}`, () => {
                expect(wcagContrast(theme[text], theme[surface])).toBeGreaterThanOrEqual(AA_TEXT);
            });
        }
    }
});

describe.each(THEMES)('the %s theme — edge and graphic roles clear 3:1 (§3.1)', (_name, theme) => {
    const surfaces = ['canvas', 'paper', 'paperRaised', 'paperOverlay', 'surfaceMuted'] as const;

    for (const graphic of ['lineControl', 'focusRing', 'rating'] as const) {
        for (const surface of surfaces) {
            it(`${graphic} on ${surface}`, () => {
                expect(wcagContrast(theme[graphic], theme[surface])).toBeGreaterThanOrEqual(AA_NON_TEXT);
            });
        }
    }

    for (const marker of ['hereBar', 'selectedEdge'] as const) {
        for (const surface of ['canvas', 'paper'] as const) {
            it(`${marker} on ${surface}`, () => {
                expect(wcagContrast(theme[marker], theme[surface])).toBeGreaterThanOrEqual(AA_NON_TEXT);
            });
        }
    }
});

describe.each(THEMES)('the %s theme — fills and their labels (§3.2)', (_name, theme) => {
    it('onAction on the action fill', () => {
        expect(wcagContrast(theme.onAction, theme.action)).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it('onAction on the pressed action fill (#2A6B65 in both themes, darkTheme.md §1)', () => {
        expect(wcagContrast(theme.onAction, theme.actionPressed)).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it('onAction on the danger fill', () => {
        expect(wcagContrast(theme.onAction, theme.danger)).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it.each(['canvas', 'paperRaised'] as const)('the action fill stands off %s (3:1)', (surface) => {
        expect(wcagContrast(theme.action, theme[surface])).toBeGreaterThanOrEqual(AA_NON_TEXT);
    });

    it('actionText and ink on selectedFill', () => {
        expect(wcagContrast(theme.actionText, theme.selectedFill)).toBeGreaterThanOrEqual(AA_TEXT);
        expect(wcagContrast(theme.ink, theme.selectedFill)).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it.each(['paper', 'canvas'] as const)('ink AND attention read on the attention tint over %s', (surface) => {
        const fill = over(theme.attentionTint, theme[surface]);

        expect(wcagContrast(theme.ink, fill)).toBeGreaterThanOrEqual(AA_TEXT);
        expect(wcagContrast(theme.attention, fill)).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it('inverseInk and inverseAction read on the inverse (snackbar) surface', () => {
        expect(wcagContrast(theme.inverseInk, theme.inverse)).toBeGreaterThanOrEqual(AA_TEXT);
        expect(wcagContrast(theme.inverseAction, theme.inverse)).toBeGreaterThanOrEqual(AA_TEXT);
    });
});

describe('photoChip keeps ink legible over the worst photo (§3.4)', () => {
    it('light: paper at 92% over a black photo', () => {
        expect(wcagContrast(role.ink, over(role.photoChip, '#000000'))).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it.each(['#000000', '#FFFFFF'])('dark: paperOverlay at 92% over %s', (photo) => {
        expect(wcagContrast(roleDark.ink, over(roleDark.photoChip, photo))).toBeGreaterThanOrEqual(AA_TEXT);
    });
});
