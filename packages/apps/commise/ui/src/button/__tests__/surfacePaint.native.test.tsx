/**
 * The native Button paint is exported so a control that wears the secondary pill (the "Screen on" switch) takes it from
 * the Button rather than copying it (`componentFixes` issue 6). The web twin is `buttonToggleSurfaceClass`.
 */
import { describe, expect, it } from 'vitest';

import { themeFor } from '../../theme/themeFor.js';
import { buttonSurfacePaint, buttonToggleSurfacePaint } from '../surfacePaint.native.js';

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
});
