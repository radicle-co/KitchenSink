/**
 * The native recipe page's LOADING state (D3; `buildSpec.md` §6.7): the caption, spoken politely and shown, over inert
 * placeholder blocks that keep the page's geometry and stay out of the accessibility tree.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { RecipeDetailSkeleton } from '../RecipeDetailSkeleton.native.js';

afterEach(cleanup);

describe('RecipeDetailSkeleton (native)', () => {
    it('shows what is loading as a caption, announced politely', () => {
        render(<RecipeDetailSkeleton label="Loading recipe…" />);

        expect(screen.getByText('Loading recipe…')).toBeTruthy();
        expect(screen.getAllByText('Loading recipe…')).toHaveLength(1);
    });

    it('keeps every placeholder block out of the accessibility tree, and the caption in it', () => {
        const { container } = render(<RecipeDetailSkeleton label="Loading recipe…" />);
        const hidden = container.querySelector('[aria-hidden="true"]') as HTMLElement;

        // Blocks are the leaf views: a view with a fill and no children.
        const blocks = Array.from(hidden.querySelectorAll('div')).filter((node) => node.childElementCount === 0);

        expect(blocks.length).toBeGreaterThanOrEqual(6);
        expect(hidden.contains(screen.getByText('Loading recipe…'))).toBe(false);
    });

    it('draws the hero first, at 4:3', () => {
        const { container } = render(<RecipeDetailSkeleton label="Loading recipe…" />);
        const hidden = container.querySelector('[aria-hidden="true"]') as HTMLElement;
        const hero = hidden.firstElementChild as HTMLElement;

        expect(Number.parseFloat(getComputedStyle(hero).aspectRatio)).toBeCloseTo(4 / 3, 2);
    });
});
