import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CookingFrame } from '../CookingFrame.js';
import { CookingNoticeSlot } from '../CookingNoticeSlot.js';
import { COOKING_COLUMN } from '../cookingLayout.js';
import { htmlElementOf } from '../__fixtures__/htmlElementOf.js';

/**
 * The full-screen surface: one centred column, the top bar first and the foot last, a container for
 * the under-360 rule, and `aria-busy` while loading. The foot holds the actions, with the Next preview above them while
 * there is one, and the frame owns the spacing between the two.
 */
describe('CookingFrame', () => {
    const frame = (busy: boolean, foot: 'none' | 'actions' | 'both' = 'both') =>
        render(
            <CookingFrame
                topBar={<button type="button">Exit</button>}
                body={<p>Body</p>}
                {...(foot === 'none'
                    ? {}
                    : {
                          foot: {
                              ...(foot === 'both' ? { preview: <p>Next · step 2</p> } : {}),
                              actions: <button type="button">Next step</button>,
                          },
                      })}
                busy={busy}
            />,
        );

    it('lays the slots out top bar, body, the preview, then the actions, in DOM order', () => {
        frame(false);

        const exit = screen.getByRole('button', { name: 'Exit' });
        const body = screen.getByText('Body');
        const preview = screen.getByText('Next · step 2');
        const next = screen.getByRole('button', { name: 'Next step' });

        expect(exit.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(body.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(preview.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('pins the preview with the actions, outside the scrolling body', () => {
        frame(false);

        const scroller = htmlElementOf(screen.getByText('Body').closest('[data-cooking-scroll]'));
        const foot = screen.getByText('Next · step 2').closest('[data-cooking-foot]');

        expect(scroller.contains(screen.getByText('Next · step 2'))).toBe(false);
        expect(foot).not.toBeNull();
        expect(foot?.contains(screen.getByRole('button', { name: 'Next step' }))).toBe(true);
    });

    it('draws the actions alone when there is no preview', () => {
        frame(false, 'actions');

        expect(screen.queryByText('Next · step 2')).toBeNull();
        expect(screen.getByRole('button', { name: 'Next step' })).toBeTruthy();
    });

    it('is the page’s main landmark and a size container', () => {
        frame(false);

        const main = screen.getByRole('main');

        // A size container, so the short-screen rule can ask the surface's height as well as its width.
        expect(main.className).toContain('[container-type:size]');
    });

    it('leaves a gap between the scrolling body and the foot, so a cut-off line reads as more to scroll', () => {
        frame(false);

        const foot = screen.getByText('Next · step 2').closest('[data-cooking-foot]');

        expect(foot).toBeInstanceOf(HTMLElement);
        expect(foot?.className).toContain('pt-3');
    });

    it('keeps the column inside 680, centred', () => {
        frame(false);

        const column = htmlElementOf(screen.getByRole('main').firstElementChild);

        expect(column.className).toContain(COOKING_COLUMN.webClassName);
        expect(column.className).toContain('mx-auto');
    });

    it('scrolls only the body, so the top bar and the nav stay pinned when the focus line is taller than the screen', () => {
        // jsdom has no layout, so the largest-text case is proven here by structure and in Playwright by geometry.
        frame(false);

        const body = screen.getByText('Body');
        const scroller = htmlElementOf(body.closest('[data-cooking-scroll]'));

        expect(scroller).not.toBeNull();
        expect(scroller.className).toContain('overflow-y-auto');
        expect(scroller.className).toContain('min-h-0');
        expect(scroller.contains(screen.getByRole('button', { name: 'Exit' }))).toBe(false);
        expect(scroller.contains(screen.getByRole('button', { name: 'Next step' }))).toBe(false);
    });

    it('marks the surface busy while loading, and only then', () => {
        const { unmount } = frame(true);
        expect(screen.getByRole('main').getAttribute('aria-busy')).toBe('true');
        unmount();

        frame(false);
        expect(screen.getByRole('main').getAttribute('aria-busy')).not.toBe('true');
    });

    it('draws no foot when none is given', () => {
        frame(false, 'none');

        expect(screen.queryByRole('button', { name: 'Next step' })).toBeNull();
    });

    describe('the notice slot', () => {
        const slotted = () =>
            render(
                <CookingNoticeSlot notice={<p>You’re offline</p>}>
                    <CookingFrame topBar={<button type="button">Exit</button>} body={<p>Body</p>} busy={false} />
                </CookingNoticeSlot>,
            );

        it('draws the notice first inside the surface, above the top bar', () => {
            slotted();

            const notice = screen.getByText('You’re offline');
            const exit = screen.getByRole('button', { name: 'Exit' });

            expect(screen.getByRole('main').contains(notice)).toBe(true);
            expect(notice.compareDocumentPosition(exit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        });

        it('draws nothing extra when no slot is provided', () => {
            frame(false, 'none');

            expect(screen.getByRole('main').firstElementChild).toBe(
                screen.getByRole('button', { name: 'Exit' }).parentElement,
            );
        });
    });
});
