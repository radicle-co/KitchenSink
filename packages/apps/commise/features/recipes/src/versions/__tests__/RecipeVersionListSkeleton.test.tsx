// @vitest-environment jsdom
/**
 * The web version history's LOADING state (D3; `buildSpec.md` §6.6: "Loading: 3 skeleton rows"). It sits under the SAME
 * header the settled list draws — the back control and the title — so nothing moves when the history lands.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { RecipeVersionListSkeleton } from '../RecipeVersionListSkeleton.js';
import { recipeVersionMessages } from '../messages.js';

const { versionList } = recipeVersionMessages.en;

afterEach(cleanup);

describe('RecipeVersionListSkeleton (web)', () => {
    it('keeps the settled list’s header: the title, and the way back', () => {
        render(
            <RecipeVersionListSkeleton label="Loading version history" onBack={vi.fn()} backHref="/en/recipes/r1" />,
        );

        expect(screen.getByRole('heading', { level: 1, name: versionList.heading })).toBeTruthy();
        expect(screen.getByRole('link', { name: versionList.backToRecipe })).toBeTruthy();
    });

    it('is ONE polite status named for what is loading, over three decorative rows', () => {
        const { container } = render(<RecipeVersionListSkeleton label="Loading version history" onBack={vi.fn()} />);

        expect(screen.getAllByRole('status')).toHaveLength(1);
        expect(screen.getByRole('status', { name: 'Loading version history' }).textContent).toContain(
            'Loading version history',
        );
        const rows = container.querySelectorAll('[data-skeleton-row]');
        expect(rows).toHaveLength(3);

        for (const row of rows) {
            expect(row.closest('[aria-hidden="true"]')).not.toBeNull();
        }
    });

    it('goes back when the back control is used', async () => {
        const user = userEvent.setup();
        const onBack = vi.fn();
        render(<RecipeVersionListSkeleton label="Loading version history" onBack={onBack} backHref="/en/recipes/r1" />);

        await user.click(screen.getByRole('link', { name: versionList.backToRecipe }));

        expect(onBack).toHaveBeenCalledTimes(1);
    });
});
