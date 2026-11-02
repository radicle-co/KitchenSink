/**
 * @module @commise/features-recipes/rating — one star pip, native leaf.
 *
 * The React Native peer of the web `StarShape`: a purely decorative glyph. It is the design system's `star` icon, so it
 * does not grow with the system text scale (a glyph drawn as text would, and on iOS without a cap); `size` is the
 * glyph's side in points. The CONTRACT is the web one: `filled` selects between the score tone and the scale tone,
 * and the pip carries no accessible name (the enclosing `image`/`radio` does).
 */
import { Icon, type IconSize } from '@commise/ui/icon';
import type { FC } from 'react';

/** Props for {@link StarShape}. */
export interface StarShapeProps {
    /** Whether the pip is filled (part of the score) or empty (part of the scale). */
    readonly filled: boolean;
    /** Glyph side in points; defaults to the small readout size. */
    readonly size?: IconSize;
}

/**
 * One star pip.
 *
 * @param props - Fill state and optional glyph size.
 * @returns The decorative star glyph.
 */
export const StarShape: FC<StarShapeProps> = ({ filled, size = 16 }) => (
    // A FILLED pip is the `rating` role (the spec's star tone, a graphic and never text). An EMPTY pip states the readout's
    // SCALE, so it is `inkMuted`, not the divider tone — see the palette JSDoc in `@commise/ui`'s `tokens/colors.ts`.
    <Icon name="star" size={size} tone={filled ? 'rating' : 'inkMuted'} filled={filled} />
);
