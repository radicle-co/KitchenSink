import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buttonSurfaceClass } from '../../button/surfaceClass.js';
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
        // ⚠️ REWRITTEN: the button is now the design system's quiet `Button`, which states its description itself, so the
        // describedby names Button's own description element, not the alert. It carries the same text.
        const describedBy = button.getAttribute('aria-describedby');
        expect(document.getElementById(describedBy ?? '')?.textContent).toBe(labels.failed);

        fireEvent.click(button);
        expect(onLoadMore).toHaveBeenCalledTimes(1);
    });

    it('a retry in flight clears the message, so a second failure is announced again', () => {
        render(control({ failed: true, loading: true }));

        expect(screen.getByRole('alert').textContent).toBe('');
        expect(screen.getByRole('button', { name: 'Loading…' }).hasAttribute('aria-describedby')).toBe(false);
    });

    // `componentFixes.md` §1: the control wears the quiet surface (it hand-rolled a `surface-muted` pill, which now marks a
    // chip), so it inherits the radius, busy and disabled states from Button.
    it('⛔ is the quiet Button in every state, never a tonal pill a chip could be mistaken for', () => {
        const { rerender } = render(control());
        const button = screen.getByRole('button', { name: 'Load more' });

        expect(button.className).toBe(buttonSurfaceClass('quiet'));
        expect(button.className).not.toContain('surface-muted');

        rerender(control({ loading: true }));
        expect(screen.getByRole('button', { name: 'Loading…' })).toBe(button);
        expect(button.className).toBe(buttonSurfaceClass('quiet'));

        rerender(control({ failed: true }));
        expect(screen.getByRole('button', { name: 'Try again' })).toBe(button);
        expect(button.className).toBe(buttonSurfaceClass('quiet'));
    });

    it('draws the retry glyph on Try again only', () => {
        const { container, rerender } = render(control());

        expect(container.querySelector('svg.lucide-refresh-cw')).toBeNull();

        rerender(control({ failed: true }));
        expect(container.querySelector('svg.lucide-refresh-cw')).not.toBeNull();
    });
});
