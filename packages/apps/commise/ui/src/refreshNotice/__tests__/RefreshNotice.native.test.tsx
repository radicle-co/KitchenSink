import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RefreshNoticeProps } from '../props.js';
import { RefreshNotice } from '../RefreshNotice.native.js';

afterEach(cleanup);

const labels = { failed: 'We couldn’t refresh your collections.', retry: 'Try again' };

function notice(overrides: Partial<RefreshNoticeProps> = {}): ReactElement {
    return <RefreshNotice failed={false} refreshing={false} onRetry={vi.fn()} labels={labels} {...overrides} />;
}

describe('RefreshNotice (native)', () => {
    it('with nothing failed: no visible message and no button', () => {
        render(notice());

        expect(screen.queryByRole('button')).toBeNull();
        expect(screen.queryByText(labels.failed)).toBeNull();
    });

    it('⛔ failed: shows what happened, and Try again (a single tap, not only a pull) retries', () => {
        const onRetry = vi.fn();
        render(notice({ failed: true, onRetry }));

        expect(screen.getAllByText(labels.failed).length).toBeGreaterThan(0);
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('announces politely, in a region mounted before the failure and filled in place', () => {
        const { container, rerender } = render(notice());
        const politeRegions = (): Element[] => [...container.querySelectorAll('[aria-live="polite"]')];
        const [region] = politeRegions();

        rerender(notice({ failed: true }));

        expect(region).toBeDefined();
        expect(politeRegions()[0]).toBe(region);
        expect(region?.textContent).toBe(labels.failed);
        expect(container.querySelector('[aria-live="assertive"]')).toBeNull();
    });

    it('⛔ a retry in flight keeps the message and the SAME button, busy and disabled, and clears the announcement', () => {
        const onRetry = vi.fn();
        const { container, rerender } = render(notice({ failed: true, onRetry }));
        const button = screen.getByRole('button', { name: 'Try again' });

        rerender(notice({ failed: true, refreshing: true, onRetry }));

        expect(screen.getByRole('button', { name: 'Try again' })).toBe(button);
        expect(button.getAttribute('aria-busy')).toBe('true');
        expect(screen.getByText(labels.failed)).toBeTruthy();
        expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe('');
        fireEvent.click(button);
        expect(onRetry).not.toHaveBeenCalled();
    });

    it('a successful refresh removes the message and the button', () => {
        const { rerender } = render(notice({ failed: true, refreshing: true }));

        rerender(notice());

        expect(screen.queryByRole('button')).toBeNull();
        expect(screen.queryByText(labels.failed)).toBeNull();
    });
});
