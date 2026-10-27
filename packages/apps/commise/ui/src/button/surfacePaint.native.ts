/**
 * @module @commise/ui/button — the native paint of the Button's surfaces, exported so a control that WEARS a Button
 * surface (the "Screen on" switch) takes it from here instead of copying it. The web twin is `surfaceClass.ts`
 * (`buttonSurfaceClass`, `buttonToggleSurfaceClass`); the two change for different reasons and are not merged.
 *
 * Built from a theme at render: a colour in a static sheet would be baked into one theme at import (D15).
 *
 * @pattern Policy — pure decisions of which paint a surface wears
 */
import type { ViewStyle } from 'react-native';

import type { SurfaceTone } from '../surfaceTone/surfaceTone.js';
import type { Theme } from '../theme/themeFor.js';
import { nativeTokens } from '../tokens/native.js';

/**
 * The layout every Button pill shares: a centred row, a glyph-label gap, and the web base step's 12 pt inline padding
 * (`surfaceClass.ts` `px-3`; at 24 dp a row of three actions overflowed a 320 dp phone and clipped the primary). A
 * control that wears a Button surface spreads this, so the two cannot drift.
 */
export const BUTTON_PILL_LAYOUT: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: nativeTokens.spacing[2],
    paddingVertical: nativeTokens.spacing[2],
    paddingHorizontal: nativeTokens.spacing[3],
};

/** The flat surfaces a native Button paints. */
export type ButtonSurface = 'primary' | 'secondary' | 'ghost' | 'quiet' | 'destructiveInline' | 'destructiveConfirm';

/**
 * The press fill of a neutral surface: THE rule for a native press, read by Button and by the Screen on switch (the twin
 * of the web `PRESS_FILL_CLASS`). It is the press of the surface the control sits on (`surfaceTone.ts`): that surface with
 * the theme's ink laid over it, so it shows on paper, on a sheet and on a muted card alike. It is painted whether or not
 * the OS asks for reduced motion: motion is non-essential, a response to the touch is not. Pure.
 *
 * @param theme - The theme to paint in.
 * @param tone - The surface the control sits on.
 */
export function pressWash(theme: Theme, tone: SurfaceTone): string {
    return theme.press[tone];
}

/**
 * A surface's paint in the current theme. While pressed, a neutral surface fills with {@link pressWash} (the press of its surface) and `primary`
 * darkens to `actionPressed` (the web `hover:bg-action-pressed` twin) and a confirm to `dangerPressed` (the web
 * `hover:bg-danger-pressed` twin). Pure.
 *
 * @param theme - The theme to paint in.
 * @param surface - The surface.
 * @param pressed - Whether a press is in progress. Defaults to false.
 * @param tone - The surface the control sits on. Defaults to the canvas.
 */
export function buttonSurfacePaint(
    theme: Theme,
    surface: ButtonSurface,
    pressed = false,
    tone: SurfaceTone = 'canvas',
): ViewStyle {
    const { colors } = theme;

    switch (surface) {
        case 'primary':
            return { backgroundColor: pressed ? colors.actionPressed : colors.action, borderWidth: 0 };
        case 'secondary':
        case 'destructiveInline':
            return {
                backgroundColor: pressed ? pressWash(theme, tone) : colors.paper,
                borderWidth: 1,
                borderColor: colors.lineControl,
            };
        case 'ghost':
        case 'quiet':
            return { backgroundColor: pressed ? pressWash(theme, tone) : 'transparent', borderWidth: 0 };
        case 'destructiveConfirm':
            return { backgroundColor: pressed ? colors.dangerPressed : colors.danger, borderWidth: 0 };
    }
}

/**
 * The paint of a SWITCH that wears the secondary button (`componentFixes` issue 6): unselected it IS the secondary paint;
 * selected it takes `selectedFill` and `selectedEdge` at the SAME edge width, so turning it on moves nothing around it.
 * While pressed, an unselected switch takes the press fill of its surface ({@link pressWash}, the twin of the web press)
 * and a selected one shows a 2 pt `selectedEdge` (`componentFixes` §5), its padding one point less so the box and the
 * content stay put. Pure.
 *
 * @param theme - The theme to paint in.
 * @param selected - Whether the switch is on.
 * @param pressed - Whether a press is in progress. Defaults to false.
 * @param tone - The surface the switch sits on. Defaults to the canvas.
 */
export function buttonToggleSurfacePaint(
    theme: Theme,
    selected: boolean,
    pressed = false,
    tone: SurfaceTone = 'canvas',
): ViewStyle {
    const secondary = buttonSurfacePaint(theme, 'secondary');

    if (!selected) {
        return pressed ? { ...secondary, backgroundColor: pressWash(theme, tone) } : secondary;
    }

    const on: ViewStyle = {
        ...secondary,
        backgroundColor: theme.colors.selectedFill,
        borderColor: theme.colors.selectedEdge,
    };

    return pressed
        ? {
              ...on,
              borderWidth: 2,
              paddingVertical: Number(BUTTON_PILL_LAYOUT.paddingVertical) - 1,
              paddingHorizontal: Number(BUTTON_PILL_LAYOUT.paddingHorizontal) - 1,
          }
        : on;
}
