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

    // Slice 4 (`buildSpec.md` §4.1 "Skeleton: the same rows at the same sizes in pearl. It stops pulsing after 1 s."):
    // the skeleton draws the variant the loaded cards will use, in the same grid, so nothing moves when they land.
    it('pulses once, for one second, in the surface-muted role', () => {
        const { container } = render(<RecipeCardGridSkeleton label="Loading recipes" />);

        for (const pulse of container.querySelectorAll('.animate-pulse')) {
            expect(pulse.className).toContain('[animation-iteration-count:1]');
            expect(pulse.className).toContain('[animation-duration:1s]');
            expect(pulse.className).toContain('bg-surface-muted');
        }
    });

    it.each([
        ['grid', 6],
        ['row', 3],
        ['compact', 2],
    ] as const)('draws a %s skeleton with the rows of that variant (%i bars and covers)', (variant, parts) => {
        const { container } = render(<RecipeCardGridSkeleton label="Loading recipes" variant={variant} />);
        const first = container.querySelector('[aria-hidden="true"]')?.children[0];

        expect(first?.getAttribute('data-skeleton-variant')).toBe(variant);
        expect(first?.querySelectorAll('.animate-pulse')).toHaveLength(parts);
    });

    it('lays a library grid skeleton out as subgrid cells, a list as one column, and Home as its fixed grid', () => {
        const grid = render(<RecipeCardGridSkeleton label="L" variant="grid" />).container;
        expect(grid.querySelector('[aria-hidden="true"]')?.className).toContain('minmax(15rem,1fr)');
        expect(grid.querySelector('[data-skeleton-variant]')?.className).toContain('grid-rows-subgrid');
        cleanup();

        const list = render(<RecipeCardGridSkeleton label="L" variant="row" />).container;
        expect(list.querySelector('[aria-hidden="true"]')?.className).toContain('flex-col');
        cleanup();

        const home = render(<RecipeCardGridSkeleton label="L" variant="compact" layout="home" count={4} />).container;
        expect(home.querySelector('[aria-hidden="true"]')?.className).toContain('grid-cols-2');
        expect(home.querySelector('[aria-hidden="true"]')?.children).toHaveLength(4);
    });
});
