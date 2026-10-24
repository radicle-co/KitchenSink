/**
 * UnreadableWorkNotice (native), the twin of `UnreadableWorkNotice.test.tsx` (react-native-web under jsdom).
 *
 * ⛔ UNLIKE `SyncNotice.native` THIS ONE SPEAKS: a loss is not reassurance. A POLITE `LiveRegion` mounted empty says it;
 * nothing is assertive, because the cook did not just act. Native moves no focus on Dismiss (React Native cannot read
 * where the reading cursor is, and the platform re-anchors when a focused node goes).
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { UnreadableWorkNoticeProps } from '../props.js';
import { UnreadableWorkNotice } from '../UnreadableWorkNotice.native.js';

afterEach(cleanup);

const text = {
    title: 'Some work on this device couldn’t be opened',
    body: 'We can’t show it or send it, and it can’t be recovered.',
    dismissLabel: 'Dismiss',
};

function notice(over: Partial<UnreadableWorkNoticeProps> = {}): ReactElement {
    return <UnreadableWorkNotice shown={false} onDismiss={vi.fn()} {...text} {...over} />;
}

describe('UnreadableWorkNotice (native)', () => {
    it('hidden: no card, no control, and nothing visible', () => {
        const { container } = render(notice());

        expect(screen.queryByRole('button')).toBeNull();
        expect(screen.queryByText(text.title)).toBeNull();
        expect(container.querySelector('[aria-live="assertive"]')).toBeNull();
    });

    it('shown: the title, the body and Dismiss', () => {
        render(notice({ shown: true }));

        expect(screen.getAllByText(text.title).length).toBeGreaterThan(0);
        expect(screen.getByText(text.body)).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Dismiss' })).toBeTruthy();
    });

    it('⛔ announces politely through a region that was mounted before the card, and never assertively', () => {
        const { container, rerender } = render(notice());
        const region = container.querySelector('[aria-live="polite"]');

        expect(region).not.toBeNull();
        expect(region?.textContent).toBe('');

        rerender(notice({ shown: true }));

        expect(container.querySelector('[aria-live="polite"]')).toBe(region);
        expect(region?.textContent).toContain(text.title);
        expect(container.querySelector('[aria-live="assertive"]')).toBeNull();
    });

    it('Dismiss calls onDismiss once', () => {
        const onDismiss = vi.fn();

        render(notice({ shown: true, onDismiss }));
        fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

        expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('the card leaves when the caller says so, and the region falls silent again', () => {
        const { container, rerender } = render(notice({ shown: true }));

        rerender(notice({ shown: false }));

        expect(screen.queryByText(text.title)).toBeNull();
        expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe('');
    });
});
