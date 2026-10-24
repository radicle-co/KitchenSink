/**
 * The native version history's FAILED state (D3, D13; `buildSpec.md` §6.6: Error: "We couldn't load the history." + Try
 * again) — the twin of the web `RecipeVersionListError`. Written FIRST: mobile's `RecipeVersionsScreen` hand-built this
 * tree (a bare `Text` alert and a button), which is the reinvention the audit named. Like the native skeleton it keeps the
 * settled list's title, so nothing moves between loading, failed and loaded. It draws NO Back: on native the screen's
 * pinned bar owns it in every state (`docs/design/uiRefreshWorkshop5/pinnedBackBar.md` §2).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { RecipeVersionListError } from '../RecipeVersionListError.native.js';
import { recipeVersionMessages } from '../messages.js';

const { versionList } = recipeVersionMessages.en;

afterEach(cleanup);

const props = {
    title: 'We couldn’t load the version history.',
    retryLabel: 'Try again',
    onRetry: vi.fn(),
};

describe('RecipeVersionListError (native)', () => {
    it('keeps the settled list’s title and says the history could not load, as an alert', () => {
        render(<RecipeVersionListError {...props} />);

        expect(screen.getByRole('heading', { name: versionList.heading })).toBeTruthy();
        expect(screen.getByRole('alert').textContent).toContain('We couldn’t load the version history.');
    });

    it('offers Try again, and retries on a press', () => {
        const onRetry = vi.fn();
        render(<RecipeVersionListError {...props} onRetry={onRetry} />);

        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    // REWRITES "draws a Back in the header only when it is given one": the pinned bar owns Back on native, and a header
    // Back left in the tree beside it is a second element with the same name. `onBack` is the web leaf's prop, so this
    // leaf's props no longer carry it.
    it('draws no Back: the screen’s pinned bar owns it, and the props carry no way back to ignore', () => {
        render(<RecipeVersionListError {...props} />);

        expect(screen.queryAllByRole('button', { name: versionList.backToRecipe, hidden: true })).toHaveLength(0);
        expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    });
});
