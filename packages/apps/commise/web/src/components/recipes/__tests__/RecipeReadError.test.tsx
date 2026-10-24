// @vitest-environment jsdom
/**
 * The web host of the shared `RecipeLoadError`: what a recipe read's boundary renders in the detail route AND the
 * editor (replacing the web-only `RecipeLoadError` copy, whose raw copy of the same sentences drifted). A 404 is final, so
 * it offers no retry; any other failure's retry is the boundary's reset. Both keep a real link back to My recipes whose
 * plain click goes through the router.
 */
import { LocaleProvider } from '@commise/i18n/react';
import { NotFoundError } from '@kitchensink/recipe-service-client';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const push = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
    useParams: () => ({ locale: 'en' }),
    useRouter: () => ({ push }),
}));

import { RecipeReadError } from '../RecipeReadError';

afterEach(() => {
    cleanup();
    push.mockReset();
});

function renderError(error: unknown) {
    const onRetry = vi.fn();

    render(
        <LocaleProvider locale="en">
            <RecipeReadError error={error} onRetry={onRetry} />
        </LocaleProvider>,
    );

    return onRetry;
}

describe('RecipeReadError', () => {
    it('says a missing recipe is not found, and offers no retry', () => {
        renderError(new NotFoundError('gone'));

        expect(screen.getByRole('alert')).toHaveTextContent('This recipe isn’t available.');
        expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    });

    // F18 (`evaluateFinal.md`): the state was two lines of plain text with no way back (§6.7).
    it.each([
        ['not found', new NotFoundError('gone')],
        ['load failure', new Error('network down')],
    ])('offers a way back to My recipes in the %s state, as a real link', async (_state, error) => {
        renderError(error);

        const back = screen.getByRole('link', { name: 'Back to My recipes' });

        expect(back.getAttribute('href')).toBe('/en/recipes');

        await userEvent.click(back);

        expect(push).toHaveBeenCalledWith('/en/recipes');
    });

    it('says any other failure could not load the recipe, and its Try again retries', async () => {
        const onRetry = renderError(new Error('network down'));

        expect(screen.getByRole('alert')).toHaveTextContent(/couldn.t load this recipe/iu);
        await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

        expect(onRetry).toHaveBeenCalledTimes(1);
    });
});
