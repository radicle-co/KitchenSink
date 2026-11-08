import { cleanup, fireEvent, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { role } from '../../tokens/colors.js';
import { LoadMoreControl } from '../LoadMoreControl.native.js';
import type { LoadMoreControlProps } from '../props.js';
import { render, resolvedColour } from '../../testing/tamaguiTesting.native.js';

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

    /** `#RRGGBB` → the `rgb(r, g, b)` spelling jsdom's `getComputedStyle` normalises colours to. */
    function rgb(hex: string): string {
        const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));

        return `rgb(${r}, ${g}, ${b})`;
    }

    // `componentFixes` issue 2 (2026-10-26): the label is in the action-text colour and a chevronDown follows it, so colour
    // and glyph mark the control pressable. Mutation lens: an `ink` label, or no glyph, fails.
    it('idle: an actionText label with an actionText chevronDown glyph', () => {
        const { container } = render(control());

        const glyph = container.querySelector<HTMLElement>('[data-commise-stub="icon"]');

        expect(resolvedColour(screen.getByText('Load more'), 'color')).toBe(rgb(role.actionText));
        expect(glyph?.dataset['iconName']).toBe('chevron-down');
        expect(glyph?.dataset['iconColor']).toBe(role.actionText);
        expect(glyph?.closest('[aria-hidden="true"]')).not.toBeNull();
    });

    it('failed: Try again keeps the quiet look, an ink label with the actionText retry glyph and no chevron', () => {
        const { container } = render(control({ failed: true }));

        const glyph = container.querySelector<HTMLElement>('[data-commise-stub="icon"]');

        expect(resolvedColour(screen.getByText('Try again'), 'color')).toBe(rgb(role.ink));
        expect(glyph?.dataset['iconName']).toBe('refresh-cw');
    });
});
