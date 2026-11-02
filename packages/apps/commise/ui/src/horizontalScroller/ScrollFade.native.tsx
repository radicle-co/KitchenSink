/**
 * @module @commise/ui/horizontal-scroller — the scroll hint's gradient fade, the one part Tamagui cannot draw yet:
 * `expo-linear-gradient` takes a React Native style, held here and nowhere else. This file must not import `tamagui` (a
 * file that does holds no React Native styling).
 *
 * @pattern Adapter — expo-linear-gradient behind a plain component
 */
import { LinearGradient } from 'expo-linear-gradient';
import type { FC } from 'react';

/** Props for {@link ScrollFade}. */
export interface ScrollFadeProps {
    /** The colour behind the scroller, which the fade ends in. */
    readonly ground: string;
    /** Whether the writing direction is right to left, which flips the gradient. */
    readonly rtl: boolean;
}

/** A gradient from transparent to the colour behind the scroller, filling the box it is placed in. */
export const ScrollFade: FC<ScrollFadeProps> = ({ ground, rtl }) => (
    <LinearGradient
        colors={[`${ground}00`, ground]}
        locations={[0, 1]}
        start={{ x: rtl ? 1 : 0, y: 0 }}
        end={{ x: rtl ? 0 : 1, y: 0 }}
        // NATIVE-STYLE-ADAPTER: expo-linear-gradient takes a React Native style and has no Tamagui path.
        style={{ flex: 1 }}
    />
);
