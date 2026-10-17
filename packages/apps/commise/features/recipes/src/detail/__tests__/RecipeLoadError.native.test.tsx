/**
 * `RecipeLoadError` (native): the recipe screen's failed read, as the thumb-reach stack — Try again on top for a failure,
 * the way back below, and no retry for a recipe that is gone.
 */
import { NotFoundError } from '@kitchensink/recipe-service-client';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RecipeLoadError } from '../RecipeLoadError.js';
import { recipeLoadMessages } from '../messages.js';

afterEach(cleanup);

const back = { label: 'Back to Discover', icon: 'chevronLeft', onPress: vi.fn() } as const;

describe('RecipeLoadError (native)', () => {
    it('⛔ says a missing recipe is not available, assertively, and offers NO retry', () => {
        render(<RecipeLoadError error={new NotFoundError('gone')} onRetry={vi.fn()} back={back} />);

        expect(screen.getByText(recipeLoadMessages.en.notFoundTitle).closest('[aria-live="assertive"]')).not.toBeNull();
        expect(screen.queryByRole('button', { name: recipeLoadMessages.en.retry })).toBeNull();
    });

    it('says any other failure generically and retries on press', () => {
        const onRetry = vi.fn();
        render(<RecipeLoadError error={new Error('network down')} onRetry={onRetry} back={back} />);

        expect(screen.getByText(recipeLoadMessages.en.errorTitle)).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: recipeLoadMessages.en.retry }));

        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('goes back from the way back, named for where it goes', () => {
        render(<RecipeLoadError error={new Error('x')} onRetry={vi.fn()} back={back} />);

        fireEvent.click(screen.getByRole('button', { name: 'Back to Discover' }));

        expect(back.onPress).toHaveBeenCalledTimes(1);
    });

    it('offers no way back when the navigator wires none', () => {
        render(<RecipeLoadError error={new NotFoundError('gone')} onRetry={vi.fn()} />);

        expect(screen.queryByRole('button')).toBeNull();
    });
});
