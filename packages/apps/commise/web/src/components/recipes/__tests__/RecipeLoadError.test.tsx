// @vitest-environment jsdom
/**
 * The one leaf a recipe read's boundary renders when the read fails (staff-code-quality, 2026-10-09 review: the block was
 * copied into the editor and detail containers, each with a raw `<button>`). A 404 is final, so it offers no retry; any
 * other failure is the generic one, whose retry is the boundary's reset.
 */
import { LocaleProvider } from '@commise/i18n/react';
import { NotFoundError } from '@kitchensink/recipe-service-client';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RecipeLoadError } from '../RecipeLoadError';

afterEach(cleanup);

function renderError(error: unknown) {
    const onRetry = vi.fn();

    render(
        <LocaleProvider locale="en">
            <RecipeLoadError error={error} onRetry={onRetry} />
        </LocaleProvider>,
    );

    return onRetry;
}

describe('RecipeLoadError', () => {
    it('says a missing recipe is not found, and offers no retry', () => {
        renderError(new NotFoundError('gone'));

        expect(screen.getByRole('alert')).toHaveTextContent('This recipe isn’t available.');
        expect(screen.queryByRole('button')).toBeNull();
    });

    // F18 (`evaluateFinal.md`): the state was two lines of plain text with no heading and no way back (§6.7).
    it.each([
        ['not found', new NotFoundError('gone')],
        ['load failure', new Error('network down')],
    ])('heads the %s state and offers a way back to My recipes', (_state, error) => {
        renderError(error);

        expect(screen.getByRole('heading', { level: 1 })).toBeTruthy();
        expect(screen.getByRole('link', { name: 'Back to My recipes' }).getAttribute('href')).toBe('/en/recipes');
    });

    it('says any other failure could not load the recipe, and its Try again retries', async () => {
        const onRetry = renderError(new Error('network down'));

        expect(screen.getByRole('alert')).toHaveTextContent(/couldn.t load this recipe/iu);
        await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

        expect(onRetry).toHaveBeenCalledTimes(1);
    });
});
