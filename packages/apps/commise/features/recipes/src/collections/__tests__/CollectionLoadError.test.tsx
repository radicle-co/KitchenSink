/**
 * `CollectionLoadError` (web): what a collection page's read boundary shows when the read fails. A 404 is final, so it
 * says so with its reason and offers no retry; any other failure is the generic one, whose retry is the boundary's reset.
 * Both keep a way back. It replaces the web app's raw-`<button>` copy and the mobile screen's hand-built fallback.
 */
import { NotFoundError } from '@kitchensink/recipe-service-client';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CollectionLoadError } from '../CollectionLoadError.js';
import { collectionMessages } from '../messages.js';

afterEach(cleanup);

const { detail } = collectionMessages.en;
const back = { label: 'Back to Collections', icon: 'chevronLeft', onPress: vi.fn(), href: '/en/collections' } as const;

describe('CollectionLoadError', () => {
    it('⛔ says a missing collection is not found, with why, and offers NO retry: a 404 is final', () => {
        render(<CollectionLoadError error={new NotFoundError('gone')} onRetry={vi.fn()} back={back} />);

        expect(screen.getByRole('alert').textContent).toContain(detail.notFoundTitle);
        expect(screen.getByRole('alert').textContent).toContain(detail.notFoundBody);
        expect(screen.queryByRole('button', { name: detail.retry })).toBeNull();
    });

    it('says any other failure generically, with a retry that calls the boundary’s reset', () => {
        const onRetry = vi.fn();
        render(<CollectionLoadError error={new Error('network down')} onRetry={onRetry} back={back} />);

        expect(screen.getByRole('alert').textContent).toContain(detail.errorTitle);

        fireEvent.click(screen.getByRole('button', { name: detail.retry }));

        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('keeps a real link back in both states', () => {
        const { rerender } = render(
            <CollectionLoadError error={new NotFoundError('gone')} onRetry={vi.fn()} back={back} />,
        );

        expect(screen.getByRole('link', { name: 'Back to Collections' }).getAttribute('href')).toBe('/en/collections');

        rerender(<CollectionLoadError error={new Error('x')} onRetry={vi.fn()} back={back} />);

        expect(screen.getByRole('link', { name: 'Back to Collections' })).toBeTruthy();
    });
});
