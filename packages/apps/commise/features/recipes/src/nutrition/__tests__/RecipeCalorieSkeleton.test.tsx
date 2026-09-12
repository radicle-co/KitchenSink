// @vitest-environment jsdom
/**
 * Component tests for the web calorie skeleton — the Suspense fallback that stands in for the chip while the
 * deferred lookup is in flight.
 *
 * It carries the same two invariants as `RecipeCardGridSkeleton`, for the same reasons: a live region
 * announces its CONTENT (not its label), so an empty `role="status"` is silent; and the shimmer itself is
 * decorative, so it is `aria-hidden` and honours `prefers-reduced-motion`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { RecipeCalorieSkeleton } from '../RecipeCalorieSkeleton.js';

afterEach(cleanup);

describe('RecipeCalorieSkeleton (web)', () => {
    it('⛔ is NOT a live region — one per card would announce N times and never announce the answer', () => {
        // REWRITTEN, not deleted. This previously asserted `role="status"`, and that was the wrong
        // granularity rather than a wrong implementation. A grid renders one skeleton PER CARD, so a
        // per-card live region announces "loading calories" once for every card on entry — twenty times
        // for twenty cards — while the thing a reader actually wants announced, the figure ARRIVING, is
        // never announced at all, because the chip that replaces this is a `role="img"` and not a live
        // region. Noise where it does not help, silence where it would.
        //
        // The grid-level `RecipeCardGridSkeleton` already carries the ONE `role="status"` for "recipes are
        // loading". This leaf is a per-item placeholder underneath that, so it stays discoverable on
        // navigation via real visually-hidden text and announces nothing.
        render(<RecipeCalorieSkeleton label="Loading calories" />);

        expect(screen.queryByRole('status')).toBeNull();
    });

    it('keeps its localized state discoverable as real text, so navigation still reveals it', () => {
        // Text CONTENT rather than `aria-label`: the wrapper has no role, and ARIA prohibits naming a
        // generic element — the same defect the chip carried in its first cut, where an `aria-label` on a
        // bare span silently dropped the stale caveat while `getByLabelText` still passed because it reads
        // the attribute rather than the computed name.
        render(<RecipeCalorieSkeleton label="Loading calories" />);

        expect(screen.getByText('Loading calories')).toBeTruthy();
    });

    it('hides the shimmer from assistive tech and suppresses its animation under reduced motion', () => {
        const { container } = render(<RecipeCalorieSkeleton label="Loading calories" />);
        const shimmer = container.querySelector('[aria-hidden="true"]');

        expect(shimmer, 'the skeleton paints a decorative shimmer').not.toBeNull();
        expect(shimmer?.className).toContain('animate-pulse');
        expect(shimmer?.className).toContain('motion-reduce:animate-none');
    });

    // The chip replaces this in place inside the card's meta row; a fallback of a different height or a
    // different flow reflows the whole card when the figure lands.
    it('reserves the chip’s inline footprint so nothing reflows when the figure lands', () => {
        const { container } = render(<RecipeCalorieSkeleton label="Loading calories" />);
        const shimmer = container.querySelector('[aria-hidden="true"]');

        expect(shimmer?.className).toContain('inline-block');
        expect(shimmer?.className).toMatch(/\bh-4\b/);
        expect(shimmer?.className).toMatch(/\bw-\d/);
    });
});
