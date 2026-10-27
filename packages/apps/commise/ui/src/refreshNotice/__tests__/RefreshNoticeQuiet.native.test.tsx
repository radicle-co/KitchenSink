/**
 * RefreshNotice and LoadMoreControl (native) — the quiet Try again (`componentFixes.md` §1): the design system's quiet
 * `Button` instead of a hand-rolled `Pressable` pill, with the failure reason as its hint.
 *
 * Stands in for `Pressable` to read the hint a device receives; react-native-web would project it to nothing.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const seen = vi.hoisted(() => ({ buttons: [] as Record<string, unknown>[] }));

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();
    const { createElement } = await import('react');

    return {
        ...actual,
        Pressable: (props: Record<string, unknown>) => {
            seen.buttons.push(props);

            // Button hands its pill over as a function of the press state (the press paint), so it is called, unpressed.
            const children = props['children'];

            return createElement(
                actual.View,
                null,
                (typeof children === 'function' ? children({ pressed: false }) : children) as never,
            );
        },
    };
});

import { role } from '../../tokens/colors.js';
import { LoadMoreControl } from '../../loadMore/LoadMoreControl.native.js';
import { RefreshNotice } from '../RefreshNotice.native.js';

afterEach(() => {
    cleanup();
    seen.buttons = [];
});

const rgb = (hex: string): string => {
    const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));

    return `rgb(${r}, ${g}, ${b})`;
};

describe('RefreshNotice (native) — the quiet Try again', () => {
    it('hands the failure to the button as its hint, named Try again, with an ink label and no fill', () => {
        const { container } = render(
            <RefreshNotice
                failed
                refreshing={false}
                onRetry={vi.fn()}
                labels={{ failed: 'We couldn’t refresh.', retry: 'Try again' }}
            />,
        );
        const button = seen.buttons.at(-1);

        expect(button?.['accessibilityLabel']).toBe('Try again');
        expect(button?.['accessibilityHint']).toBe('We couldn’t refresh.');
        expect(getComputedStyle(screen.getByText('Try again')).color).toBe(rgb(role.ink));
        // The retry glyph, in actionText: the cue that a text-only control is pressable (the hairline it replaces).
        const glyph = container.querySelector<HTMLElement>('[data-commise-stub="icon"]');

        expect(glyph?.dataset['iconName']).toBe('refresh-cw');
        expect(glyph?.dataset['iconColor']).toBe(role.actionText);
    });
});

describe('LoadMoreControl (native) — the quiet Try again', () => {
    const labels = { loadMore: 'Load more', loadingMore: 'Loading…', retry: 'Try again', failed: 'No more for now.' };

    it('hints the failure only while it is shown, and draws no tonal pill', () => {
        const { container, rerender } = render(
            <LoadMoreControl hasMore loading={false} failed onLoadMore={vi.fn()} labels={labels} />,
        );

        expect(seen.buttons.at(-1)?.['accessibilityHint']).toBe('No more for now.');
        expect(container.querySelector<HTMLElement>('[data-commise-stub="icon"]')?.dataset['iconName']).toBe(
            'refresh-cw',
        );

        rerender(<LoadMoreControl hasMore loading failed onLoadMore={vi.fn()} labels={labels} />);
        expect(seen.buttons.at(-1)?.['accessibilityHint']).toBeUndefined();

        rerender(<LoadMoreControl hasMore loading={false} failed={false} onLoadMore={vi.fn()} labels={labels} />);
        expect(seen.buttons.at(-1)?.['accessibilityHint']).toBeUndefined();
        // REWRITTEN for `componentFixes` issue 2: the idle Load more is an actionText label (it was ink), so it reads as
        // pressable; only Try again keeps the ink label.
        expect(getComputedStyle(screen.getByText('Load more')).color).toBe(rgb(role.actionText));
    });
});
