// @vitest-environment jsdom
/**
 * Component tests for the web discovery LOADING body — what the discovery suspense boundary renders while a search with
 * nothing to show yet is pending. Moved from the retired `RecipeDiscoveryList.test.tsx` ("loading state").
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { COMPACT_GRID_CLASS, LIBRARY_GRID_CLASS } from '../../card/cardGridClass.js';
import { RecipeDiscoveryLoading } from '../RecipeDiscoveryLoading.js';

afterEach(cleanup);

describe('RecipeDiscoveryLoading (web)', () => {
    it('shows a busy status with no recipe rows', () => {
        render(<RecipeDiscoveryLoading />);

        expect(screen.getByRole('status', { name: 'Loading recipes' })).toBeTruthy();
        expect(screen.queryByRole('button')).toBeNull();
    });

    it('announces the localized loading label as the live region CONTENT, not only its aria-label', () => {
        render(<RecipeDiscoveryLoading />);

        // A `role="status"` node rendered EMPTY is zero-height (Playwright resolves it as hidden) AND silent, because a
        // live region announces its content, not its label.
        expect(screen.getByRole('status').textContent).toContain('Loading recipes');
    });

    it('renders shimmer skeleton cards, every one decorative, inside the busy region', () => {
        render(<RecipeDiscoveryLoading />);

        const shimmer = screen.getByRole('status').querySelectorAll('.animate-pulse');
        expect(shimmer.length).toBeGreaterThanOrEqual(3);

        for (const node of Array.from(shimmer)) {
            expect(node.closest('[aria-hidden="true"]')).not.toBeNull();
        }
    });

    // Rewritten (sev-1 in `evaluateFinal.md`): the skeleton drew one full-width card at 390 while results drew two
    // compact cards per row. It now takes the results' own variant and sits in the grid they draw.
    it.each([
        ['compact', COMPACT_GRID_CLASS],
        ['grid', LIBRARY_GRID_CLASS],
    ] as const)('sits %s skeletons in the grid the results draw, so nothing jumps when they land', (variant, grid) => {
        render(<RecipeDiscoveryLoading variant={variant} />);

        expect(screen.getByRole('status').querySelector('.grid')?.className).toBe(grid);
    });
});
