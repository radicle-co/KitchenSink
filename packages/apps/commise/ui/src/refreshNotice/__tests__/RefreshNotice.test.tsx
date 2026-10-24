import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RefreshNoticeProps } from '../props.js';
import { RefreshNotice } from '../RefreshNotice.js';

afterEach(cleanup);

const labels = { failed: 'We couldn’t refresh your recipes.', retry: 'Try again' };

function notice(overrides: Partial<RefreshNoticeProps> = {}): ReactElement {
    return <RefreshNotice failed={false} refreshing={false} onRetry={vi.fn()} labels={labels} {...overrides} />;
}

describe('RefreshNotice (web)', () => {
    it('with nothing failed: no message and no button, over a status region already mounted and silent', () => {
        render(notice());

        expect(screen.queryByText(labels.failed)).toBeNull();
        expect(screen.queryByRole('button')).toBeNull();
        expect(screen.getByRole('status').textContent).toBe('');
    });

    it('a refresh in flight with nothing failed shows nothing either', () => {
        render(notice({ refreshing: true }));

        expect(screen.queryByRole('button')).toBeNull();
        expect(screen.getByRole('status').textContent).toBe('');
    });

    it('⛔ failed: the SAME status region politely announces what happened, and Try again retries', () => {
        const onRetry = vi.fn();
        const { rerender } = render(notice({ onRetry }));
        const region = screen.getByRole('status');

        rerender(notice({ failed: true, onRetry }));

        // Mounted empty and filled in place: a region inserted with its text is not reliably announced.
        expect(screen.getByRole('status')).toBe(region);
        expect(region.textContent).toBe(labels.failed);
        expect(region.getAttribute('aria-live')).not.toBe('assertive');
        const button = screen.getByRole('button', { name: 'Try again' });
        fireEvent.click(button);
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('⛔ a retry in flight keeps the message and the SAME focused button, busy, and clears only the announcement', () => {
        const onRetry = vi.fn();
        const { rerender } = render(notice({ failed: true, onRetry }));
        const button = screen.getByRole('button', { name: 'Try again' });
        button.focus();

        rerender(notice({ failed: true, refreshing: true, onRetry }));

        // Unmounting the pressed button would drop its focus to <body> (WCAG 2.2 SC 2.4.3).
        expect(screen.getByRole('button', { name: 'Try again' })).toBe(button);
        expect(document.activeElement).toBe(button);
        expect(button.getAttribute('aria-busy')).toBe('true');
        expect(screen.getByText(labels.failed)).toBeTruthy();
        // Cleared while retrying, so a second failure is announced again.
        expect(screen.getByRole('status').textContent).toBe('');
        fireEvent.click(button);
        expect(onRetry).not.toHaveBeenCalled();
    });

    it('a retry that fails again re-announces', () => {
        const { rerender } = render(notice({ failed: true, refreshing: true }));

        rerender(notice({ failed: true }));

        expect(screen.getByRole('status').textContent).toBe(labels.failed);
    });

    it('a successful refresh removes the message and the button, leaving the silent region', () => {
        const { rerender } = render(notice({ failed: true, refreshing: true }));

        rerender(notice());

        expect(screen.queryByText(labels.failed)).toBeNull();
        expect(screen.queryByRole('button')).toBeNull();
        expect(screen.getByRole('status').textContent).toBe('');
    });

    it('names the message as the button’s description', () => {
        render(notice({ failed: true }));

        const button = screen.getByRole('button', { name: 'Try again' });
        const describedBy = button.getAttribute('aria-describedby');
        expect(describedBy).not.toBeNull();
        expect(document.getElementById(describedBy ?? '')?.textContent).toBe(labels.failed);
    });
});
