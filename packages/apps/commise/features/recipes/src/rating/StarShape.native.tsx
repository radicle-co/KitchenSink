/**
 * @module @commise/features-recipes/rating — one star pip, native leaf.
 *
 * The React Native peer of the web `StarShape`: a purely decorative glyph. Native draws the star as text
 * rather than SVG, so `size` is a font size rather than a utility class, but the CONTRACT is the web one —
 * `filled` selects between the score tone and the scale tone, and the pip carries no accessible name (the
 * enclosing `image`/`radio` does).
 */
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { Text } from 'react-native';

/** Props for {@link StarShape}. */
export interface StarShapeProps {
    /** Whether the pip is filled (part of the score) or empty (part of the scale). */
    readonly filled: boolean;
    /** Glyph font size; defaults to the small readout size. */
    readonly size?: number;
}

/**
 * One star pip.
 *
 * @param props - Fill state and optional glyph size.
 * @returns The decorative star glyph.
 */
export const StarShape: FC<StarShapeProps> = ({ filled, size = 16 }) => {
    const { colors } = useTheme();

    // A FILLED pip is the `rating` role (the spec's star tone, a graphic and never text). An EMPTY pip states the
    // readout's SCALE, so it is `inkMuted`, not the divider tone — see the palette JSDoc in `@commise/ui`'s
    // `tokens/colors.ts`.
    return <Text style={{ fontSize: size, color: filled ? colors.rating : colors.inkMuted }}>★</Text>;
};
