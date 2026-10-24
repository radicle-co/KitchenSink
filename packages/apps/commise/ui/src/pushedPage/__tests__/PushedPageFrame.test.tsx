/**
 * The web PushedPageFrame (`docs/design/uiRefreshWorkshop5/pinnedBackBar.md` §5, §6, §7): below 840 the same pinned bar as
 * native, over the document's scroll. It mounts a nested `ScrollHost` with the page's `headingId` and the bar's height as
 * `topInset`, because the app shell's host has no `headingId` and so never reports `condensed`. Back is in the bar at every
 * scroll position and in every state; exactly ONE element carries the name "Back to {parent}" (counted with `hidden: true`:
 * from 840 the header's eyebrow shows it and the bar is `nav:hidden`, and CSS-hidden copies leave the tree, which jsdom
 * cannot see); Back comes before the H1 in DOM order.
 *
 * jsdom applies no stylesheet, so the frame is asserted by the classes and attributes it sets.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

import { PushedPageFrame } from '../PushedPageFrame.js';
import { PinnedBarSlotContext } from '../pinnedBarSlot.js';

type ObserverCallback = (entries: readonly Partial<IntersectionObserverEntry>[]) => void;

const observers: { callback: ObserverCallback; options?: IntersectionObserverInit; target?: Element }[] = [];

beforeEach(() => {
    observers.length = 0;
    vi.stubGlobal(
        'IntersectionObserver',
        class {
            private readonly record: {
                callback: ObserverCallback;
                options?: IntersectionObserverInit;
                target?: Element;
            };

            constructor(callback: ObserverCallback, options?: IntersectionObserverInit) {
                this.record = { callback, ...(options === undefined ? {} : { options }) };
                observers.push(this.record);
            }

            observe(target: Element): void {
                this.record.target = target;
            }

            disconnect(): void {}
        },
    );
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
        callback(0);

        return 0;
    });
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
});

const BACK = { label: 'Back to Profile', parent: 'Profile', href: '/en/profile', onPress: () => undefined };

const renderPage = (props: { title?: string; onPress?: () => void } = {}) =>
    render(
        <PushedPageFrame
            back={{ ...BACK, ...(props.onPress === undefined ? {} : { onPress: props.onPress }) }}
            headingId="page-title"
            {...(props.title === undefined ? {} : { title: props.title })}
        >
            {() => <h1 id="page-title">Profile settings</h1>}
        </PushedPageFrame>,
    );

const scrollTo = (y: number): void => {
    act(() => {
        Object.defineProperty(window, 'scrollY', { configurable: true, value: y });
        window.dispatchEvent(new Event('scroll'));
    });
};

/** The bar's one-line title (the bar's Back also draws the parent's name, so the text alone is ambiguous). */
const barTitle = (container: HTMLElement): HTMLElement => container.querySelector('[data-condensed] p') as HTMLElement;

const material = (container: HTMLElement): string | null =>
    container.querySelector('[data-material]')?.getAttribute('data-material') ?? null;

describe('PushedPageFrame (web) — the content inset', () => {
    it('hands the page no inset: <main> owns the bar’s room on web', () => {
        let received: unknown;

        render(
            <PushedPageFrame back={BACK} headingId="page-title">
                {(_bind, inset) => {
                    received = inset;

                    return <h1 id="page-title">Page</h1>;
                }}
            </PushedPageFrame>,
        );

        expect(received).toEqual({ paddingTop: 0 });
    });
});

describe('PushedPageFrame (web)', () => {
    it('marks the page so the document keeps focused controls clear of the bar below 840', () => {
        const { container } = renderPage({ title: 'Profile' });

        expect(container.querySelector('[data-pushed-page]')).not.toBeNull();
    });

    it('adds no top padding of its own: <main> takes the bar’s height, so the notice above the page sits under the bar', () => {
        renderPage({ title: 'Profile' });
        const content = screen.getByRole('heading', { name: 'Profile settings' }).parentElement as HTMLElement;

        expect(content.className).not.toMatch(/(^|\s)(\S+:)?pt-/u);
    });

    it('watches the H1 from under the bar before the bar is measured: the host starts from the bar’s height', () => {
        renderPage({ title: 'Profile' });
        const watch = observers.find((observer) => observer.target?.id === 'page-title');

        expect(watch?.options?.rootMargin).toBe('-56px 0px 0px 0px');
    });

    it('watches the H1 from under the bar AS RENDERED: a notched phone’s bar is taller than 56', () => {
        // The bar is 3.5rem plus `env(safe-area-inset-top)`; only the browser can resolve the second term.
        const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
            this: Element,
        ): DOMRect {
            return { height: this.hasAttribute('data-condensed') ? 103 : 0 } as DOMRect;
        });
        renderPage({ title: 'Profile' });
        const watches = observers.filter((observer) => observer.target?.id === 'page-title');

        expect(watches.at(-1)?.options?.rootMargin).toBe('-103px 0px 0px 0px');
        rect.mockRestore();
    });

    it('draws the bar in the shell’s slot, ahead of the shell’s own notice, when the shell offers one', () => {
        const slot = document.createElement('div');
        document.body.append(slot);
        const { container } = render(
            <PinnedBarSlotContext value={slot}>
                <PushedPageFrame back={BACK} headingId="page-title" title="Profile">
                    {() => <h1 id="page-title">Profile settings</h1>}
                </PushedPageFrame>
            </PinnedBarSlotContext>,
        );

        expect(slot.querySelector('[data-condensed]')).not.toBeNull();
        expect(container.querySelector('[data-condensed]')).toBeNull();
        expect(screen.getAllByRole('link', { name: 'Back to Profile', hidden: true })).toHaveLength(1);
        slot.remove();
    });

    it('top of the page: Back, no material, no title', () => {
        const { container } = renderPage({ title: 'Profile' });

        expect(material(container)).toBe('none');
        expect(barTitle(container).className).toContain('opacity-0');
    });

    it.each([0, 10, 400, 3000])('has exactly one Back at scroll position %d', (y) => {
        renderPage({ title: 'Profile' });

        scrollTo(y);

        expect(screen.getAllByRole('link', { name: 'Back to Profile', hidden: true })).toHaveLength(1);
    });

    it('scrolled with the H1 still visible: material on, title off', () => {
        const { container } = renderPage({ title: 'Profile' });

        scrollTo(10);

        expect(material(container)).toBe('bar');
        expect(barTitle(container).className).toContain('opacity-0');
    });

    it('the H1 under the bar: material on and the title shows, hidden from assistive tech', () => {
        const { container } = renderPage({ title: 'Profile' });
        const watch = observers.find((observer) => observer.target?.id === 'page-title');

        scrollTo(300);
        act(() => watch?.callback([{ isIntersecting: false, boundingClientRect: { top: 20 } as DOMRectReadOnly }]));

        expect(material(container)).toBe('bar');
        expect(barTitle(container).className).toContain('opacity-100');
        expect(barTitle(container).getAttribute('aria-hidden')).toBe('true');
    });

    it('a page that does not scroll stays in the top-of-page look', () => {
        const { container } = renderPage({ title: 'Profile' });

        expect(material(container)).toBe('none');
    });

    it('loading: Back with no title', () => {
        const { container } = render(
            <PushedPageFrame back={BACK} headingId="page-title">
                {() => <p>Loading</p>}
            </PushedPageFrame>,
        );

        expect(screen.getAllByRole('link', { name: 'Back to Profile', hidden: true })).toHaveLength(1);
        expect(container.querySelector('[data-condensed] p')).toBeNull();
    });

    it('calls the page’s back, and keeps the link’s address for a modified click', () => {
        const onPress = vi.fn();
        renderPage({ title: 'Profile', onPress });
        const back = screen.getByRole('link', { name: 'Back to Profile' });

        fireEvent.click(back);

        expect(onPress).toHaveBeenCalledOnce();
        expect(back.getAttribute('href')).toBe('/en/profile');
    });

    it('puts Back before the H1 in DOM order, so the reading order matches the screen', () => {
        renderPage({ title: 'Profile' });
        const back = screen.getByRole('link', { name: 'Back to Profile' });
        const heading = screen.getByRole('heading', { name: 'Profile settings' });

        expect(back.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
});
