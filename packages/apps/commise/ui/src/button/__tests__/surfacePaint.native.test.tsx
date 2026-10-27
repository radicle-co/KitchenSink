/**
 * The native Button paint is exported so a control that wears the secondary pill (the "Screen on" switch) takes it from
 * the Button rather than copying it (`componentFixes` issue 6). The web twin is `buttonToggleSurfaceClass`.
 */
import { describe, expect, it } from 'vitest';

import { themeFor } from '../../theme/themeFor.js';
import { BUTTON_PILL_LAYOUT, buttonSurfacePaint, buttonToggleSurfacePaint } from '../surfacePaint.native.js';

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
