import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LoadMoreControl } from '../LoadMoreControl.native.js';
import type { LoadMoreControlProps } from '../props.js';

afterEach(cleanup);

const labels = {
    loadMore: 'Load more',
    loadingMore: 'Loading…',
    retry: 'Try again',
    failed: 'We couldn’t load more collections.',
};

function control(overrides: Partial<LoadMoreControlProps> = {}): ReactElement {
    return (
        <LoadMoreControl hasMore loading={false} failed={false} onLoadMore={vi.fn()} labels={labels} {...overrides} />
    );
}

describe('LoadMoreControl (native)', () => {
    it('renders nothing once there is no further page', () => {
        const { container } = render(control({ hasMore: false }));

        expect(container.textContent).toBe('');
    });

    it('idle: a "Load more" button whose press loads the next page', () => {
        const onLoadMore = vi.fn();
        render(control({ onLoadMore }));

        fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

        expect(onLoadMore).toHaveBeenCalledTimes(1);
    });

    it('busy: disabled and marked busy while the page is in flight', () => {
        render(control({ loading: true }));

        const button = screen.getByRole('button', { name: 'Loading…' });
        expect(button.getAttribute('aria-busy')).toBe('true');
        expect(button.getAttribute('aria-disabled')).toBe('true');
    });

    it('⛔ failed: an assertive message says what happened, and the button offers Try again', () => {
        const onLoadMore = vi.fn();
        render(control({ failed: true, onLoadMore }));

        const message = screen.getByText('We couldn’t load more collections.');
        expect(message.getAttribute('aria-live')).toBe('assertive');

        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(onLoadMore).toHaveBeenCalledTimes(1);
    });

    it('a retry in flight clears the message, so a second failure is announced again', () => {
        render(control({ failed: true, loading: true }));

        expect(screen.queryByText('We couldn’t load more collections.')).toBeNull();
    });
});
