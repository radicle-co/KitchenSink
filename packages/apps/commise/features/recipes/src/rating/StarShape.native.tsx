/**
 * @module @commise/features-recipes/rating — one star pip, native leaf.
 *
 * The React Native peer of the web `StarShape`: a purely decorative glyph. Native draws the star as text
 * rather than SVG, so `size` is a font size rather than a utility class, but the CONTRACT is the web one —
 * `filled` selects between the score tone and the scale tone, and the pip carries no accessible name (the
 * enclosing `image`/`radio` does).
 */
import { palette } from '@commise/ui';
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
export const StarShape: FC<StarShapeProps> = ({ filled, size = 16 }) => (
    // An EMPTY pip states the readout's SCALE, so it is `slate`, not `mist` — see the palette JSDoc in
    // `@commise/ui`'s `tokens/colors.ts`. The U4 pass fixed the sibling `RecipeCard.native.tsx` and MISSED
    // this leaf, so both of its empty-pip styles were still the 1.9:1 hairline tone.
    <Text style={{ fontSize: size, color: filled ? palette.warning : palette.slate }}>★</Text>
);
