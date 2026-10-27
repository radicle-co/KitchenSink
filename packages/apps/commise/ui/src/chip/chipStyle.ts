/**
 * @module @commise/ui/chip — the native chip geometry and surfaces, shared by `Chip.native.tsx` and the options
 * `ChipRow.native.tsx` draws (spec §1.6/§1.10): a 32 pt pill inside a 44 pt hit area (48 dp on Android), its surface's chip fill (`surfaceMuted`; `paper` on a muted surface)
 * with a 1.5 pt transparent edge and an `ink` caption label (14/500) at rest, that fill's press while pressed, and when selected the
 * `selectedFill` tint, a 1.5 pt `selectedEdge` (2 pt while pressed) and an `actionText` label. A count keeps the semibold figure on both
 * platforms. The web leaves spell the same rules as utilities (`chipClass.ts`).
 */
import { Platform, type TextStyle, type ViewStyle } from 'react-native';

import { chipPressToneOf, SURFACE_TONES, type SurfaceTone } from '../surfaceTone/surfaceTone.js';
import type { Theme } from '../theme/themeFor.js';
import { nativeTokens } from '../tokens/native.js';

/** The chip's visual height, in points. */
const CHIP_HEIGHT = 32;

/** The chip's edge width, at rest AND selected: the same, so selecting one never shifts its neighbours. */
const CHIP_EDGE = 1.5;

/** The selected chip's edge while pressed or hovered: a thicker `selectedEdge`, its padding giving the difference back. */
const CHIP_EDGE_PRESSED = 2;

/** The most lines a chip's label takes before its ellipsis (`chipClass.ts`'s `CHIP_LABEL_CLASS`, the web twin). */
export const CHIP_LABEL_LINES = 2;

/** The hit area around the pill: 44 pt on iOS, 48 dp on Android (spec §1.6). */
export const chipHitHeight = (): number => (Platform.OS === 'android' ? 48 : 44);

/** The frame that carries the hit area. */
export const chipHit: ViewStyle = { justifyContent: 'center', maxWidth: '100%' };

/**
 * The pill for a chip's state, painted from the theme so it repaints in the dark scheme. Pure.
 *
 * @param theme - The current theme (`useTheme()`).
 * @param selected - Whether it shows selected.
 * @param pressed - Whether a press is in progress.
 * @param tone - The surface the chip rests on: it decides the resting fill and the press (`componentFixes.md` §10a).
 * @returns The pill's style.
 */
export function chipPill(
    { colors, press }: Theme,
    selected: boolean,
    pressed: boolean,
    tone: SurfaceTone = 'canvas',
): ViewStyle {
    return {
        flexDirection: 'row',
        alignItems: 'center',
        gap: nativeTokens.spacing[1],
        flexShrink: 1,
        minHeight: CHIP_HEIGHT,
        borderRadius: CHIP_HEIGHT / 2,
        paddingHorizontal: nativeTokens.spacing[3],
        ...(selected
            ? {
                  backgroundColor: colors.selectedFill,
                  borderColor: colors.selectedEdge,
                  // Pressed: a 2 pt edge (`componentFixes` §6), the extra half point taken from the padding so the box
                  // and the label stay where they were.
                  borderWidth: pressed ? CHIP_EDGE_PRESSED : CHIP_EDGE,
                  paddingHorizontal: nativeTokens.spacing[3] - (pressed ? CHIP_EDGE_PRESSED - CHIP_EDGE : 0),
              }
            : {
                  backgroundColor: pressed ? press[chipPressToneOf(tone)] : colors[SURFACE_TONES[tone].chipFill],
                  borderWidth: CHIP_EDGE,
                  borderColor: 'transparent',
              }),
    };
}

/**
 * The label for a chip's state. Pure.
 *
 * @param theme - The current theme (`useTheme()`).
 * @param selected - Whether it shows selected.
 * @returns The label's style.
 */
export function chipLabel({ colors }: Theme, selected: boolean): TextStyle {
    return { ...nativeTokens.type.caption, flexShrink: 1, color: selected ? colors.actionText : colors.ink };
}

/** A count after the label: tabular digits, `inkMuted`, from the theme. Pure. */
export function chipCount({ colors }: Theme): TextStyle {
    return { ...nativeTokens.type.label, fontVariant: ['tabular-nums', 'lining-nums'], color: colors.inkMuted };
}
