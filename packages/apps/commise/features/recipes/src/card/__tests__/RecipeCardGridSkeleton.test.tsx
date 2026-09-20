// @vitest-environment jsdom
/**
 * Component tests for the ONE authoritative web recipe-card-grid skeleton, pinning the two invariants its
 * docblock names as former live defects: the live region carries its label as CONTENT (an empty
 * `role="status"` is both silent and zero-height), and the placeholder cards are decorative and
 * reduced-motion-safe.
 *
 * The component had no test of its own — it was covered only incidentally through `RecipeList` /
 * `RecipeDiscoveryList`, which is how its missing `.native` counterpart went unnoticed.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { RecipeCardGridSkeleton } from '../RecipeCardGridSkeleton.js';
import { RECIPE_CARD_SKELETON_COUNT } from '../model.js';

afterEach(cleanup);

describe('RecipeCardGridSkeleton (web)', () => {
    it('announces the wait through a live region whose CONTENT is the localized label', () => {
        render(<RecipeCardGridSkeleton label="Loading recipes" />);
        const status = screen.getByRole('status');

        expect(status.textContent).toContain('Loading recipes');
        expect(screen.getByText('Loading recipes')).toBeTruthy();
    });

    it('paints the default number of placeholder cards, and honours an explicit count', () => {
        const { container } = render(<RecipeCardGridSkeleton label="Loading recipes" />);
        const grid = container.querySelector('[aria-hidden="true"]');

        expect(grid?.children.length).toBe(RECIPE_CARD_SKELETON_COUNT);
        cleanup();

        const { container: three } = render(<RecipeCardGridSkeleton label="Loading recipes" count={3} />);
        expect(three.querySelector('[aria-hidden="true"]')?.children.length).toBe(3);
    });

    it('keeps the shimmer cards decorative and suppresses their animation under reduced motion', () => {
        const { container } = render(<RecipeCardGridSkeleton label="Loading recipes" />);
        const grid = container.querySelector('[aria-hidden="true"]');
        const pulses = container.querySelectorAll('.animate-pulse');

        expect(grid, 'the placeholder grid is hidden from assistive tech').not.toBeNull();
        expect(pulses.length).toBeGreaterThan(0);

        for (const pulse of pulses) {
            expect(pulse.className).toContain('motion-reduce:animate-none');
        }
    });
});
