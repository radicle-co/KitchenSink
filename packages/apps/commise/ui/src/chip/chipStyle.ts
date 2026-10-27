/**
 * @module @commise/ui/chip — the native chip geometry and surfaces, shared by `Chip.native.tsx` and the options
 * `ChipRow.native.tsx` draws (spec §1.6/§1.10): a 32 pt pill inside a 44 pt hit area (48 dp on Android), `surfaceMuted`
 * with a 1.5 pt transparent edge and an `ink` caption label (14/500) at rest, `lineDivider` while pressed, and when selected the
 * `selectedFill` tint, a 1.5 pt `selectedEdge` and an `actionText` label. A count keeps the semibold figure on both
 * platforms. The web leaves spell the same rules as utilities (`chipClass.ts`).
 */
import { Platform, type TextStyle, type ViewStyle } from 'react-native';

import type { Theme } from '../theme/themeFor.js';
import { nativeTokens } from '../tokens/native.js';

/** The chip's visual height, in points. */
const CHIP_HEIGHT = 32;

/** The chip's edge width, at rest AND selected: the same, so selecting one never shifts its neighbours. */
const CHIP_EDGE = 1.5;

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
 * @returns The pill's style.
 */
export function chipPill({ colors }: Theme, selected: boolean, pressed: boolean): ViewStyle {
    return {
        flexDirection: 'row',
        alignItems: 'center',
        gap: nativeTokens.spacing[1],
        flexShrink: 1,
        minHeight: CHIP_HEIGHT,
        borderRadius: CHIP_HEIGHT / 2,
        paddingHorizontal: nativeTokens.spacing[3],
        ...(selected
            ? { backgroundColor: colors.selectedFill, borderWidth: CHIP_EDGE, borderColor: colors.selectedEdge }
            : {
                  backgroundColor: pressed ? colors.lineDivider : colors.surfaceMuted,
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
