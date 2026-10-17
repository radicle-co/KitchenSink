/**
 * The native version history's LOADING state (D3; `buildSpec.md` §6.6 "Loading: 3 skeleton rows"): the settled list's
 * title, a polite caption, and three inert rows. The way back is the SCREEN's (it sits above the read boundary in every
 * state), and so is the failed state, which is already an alert with a Try again button.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { RecipeVersionListSkeleton } from '../RecipeVersionListSkeleton.native.js';
import { recipeVersionMessages } from '../messages.js';

const { versionList } = recipeVersionMessages.en;

afterEach(cleanup);

describe('RecipeVersionListSkeleton (native)', () => {
    it('keeps the settled list’s title, so nothing moves when the history lands', () => {
        render(<RecipeVersionListSkeleton label="Loading version history…" />);

        expect(screen.getByRole('heading', { name: versionList.heading })).toBeTruthy();
    });

    it('draws a Back in the header only when it is given one', () => {
        const { rerender } = render(<RecipeVersionListSkeleton label="Loading version history…" />);
        expect(screen.queryByRole('button', { name: versionList.backToRecipe })).toBeNull();

        rerender(<RecipeVersionListSkeleton label="Loading version history…" onBack={vi.fn()} />);

        expect(screen.getByRole('button', { name: versionList.backToRecipe })).toBeTruthy();
    });

    it('shows the caption once, over three inert rows kept out of the accessibility tree', () => {
        const { container } = render(<RecipeVersionListSkeleton label="Loading version history…" />);
        const hidden = container.querySelector('[aria-hidden="true"]') as HTMLElement;

        expect(screen.getAllByText('Loading version history…')).toHaveLength(1);
        expect(hidden.children).toHaveLength(3);
        expect(hidden.contains(screen.getByText('Loading version history…'))).toBe(false);
    });
});
