/**
 * The native Button paint is exported so a control that wears the secondary pill (the "Screen on" switch) takes it from
 * the Button rather than copying it (`componentFixes` issue 6). The web twin is `buttonToggleSurfaceClass`.
 */
import { describe, expect, it } from 'vitest';

import { SURFACE_TONES } from '../../surfaceTone/surfaceTone.js';
import { themeFor } from '../../theme/themeFor.js';
import { BUTTON_PILL_LAYOUT, buttonSurfacePaint, buttonToggleSurfacePaint, pressWash } from '../surfacePaint.native.js';

describe.each(['light', 'dark'] as const)('native button paint (%s)', (scheme) => {
    const theme = themeFor(scheme);

    it('secondary is paper with a 1 pt lineControl edge', () => {
        expect(buttonSurfacePaint(theme, 'secondary', 'canvas')).toEqual({
            backgroundColor: theme.colors.paper,
            borderWidth: 1,
            borderColor: theme.colors.lineControl,
        });
    });

    it('a switch that is off IS the secondary paint, key for key', () => {
        expect(buttonToggleSurfacePaint(theme, false, 'canvas')).toEqual(
            buttonSurfacePaint(theme, 'secondary', 'canvas'),
        );
    });

    it('a switch that is on takes selectedFill and selectedEdge at the SAME edge width', () => {
        const on = buttonToggleSurfacePaint(theme, true, 'canvas');

        expect(on).toEqual({
            backgroundColor: theme.colors.selectedFill,
            borderWidth: buttonSurfacePaint(theme, 'secondary', 'canvas').borderWidth,
            borderColor: theme.colors.selectedEdge,
        });
    });

    // Pressing: off takes Button's pressed fill over paper (the press of its surface, the twin of the web press); on shows a
    // 2 pt selectedEdge (`componentFixes` §5), its padding one point less so the box and content do not move.
    it('a switch that is off and pressed fills with its surface’s press, keeping the secondary edge', () => {
        expect(buttonToggleSurfacePaint(theme, false, 'canvas', true)).toEqual({
            ...buttonSurfacePaint(theme, 'secondary', 'canvas'),
            backgroundColor: theme.press.canvas,
        });
        expect(buttonToggleSurfacePaint(theme, false, 'muted', true).backgroundColor).toBe(theme.press.muted);
    });

    it('a switch that is on and pressed doubles the selectedEdge and gives the point back in padding', () => {
        const pressed = buttonToggleSurfacePaint(theme, true, 'canvas', true);

        expect(pressed).toEqual({
            backgroundColor: theme.colors.selectedFill,
            borderWidth: 2,
            borderColor: theme.colors.selectedEdge,
            paddingVertical: Number(BUTTON_PILL_LAYOUT.paddingVertical) - 1,
            paddingHorizontal: Number(BUTTON_PILL_LAYOUT.paddingHorizontal) - 1,
        });
    });

    it('is not pressed unless told so', () => {
        expect(buttonToggleSurfacePaint(theme, true, 'canvas')).toEqual(
            buttonToggleSurfacePaint(theme, true, 'canvas', false),
        );
        expect(buttonToggleSurfacePaint(theme, false, 'canvas')).toEqual(
            buttonToggleSurfacePaint(theme, false, 'canvas', false),
        );
    });
});

// Parity item 4: the press fill is ONE rule (`pressWash`) that Button and the Screen on switch both read.
describe.each(['light', 'dark'] as const)('the native press fill (%s)', (scheme) => {
    const theme = themeFor(scheme);

    it('is the press of the surface the control sits on, and never the surface’s own fill', () => {
        for (const tone of ['canvas', 'paper', 'paperOverlay', 'muted'] as const) {
            expect(pressWash(theme, tone)).toBe(theme.press[tone]);
            expect(pressWash(theme, tone)).not.toBe(theme.colors[SURFACE_TONES[tone].fill]);
        }
    });

    it.each(['secondary', 'ghost', 'quiet', 'destructiveInline'] as const)(
        '%s fills with it while pressed',
        (surface) => {
            expect(buttonSurfacePaint(theme, surface, 'canvas', true).backgroundColor).toBe(theme.press.canvas);
            expect(buttonSurfacePaint(theme, surface, 'muted', true).backgroundColor).toBe(theme.press.muted);
        },
    );

    it('leaves the resting paint alone, pressed or not asked', () => {
        expect(buttonSurfacePaint(theme, 'quiet', 'canvas')).toEqual({
            backgroundColor: 'transparent',
            borderWidth: 0,
        });
        expect(buttonSurfacePaint(theme, 'quiet', 'muted', false)).toEqual(
            buttonSurfacePaint(theme, 'quiet', 'canvas'),
        );
    });

    // Rewritten: the confirm used to keep its fill on press (no native role for web's `danger/90`). dangerPressed is that role.
    it('presses primary to actionPressed and confirm to dangerPressed', () => {
        expect(buttonSurfacePaint(theme, 'primary', 'canvas', true).backgroundColor).toBe(theme.colors.actionPressed);
        expect(buttonSurfacePaint(theme, 'destructiveConfirm', 'canvas').backgroundColor).toBe(theme.colors.danger);
        expect(buttonSurfacePaint(theme, 'destructiveConfirm', 'canvas', true)).toEqual({
            backgroundColor: theme.colors.dangerPressed,
            borderWidth: 0,
        });
        expect(theme.colors.dangerPressed).not.toBe(theme.colors.danger);
    });

    it('the Screen on switch presses with the same rule', () => {
        for (const tone of ['canvas', 'paper', 'paperOverlay', 'muted'] as const) {
            expect(buttonToggleSurfacePaint(theme, false, tone, true).backgroundColor).toBe(pressWash(theme, tone));
        }
    });
});
