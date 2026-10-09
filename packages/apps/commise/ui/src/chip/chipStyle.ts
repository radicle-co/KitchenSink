/**
 * @module @commise/ui/chip — the native chip geometry and surfaces, shared by `Chip.native.tsx` and the options
 * `ChipRow.native.tsx` draws (spec §1.6/§1.10): a 36 pt pill inside a 44 pt hit area (48 dp on Android), `paper` with a
 * 1 pt `lineControl` edge and an `ink` label at rest, `pearl` while pressed, and when selected the `selectedFill` tint,
 * a 1.5 pt `selectedEdge` and an `actionText` label. The web leaves spell the same rules as utilities (`chipClass.ts`).
 */
import { Platform, type TextStyle, type ViewStyle } from 'react-native';

import type { Theme } from '../theme/themeFor.js';
import { nativeTokens } from '../tokens/native.js';

/** The chip's visual height, in points. */
const CHIP_HEIGHT = 36;

/** The hit area around the pill: 44 pt on iOS, 48 dp on Android (spec §1.6). */
export const chipHitHeight = (): number => (Platform.OS === 'android' ? 48 : 44);

/** The frame that carries the hit area. */
export const chipHit: ViewStyle = { justifyContent: 'center' };

/**
 * The pill for a chip's state, painted from the theme so it repaints in the dark scheme. Pure.
 *
 * @param theme - The current theme (`useTheme()`).
 * @param selected - Whether it shows selected.
 * @param pressed - Whether a press is in progress.
 * @returns The pill's style.
 */
export function chipPill({ colors, wash }: Theme, selected: boolean, pressed: boolean): ViewStyle {
    return {
        flexDirection: 'row',
        alignItems: 'center',
        gap: nativeTokens.spacing[1],
        minHeight: CHIP_HEIGHT,
        borderRadius: CHIP_HEIGHT / 2,
        paddingHorizontal: nativeTokens.spacing[3],
        ...(selected
            ? { backgroundColor: colors.selectedFill, borderWidth: 1.5, borderColor: colors.selectedEdge }
            : { backgroundColor: pressed ? wash : colors.paper, borderWidth: 1, borderColor: colors.lineControl }),
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
    return { ...nativeTokens.type.label, color: selected ? colors.actionText : colors.ink };
}

/** A count after the label: tabular digits, `inkMuted`, from the theme. Pure. */
export function chipCount({ colors }: Theme): TextStyle {
    return { ...nativeTokens.type.label, fontVariant: ['tabular-nums', 'lining-nums'], color: colors.inkMuted };
}
