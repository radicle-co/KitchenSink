// @vitest-environment jsdom
/**
 * The web recipe page's LOADING state (D3; `buildSpec.md` §6.7 "hero at its real ratio, title, stat and row skeletons. No
 * layout shift"). It replaced a line of text that said "Loading recipe" at the top of an empty page, so the page jumped
 * when the recipe landed. One polite status carries the name; every block is decorative and keeps the real geometry.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { RecipeDetailSkeleton } from '../RecipeDetailSkeleton.js';

afterEach(cleanup);

describe('RecipeDetailSkeleton (web)', () => {
    it('is ONE polite status, named, whose content is the name — a live region announces content, not a label', () => {
        render(<RecipeDetailSkeleton label="Loading recipe" />);

        const status = screen.getByRole('status', { name: 'Loading recipe' });

        expect(screen.getAllByRole('status')).toHaveLength(1);
        expect(status.textContent).toContain('Loading recipe');
    });

    it('keeps its blocks out of the accessibility tree', () => {
        const { container } = render(<RecipeDetailSkeleton label="Loading recipe" />);
        const blocks = container.querySelectorAll('.animate-pulse');

        expect(blocks.length).toBeGreaterThanOrEqual(6);

        for (const block of blocks) {
            expect(block.closest('[aria-hidden="true"]')).not.toBeNull();
        }
    });

    it('draws the hero at the carousel’s 4:3, so the photo does not move the page when it lands', () => {
        const { container } = render(<RecipeDetailSkeleton label="Loading recipe" />);

        expect(container.querySelector('.aspect-\\[4\\/3\\]')).not.toBeNull();
    });

    it('lays out in the page’s own container, so its widths are the page’s widths', () => {
        const { container } = render(<RecipeDetailSkeleton label="Loading recipe" />);
        const root = container.firstElementChild as HTMLElement;

        expect(root.className.split(' ')).toEqual(
            expect.arrayContaining(['@container/detail', 'w-full', 'max-w-detail']),
        );
    });

    it('does not pulse for a reader who asked for less motion', () => {
        const { container } = render(<RecipeDetailSkeleton label="Loading recipe" />);

        for (const block of container.querySelectorAll('.animate-pulse')) {
            expect(block.className.split(' ')).toContain('motion-reduce:animate-none');
        }
    });
});
