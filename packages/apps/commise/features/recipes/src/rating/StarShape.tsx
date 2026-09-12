/**
 * @module @commise/features-recipes/rating — one star pip, web leaf.
 *
 * A purely decorative inline SVG (`aria-hidden`): the accessible name of a rating readout is carried by the
 * enclosing `role="img"` label or the radio's own label, never by the pips. Shared by the community aggregate
 * (small) and the rate radiogroup (large) so a filled star means the same thing in both.
 */
import type { FC } from 'react';

const STAR_PATH =
    'M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z';

/** Props for {@link StarShape}. */
export interface StarShapeProps {
    /** Whether the pip is filled (part of the score) or empty (part of the scale). */
    readonly filled: boolean;
    /** Tailwind size utilities; defaults to the small readout size. */
    readonly size?: string;
}

/**
 * One star pip.
 *
 * @param props - Fill state and optional size utilities.
 * @returns The decorative star SVG.
 */
export const StarShape: FC<StarShapeProps> = ({ filled, size = 'h-5 w-5' }) => (
    <svg
        aria-hidden="true"
        // An EMPTY pip states the readout's SCALE, so it is `slate`, not `mist` — see the palette JSDoc in
        // `@commise/ui`'s `tokens/colors.ts`, which is the one authoritative statement of that rule. The native
        // sibling (`RecipeCard.native.tsx`) already carries it.
        className={`${size} ${filled ? 'fill-warning text-warning' : 'text-slate'}`}
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        viewBox="0 0 20 20"
    >
        <path d={STAR_PATH} />
    </svg>
);
