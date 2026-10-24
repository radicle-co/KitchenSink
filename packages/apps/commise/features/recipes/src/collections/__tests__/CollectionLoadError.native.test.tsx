/**
 * `CollectionLoadError` (native): the collection screen's failed read, as the thumb-reach stack. It replaces the screen's
 * hand-built `DetailFallback`, which put Back ABOVE the message and the retry (the opposite of the thumb-reach order).
 */
import { NotFoundError } from '@kitchensink/recipe-service-client';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CollectionLoadError } from '../CollectionLoadError.js';
import { collectionMessages } from '../messages.js';

afterEach(cleanup);

const { detail } = collectionMessages.en;
const back = { label: 'Back to Collections', parent: 'Collections', onPress: vi.fn() };

describe('CollectionLoadError (native)', () => {
    it('⛔ says a missing collection is not found, assertively, and offers NO retry', () => {
        render(<CollectionLoadError error={new NotFoundError('gone')} onRetry={vi.fn()} back={back} />);

        expect(screen.getByText(detail.notFoundTitle).closest('[aria-live="assertive"]')).not.toBeNull();
        expect(screen.queryByRole('button', { name: detail.retry })).toBeNull();
    });

    it('says any other failure generically and retries on press', () => {
        const onRetry = vi.fn();
        render(<CollectionLoadError error={new Error('network down')} onRetry={onRetry} back={back} />);

        expect(screen.getByText(detail.errorTitle)).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: detail.retry }));

        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('goes back from the way back for a missing collection, named for where it goes', () => {
        render(<CollectionLoadError error={new NotFoundError('gone')} onRetry={vi.fn()} back={back} />);

        fireEvent.click(screen.getByRole('button', { name: 'Back to Collections' }));

        expect(back.onPress).toHaveBeenCalledTimes(1);
    });

    // The not-found rule lives in the notice: hosts pass `back` unconditionally, and the bar owns Back otherwise.
    it('⛔ draws NO Back for a generic failure even when it is handed one: the bar owns it', () => {
        render(<CollectionLoadError error={new Error('network down')} onRetry={vi.fn()} back={back} />);

        expect(screen.queryByRole('button', { name: 'Back to Collections' })).toBeNull();
        expect(screen.getByRole('button', { name: detail.retry })).toBeTruthy();
    });
});
