import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { mockCaptureException } = vi.hoisted(() => ({ mockCaptureException: vi.fn() }));

vi.mock('@sentry/nextjs', () => ({ captureException: mockCaptureException }));

import GlobalError from '@/app/global-error';

afterEach(cleanup);

/**
 * The last-resort page, rendered in place of the root layout — so no locale provider, no global styles. It still
 * speaks the app's own copy (the default locale's, from the same messages the route boundaries use), declares that
 * language, and offers a way to recover rather than a bare status page.
 */
describe('GlobalError', () => {
    it('reports the error to Sentry on mount', () => {
        const error = new Error('boom');

        render(<GlobalError error={error} retry={vi.fn()} />);

        expect(mockCaptureException).toHaveBeenCalledWith(error);
    });

    it('explains the failure in the app’s own copy, in the declared page language', () => {
        render(<GlobalError error={new Error('boom')} retry={vi.fn()} />);

        expect(screen.getByRole('heading', { name: 'Something went wrong.' })).toBeTruthy();
        expect(screen.getByText('We couldn’t load this page. Please try again.')).toBeTruthy();
        expect(
            document.documentElement.getAttribute('lang') ?? document.querySelector('html')?.getAttribute('lang'),
        ).toBe('en');
    });

    it('⛔ Try again calls Next’s retry(), which re-fetches — never a dead end', async () => {
        const retry = vi.fn();
        render(<GlobalError error={new Error('boom')} retry={retry} />);

        await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));

        expect(retry).toHaveBeenCalledTimes(1);
    });

    it('offers a full page load of Home as the way out of a crash a retry cannot clear', () => {
        render(<GlobalError error={new Error('boom')} retry={vi.fn()} />);

        expect(screen.getByRole('link', { name: 'Go to Home' }).getAttribute('href')).toBe('/');
    });
});
