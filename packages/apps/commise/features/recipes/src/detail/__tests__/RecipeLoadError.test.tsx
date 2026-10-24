/**
 * `RecipeLoadError` (web): what the recipe page's read boundary shows when the read fails. A 404 is final, so it offers no
 * retry; any other failure — including an id that cannot name a recipe — is the generic one, whose retry is the
 * boundary's reset. Both keep a way back.
 */
import { NotFoundError } from '@kitchensink/recipe-service-client';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RecipeLoadError } from '../RecipeLoadError.js';
import { recipeLoadMessages } from '../messages.js';

afterEach(cleanup);

const back = { label: 'Back to My recipes', icon: 'chevronLeft', onPress: vi.fn(), href: '/en/recipes' } as const;

describe('RecipeLoadError', () => {
    it('⛔ says a missing recipe is not available and offers NO retry: a 404 is final', () => {
        render(<RecipeLoadError error={new NotFoundError('gone')} onRetry={vi.fn()} back={back} />);

        expect(screen.getByRole('alert').textContent).toContain(recipeLoadMessages.en.notFoundTitle);
        expect(screen.queryByRole('button', { name: recipeLoadMessages.en.retry })).toBeNull();
    });

    it('says any other failure generically, with a retry that calls the boundary’s reset', () => {
        const onRetry = vi.fn();
        render(<RecipeLoadError error={new Error('network down')} onRetry={onRetry} back={back} />);

        expect(screen.getByRole('alert').textContent).toContain(recipeLoadMessages.en.errorTitle);

        fireEvent.click(screen.getByRole('button', { name: recipeLoadMessages.en.retry }));

        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('keeps a way back in both states', () => {
        const { rerender } = render(
            <RecipeLoadError error={new NotFoundError('gone')} onRetry={vi.fn()} back={back} />,
        );

        expect(screen.getByRole('link', { name: 'Back to My recipes' }).getAttribute('href')).toBe('/en/recipes');

        rerender(<RecipeLoadError error={new Error('x')} onRetry={vi.fn()} back={back} />);

        expect(screen.getByRole('link', { name: 'Back to My recipes' })).toBeTruthy();
    });

    it('offers no way back when the host has none (a screen opened with no navigator behind it)', () => {
        render(<RecipeLoadError error={new Error('x')} onRetry={vi.fn()} />);

        expect(screen.queryByRole('link')).toBeNull();
    });
});
