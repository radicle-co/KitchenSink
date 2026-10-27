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

    // REWRITTEN for `componentFixes` issue 2 (2026-10-26): Load more was an `ink` label on the quiet surface, which read
    // as text. Idle and busy now wear the ghost surface (an `actionText` label and glyph, no fill at rest) with a
    // chevronDown after the label, so colour and glyph mark it pressable. Try again keeps the quiet surface (ink label,
    // actionText refreshCw). The element is still the SAME button across all three, which a focus test pins below.
    it('⛔ is a ghost Button while idle and busy, a quiet one when failed; never a tonal pill a chip could be mistaken for', () => {
        const { rerender } = render(control());
        const button = screen.getByRole('button', { name: 'Load more' });

        expect(button.className).toBe(buttonSurfaceClass('ghost'));
        expect(button.className).toContain('text-action-text');
        expect(button.className.split(' ')).not.toContain('text-ink');
        // No RESTING fill (a pressed fill is surface-muted, behind a `hover:`/`active:` prefix).
        expect(button.className.split(' ')).not.toContain('bg-surface-muted');

        rerender(control({ loading: true }));
        expect(screen.getByRole('button', { name: 'Loading…' })).toBe(button);
        expect(button.className).toBe(buttonSurfaceClass('ghost'));

        rerender(control({ failed: true }));
        expect(screen.getByRole('button', { name: 'Try again' })).toBe(button);
        expect(button.className).toBe(buttonSurfaceClass('quiet'));
    });

    it('draws a chevronDown after the label while idle, as a decorative glyph outside the name', () => {
        const { container } = render(control());
        const button = screen.getByRole('button', { name: 'Load more' });
        const chevron = container.querySelector('svg.lucide-chevron-down');

        expect(chevron).not.toBeNull();
        expect(button.contains(chevron)).toBe(true);
        expect(chevron?.closest('[aria-hidden="true"]')).not.toBeNull();
        expect(button.lastElementChild?.contains(chevron)).toBe(true);
    });

    it('⛔ keeps focus on the same button from idle through busy to failed', () => {
        const { rerender } = render(control());
        const button = screen.getByRole('button', { name: 'Load more' });
        button.focus();

        rerender(control({ loading: true }));
        expect(document.activeElement).toBe(button);

        rerender(control({ failed: true }));
        expect(document.activeElement).toBe(button);
        expect(screen.getByRole('button', { name: 'Try again' })).toBe(button);
    });

    it('draws the retry glyph on Try again only, and the chevron not there', () => {
        const { container, rerender } = render(control());

        expect(container.querySelector('svg.lucide-refresh-cw')).toBeNull();

        rerender(control({ failed: true }));
        expect(container.querySelector('svg.lucide-refresh-cw')).not.toBeNull();
        expect(container.querySelector('svg.lucide-chevron-down')).toBeNull();
    });
});
