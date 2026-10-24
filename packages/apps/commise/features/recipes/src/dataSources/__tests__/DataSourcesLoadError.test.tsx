// @vitest-environment jsdom
/**
 * The web Data sources error state (design §S16): an alert that announces itself, and a Try again that retries the
 * read. Focus stays where it is; the alert carries the news.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DataSourcesLoadError } from '../DataSourcesLoadError.js';

afterEach(cleanup);

describe('DataSourcesLoadError (web)', () => {
    it('announces the failure as an alert, and only the failure: the button is not read out with it', () => {
        render(<DataSourcesLoadError onRetry={vi.fn()} retrying={false} failures={1} />);

        expect(screen.getByRole('alert').textContent).toBe('We couldn’t load the data sources.');
    });

    it('retries the read when Try again is pressed', async () => {
        const onRetry = vi.fn();
        render(<DataSourcesLoadError onRetry={onRetry} retrying={false} failures={1} />);

        await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    // `docs/design/readSurfacesEvaluation.md` D3: the pressed control stays, focusable and busy, and cannot fire twice.
    it('keeps Try again in place while the retry runs: busy, and pressing it again does nothing', async () => {
        const onRetry = vi.fn();
        render(<DataSourcesLoadError onRetry={onRetry} retrying failures={1} />);

        const tryAgain = screen.getByRole('button', { name: 'Try again' });

        expect(tryAgain.getAttribute('aria-busy')).toBe('true');
        await userEvent.click(tryAgain);
        expect(onRetry).not.toHaveBeenCalled();
    });

    // A live region speaks at a change: the same words in the same node are silent, so each failure is a new alert.
    it('renders a new alert for each failure, and keeps it through a retry', () => {
        const { rerender } = render(<DataSourcesLoadError onRetry={vi.fn()} retrying={false} failures={1} />);
        const first = screen.getByRole('alert');

        rerender(<DataSourcesLoadError onRetry={vi.fn()} retrying failures={1} />);
        expect(screen.getByRole('alert')).toBe(first);

        rerender(<DataSourcesLoadError onRetry={vi.fn()} retrying={false} failures={2} />);
        expect(screen.getByRole('alert')).not.toBe(first);
        expect(first.isConnected).toBe(false);
    });
});
