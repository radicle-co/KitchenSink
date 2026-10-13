// @vitest-environment jsdom
/**
 * The web version history's FAILED state (D3, D13; `buildSpec.md` §6.6: Error: "We couldn't load the history." + Try
 * again). It sits under the SAME header the settled list draws, and is no longer an unstyled paragraph with a bare
 * button beside a floating text link.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { expectDesignSystemButton } from '../../__tests__/designSystemButton.js';
import { RecipeVersionListError } from '../RecipeVersionListError.js';
import { recipeVersionMessages } from '../messages.js';

const { versionList } = recipeVersionMessages.en;

afterEach(cleanup);

describe('RecipeVersionListError (web)', () => {
    it('keeps the header and says the history could not load, as an alert', () => {
        render(
            <RecipeVersionListError
                title="We couldn’t load the history."
                retryLabel="Try again"
                onRetry={vi.fn()}
                onBack={vi.fn()}
                backHref="/en/recipes/r1"
            />,
        );

        expect(screen.getByRole('heading', { level: 1, name: versionList.heading })).toBeTruthy();
        expect(screen.getByRole('alert').textContent).toContain('We couldn’t load the history.');
        expect(screen.getByRole('link', { name: versionList.backToRecipe })).toBeTruthy();
    });

    it('offers Try again on the design-system button, and retries on a press', async () => {
        const user = userEvent.setup();
        const onRetry = vi.fn();
        render(
            <RecipeVersionListError
                title="We couldn’t load the history."
                retryLabel="Try again"
                onRetry={onRetry}
                onBack={vi.fn()}
            />,
        );

        const retry = screen.getByRole('button', { name: 'Try again' });
        expectDesignSystemButton(retry, 'secondary', 'refresh-cw');
        await user.click(retry);

        expect(onRetry).toHaveBeenCalledTimes(1);
    });
});
