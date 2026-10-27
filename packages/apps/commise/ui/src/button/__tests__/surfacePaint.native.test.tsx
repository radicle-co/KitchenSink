/**
 * The native Button paint is exported so a control that wears the secondary pill (the "Screen on" switch) takes it from
 * the Button rather than copying it (`componentFixes` issue 6). The web twin is `buttonToggleSurfaceClass`.
 */
import { describe, expect, it } from 'vitest';

import { themeFor } from '../../theme/themeFor.js';
import { BUTTON_PILL_LAYOUT, buttonSurfacePaint, buttonToggleSurfacePaint, pressWash } from '../surfacePaint.native.js';

describe.each(['light', 'dark'] as const)('native button paint (%s)', (scheme) => {
    const theme = themeFor(scheme);

    it('secondary is paper with a 1 pt lineControl edge', () => {
        expect(buttonSurfacePaint(theme, 'secondary')).toEqual({
            backgroundColor: theme.colors.paper,
            borderWidth: 1,
            borderColor: theme.colors.lineControl,
        });
    });

    it('a switch that is off IS the secondary paint, key for key', () => {
        expect(buttonToggleSurfacePaint(theme, false)).toEqual(buttonSurfacePaint(theme, 'secondary'));
    });

    it('a switch that is on takes selectedFill and selectedEdge at the SAME edge width', () => {
        const on = buttonToggleSurfacePaint(theme, true);

        expect(on).toEqual({
            backgroundColor: theme.colors.selectedFill,
            borderWidth: buttonSurfacePaint(theme, 'secondary').borderWidth,
            borderColor: theme.colors.selectedEdge,
        });
    });

    // Pressing: off takes Button's pressed fill over paper (`theme.wash`, the twin of web `bg-surface-muted`); on shows a
    // 2 pt selectedEdge (`componentFixes` §5), its padding one point less so the box and content do not move.
    it('a switch that is off and pressed fills with the press wash, keeping the secondary edge', () => {
        expect(buttonToggleSurfacePaint(theme, false, true)).toEqual({
            ...buttonSurfacePaint(theme, 'secondary'),
            backgroundColor: theme.wash,
        });
    });

    it('a switch that is on and pressed doubles the selectedEdge and gives the point back in padding', () => {
        const pressed = buttonToggleSurfacePaint(theme, true, true);

        expect(pressed).toEqual({
            backgroundColor: theme.colors.selectedFill,
            borderWidth: 2,
            borderColor: theme.colors.selectedEdge,
            paddingVertical: Number(BUTTON_PILL_LAYOUT.paddingVertical) - 1,
            paddingHorizontal: Number(BUTTON_PILL_LAYOUT.paddingHorizontal) - 1,
        });
    });

    it('is not pressed unless told so', () => {
        expect(buttonToggleSurfacePaint(theme, true)).toEqual(buttonToggleSurfacePaint(theme, true, false));
        expect(buttonToggleSurfacePaint(theme, false)).toEqual(buttonToggleSurfacePaint(theme, false, false));
    });
});

// Parity item 4: the press fill is ONE rule (`pressWash`) that Button and the Screen on switch both read.
describe.each(['light', 'dark'] as const)('the native press fill (%s)', (scheme) => {
    const theme = themeFor(scheme);

    it('is the theme wash over paper and lineDivider over a muted parent', () => {
        expect(pressWash(theme, 'paper')).toBe(theme.wash);
        expect(pressWash(theme, 'muted')).toBe(theme.colors.lineDivider);
        expect(pressWash(theme, 'muted')).not.toBe(theme.colors.surfaceMuted);
    });

    it.each(['secondary', 'ghost', 'quiet', 'destructiveInline'] as const)(
        '%s fills with it while pressed',
        (surface) => {
            expect(buttonSurfacePaint(theme, surface, true).backgroundColor).toBe(theme.wash);
            expect(buttonSurfacePaint(theme, surface, true, 'muted').backgroundColor).toBe(theme.colors.lineDivider);
        },
    );

    it('leaves the resting paint alone, pressed or not asked', () => {
        expect(buttonSurfacePaint(theme, 'quiet')).toEqual({ backgroundColor: 'transparent', borderWidth: 0 });
        expect(buttonSurfacePaint(theme, 'quiet', false, 'muted')).toEqual(buttonSurfacePaint(theme, 'quiet'));
    });

    it('presses primary to actionPressed and keeps confirm as it is', () => {
        expect(buttonSurfacePaint(theme, 'primary', true).backgroundColor).toBe(theme.colors.actionPressed);
        expect(buttonSurfacePaint(theme, 'destructiveConfirm', true)).toEqual(
            buttonSurfacePaint(theme, 'destructiveConfirm'),
        );
    });

    it('the Screen on switch presses with the same rule', () => {
        expect(buttonToggleSurfacePaint(theme, false, true).backgroundColor).toBe(pressWash(theme, 'paper'));
    });
});
