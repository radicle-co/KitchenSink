import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LoadMoreControl } from '../LoadMoreControl.js';
import type { LoadMoreControlProps } from '../props.js';

afterEach(cleanup);

const labels = {
    loadMore: 'Load more',
    loadingMore: 'Loading…',
    retry: 'Try again',
    failed: 'We couldn’t load more recipes.',
};

function control(overrides: Partial<LoadMoreControlProps> = {}): ReactElement {
    return (
        <LoadMoreControl hasMore loading={false} failed={false} onLoadMore={vi.fn()} labels={labels} {...overrides} />
    );
}

describe('LoadMoreControl (web)', () => {
    it('renders nothing once there is no further page', () => {
        const { container } = render(control({ hasMore: false }));

        expect(container.textContent).toBe('');
    });

    it('idle: a "Load more" button whose press loads the next page, over a silent message region', () => {
        const onLoadMore = vi.fn();
        render(control({ onLoadMore }));

        fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

        expect(onLoadMore).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('alert').textContent).toBe('');
    });

    it('busy: the pressed button keeps focus, says it is working, and refuses a second press', () => {
        const onLoadMore = vi.fn();
        render(control({ loading: true, onLoadMore }));
        const button = screen.getByRole('button', { name: 'Loading…' });
        button.focus();

        fireEvent.click(button);

        expect(button.getAttribute('aria-busy')).toBe('true');
        expect(button.hasAttribute('disabled')).toBe(false);
        expect(document.activeElement).toBe(button);
        expect(onLoadMore).not.toHaveBeenCalled();
    });

    it('⛔ failed: says what happened in an announced message, and the SAME button becomes Try again', () => {
        const onLoadMore = vi.fn();
        const { rerender } = render(control({ loading: true, onLoadMore }));
        const button = screen.getByRole('button', { name: 'Loading…' });
        const region = screen.getByRole('alert');

        rerender(control({ failed: true, onLoadMore }));

        // One button element throughout — a swapped element would drop the focus of the cook who pressed it.
        expect(screen.getByRole('button', { name: 'Try again' })).toBe(button);
        expect(screen.getByRole('alert')).toBe(region);
        expect(region.textContent).toBe('We couldn’t load more recipes.');
        expect(button.getAttribute('aria-describedby')).toBe(region.id);

        fireEvent.click(button);
        expect(onLoadMore).toHaveBeenCalledTimes(1);
    });

    it('a retry in flight clears the message, so a second failure is announced again', () => {
        render(control({ failed: true, loading: true }));

        expect(screen.getByRole('alert').textContent).toBe('');
        expect(screen.getByRole('button', { name: 'Loading…' }).hasAttribute('aria-describedby')).toBe(false);
    });
});
