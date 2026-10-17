/**
 * UnreadableWorkNotice (web), written from `specSharedSystem.md` §17.
 *
 * ⛔ DISMISSIBLE, unlike `SyncNotice`: a set-aside is a past event, so a card with no Dismiss would stay forever. ⛔ Its
 * `status` region is mounted EMPTY so the card's arrival is spoken politely, and after Dismiss focus lands on that
 * region rather than falling to `<body>` (WCAG 2.2 SC 2.4.3).
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { UnreadableWorkNoticeProps } from '../props.js';
import { UnreadableWorkNotice } from '../UnreadableWorkNotice.js';

afterEach(cleanup);

const text = {
    title: 'Some work on this device couldn’t be opened',
    body: 'We can’t show it or send it, and it can’t be recovered.',
    dismissLabel: 'Dismiss',
};

function notice(over: Partial<UnreadableWorkNoticeProps> = {}): ReactElement {
    return <UnreadableWorkNotice shown={false} onDismiss={vi.fn()} {...text} {...over} />;
}

/** A caller that hides the card in the same event as the press, as `SyncNoticeHost` does. */
function Host({ withSearch = false }: { readonly withSearch?: boolean }): ReactElement {
    const [shown, setShown] = useState(true);

    return (
        <>
            <UnreadableWorkNotice shown={shown} onDismiss={() => setShown(false)} {...text} />
            {withSearch && <input aria-label="Search" />}
        </>
    );
}

describe('UnreadableWorkNotice (web)', () => {
    it('hidden: an empty status region and no card, no control', () => {
        render(notice());

        expect(screen.getByRole('status').textContent).toBe('');
        expect(screen.queryByRole('button')).toBeNull();
    });

    it('⛔ shown: the title, the body and Dismiss arrive INSIDE the already-mounted polite status region', () => {
        const { rerender } = render(notice());
        const region = screen.getByRole('status');

        rerender(notice({ shown: true }));

        expect(screen.getByRole('status')).toBe(region);
        expect(region.textContent).toContain(text.title);
        expect(region.textContent).toContain(text.body);
        expect(region.getAttribute('aria-live')).not.toBe('assertive');
        expect(screen.getByRole('button', { name: 'Dismiss' })).toBeTruthy();
    });

    it('Dismiss calls onDismiss once', () => {
        const onDismiss = vi.fn();

        render(notice({ shown: true, onDismiss }));
        fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

        expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('⛔ after Dismiss the card goes and focus lands on the status region, not on <body>', () => {
        render(<Host />);
        const button = screen.getByRole('button', { name: 'Dismiss' });

        button.focus();
        fireEvent.click(button);

        expect(screen.queryByRole('button')).toBeNull();
        expect(document.activeElement).toBe(screen.getByRole('status'));
        expect(screen.getByRole('status').getAttribute('tabindex')).toBe('-1');
    });

    it('⛔ never takes focus when the card merely arrives or leaves without a Dismiss', () => {
        const { rerender } = render(notice());

        rerender(notice({ shown: true }));
        expect(document.activeElement).toBe(document.body);

        rerender(notice({ shown: false }));
        expect(document.activeElement).toBe(document.body);
    });

    it('does not pull focus from where the cook put it', () => {
        render(<Host withSearch />);
        const search = screen.getByLabelText('Search');

        // The press moves focus to the button; the cook then clicks into Search before the card is gone.
        search.focus();
        fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

        expect(document.activeElement).toBe(search);
    });
});
