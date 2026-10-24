/**
 * The native version history's LOADING state (D3; `buildSpec.md` §6.6 "Loading: 3 skeleton rows"): the settled list's
 * title, a polite caption, and three inert rows. The way back is the SCREEN's (it sits above the read boundary in every
 * state), and so is the failed state, which is already an alert with a Try again button.
 */
import { afterEach, describe, expect, it } from 'vitest';
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

    // REWRITES "draws a Back in the header only when it is given one": the pinned bar owns Back on native, and a header
    // Back left in the tree beside it is a second element with the same name. `onBack` is the web leaf's prop, so this
    // leaf's props no longer carry it.
    it('draws no Back: the screen’s pinned bar owns it, and the props carry no way back to ignore', () => {
        render(<RecipeVersionListSkeleton label="Loading version history…" />);

        expect(screen.queryAllByRole('button', { name: versionList.backToRecipe, hidden: true })).toHaveLength(0);
    });

    it('shows the caption once, over three inert rows kept out of the accessibility tree', () => {
        const { container } = render(<RecipeVersionListSkeleton label="Loading version history…" />);
        const hidden = container.querySelector('[aria-hidden="true"]') as HTMLElement;

        expect(screen.getAllByText('Loading version history…')).toHaveLength(1);
        expect(hidden.children).toHaveLength(3);
        expect(hidden.contains(screen.getByText('Loading version history…'))).toBe(false);
    });
});
