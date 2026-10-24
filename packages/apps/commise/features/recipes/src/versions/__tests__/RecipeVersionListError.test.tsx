// @vitest-environment jsdom
/**
 * The web version history's FAILED state (D3, D13; `buildSpec.md` §6.6: Error: "We couldn't load the history." + Try
 * again). It sits under the SAME header the settled list draws, and is no longer an unstyled paragraph with a bare
 * button beside a floating text link.
 *
 * Pinned back bar: the FRAME is the container's (`RecipeVersionsContainer`), so this leaf draws the header's eyebrow only
 * and no bar; the notice keeps Try again only.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { expectDesignSystemButton } from '../../__tests__/designSystemButton.js';
import { RecipeVersionListError } from '../RecipeVersionListError.js';
import { recipeVersionMessages } from '../messages.js';

const { versionList } = recipeVersionMessages.en;

/** The page's only Back: the header's eyebrow. */
const eyebrowBack = (): HTMLElement => {
    const all = screen.getAllByRole('link', { name: versionList.backToRecipe, hidden: true });

    expect(all).toHaveLength(1);

    return all[0] as HTMLElement;
};

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
        expect(eyebrowBack().className).toContain('nav:inline-flex');
        expect(document.querySelector('[data-condensed]')).toBeNull();
        expect(document.querySelector('[data-pushed-page]')).toBeNull();
    });

    it('keeps Back out of the notice: the alert holds Try again only', () => {
        render(
            <RecipeVersionListError
                title="We couldn’t load the history."
                retryLabel="Try again"
                onRetry={vi.fn()}
                onBack={vi.fn()}
                backHref="/en/recipes/r1"
            />,
        );

        expect(screen.getByRole('alert').querySelectorAll('a')).toHaveLength(0);
        expect(screen.getByRole('alert').textContent).not.toContain(versionList.backToRecipe);
    });

    it('names the eyebrow’s parent “Recipe” and reaches the recipe from it', async () => {
        const user = userEvent.setup();
        const onBack = vi.fn();
        render(
            <RecipeVersionListError
                title="We couldn’t load the history."
                retryLabel="Try again"
                onRetry={vi.fn()}
                onBack={onBack}
                backHref="/en/recipes/r1"
            />,
        );
        const eyebrow = eyebrowBack();

        expect(eyebrow.textContent).toBe(versionList.recipeParent);

        await user.click(eyebrow);

        expect(onBack).toHaveBeenCalledTimes(1);
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

    it('draws no Back when it is given none, as the native twin does', () => {
        render(
            <RecipeVersionListError title="We couldn’t load the history." retryLabel="Try again" onRetry={vi.fn()} />,
        );

        expect(screen.queryByRole('link', { name: versionList.backToRecipe, hidden: true })).toBeNull();
        expect(screen.queryByRole('button', { name: versionList.backToRecipe, hidden: true })).toBeNull();
        expect(document.querySelector('[data-pushed-page]')).toBeNull();
    });
});
