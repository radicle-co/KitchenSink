/**
 * Component tests for the web {@link PhotoCarousel} (W2 Task 2.2, D2). The carousel replaces the static
 * photo grid: a scroll-snap strip of slides with a dot-navigation strip, and a Radix `Dialog` lightbox
 * (focus-trapping, Escape-dismissable) opened by activating a slide. Covers the N-slide, dot-count,
 * single-photo, no-photo, and open/close lightbox branches — every path the view can render.
 *
 * HERO PAGING (`nativeBoards/buildLists.md` item 1): paging chevrons at the sides and dots that track the page. The page is
 * read from the strip's scroll position, and a chevron scrolls the next slide into view. jsdom has no layout and no
 * `scrollIntoView`, so the suite serves a slide pitch of 400 and records the scroll a press asks for.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { makePhoto } from '../../__fixtures__/index.js';
import { PhotoCarousel } from '../PhotoCarousel.js';

afterEach(cleanup);

describe('PhotoCarousel (web)', () => {
    it('renders one slide image per photo, each with an accessible alt name', () => {
        render(
            <PhotoCarousel
                title="Grilled Lamb"
                photos={[
                    makePhoto({ id: 'pho_1', order: 1 }),
                    makePhoto({ id: 'pho_2', order: 2 }),
                    makePhoto({ id: 'pho_3', order: 3 }),
                ]}
            />,
        );

        expect(screen.getAllByRole('img')).toHaveLength(3);
        expect(screen.getByRole('img', { name: 'Grilled Lamb photo 1' })).toBeTruthy();
        expect(screen.getByRole('img', { name: 'Grilled Lamb photo 3' })).toBeTruthy();
    });

    it('renders one navigation dot per photo when there is more than one', () => {
        render(
            <PhotoCarousel
                title="Grilled Lamb"
                photos={[makePhoto({ id: 'pho_1', order: 1 }), makePhoto({ id: 'pho_2', order: 2 })]}
            />,
        );

        const dots = screen.getByRole('list', { name: 'Photo navigation' });
        expect(within(dots).getAllByRole('listitem')).toHaveLength(2);
    });

    it('omits the dot navigation for a single photo (a lone dot conveys nothing)', () => {
        render(<PhotoCarousel title="Grilled Lamb" photos={[makePhoto({ id: 'pho_1', order: 1 })]} />);

        expect(screen.getByRole('img', { name: 'Grilled Lamb photo 1' })).toBeTruthy();
        expect(screen.queryByRole('list', { name: 'Photo navigation' })).toBeNull();
    });

    it('renders nothing when the recipe has no photos', () => {
        const { container } = render(<PhotoCarousel title="Grilled Lamb" photos={[]} />);

        expect(container.firstChild).toBeNull();
    });

    it('opens the lightbox dialog when a slide is activated, and closes it on the close control', async () => {
        const user = userEvent.setup();
        render(
            <PhotoCarousel
                title="Grilled Lamb"
                photos={[makePhoto({ id: 'pho_1', order: 1 }), makePhoto({ id: 'pho_2', order: 2 })]}
            />,
        );

        expect(screen.queryByRole('dialog')).toBeNull();

        await user.click(screen.getByRole('button', { name: 'Open Grilled Lamb photo 2 full screen' }));

        const dialog = screen.getByRole('dialog');
        expect(within(dialog).getByRole('img', { name: 'Grilled Lamb photo 2' })).toBeTruthy();

        await user.click(within(dialog).getByRole('button', { name: 'Close photo' }));

        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('dismisses the lightbox on Escape (Radix focus-modal behavior)', async () => {
        const user = userEvent.setup();
        render(<PhotoCarousel title="Grilled Lamb" photos={[makePhoto({ id: 'pho_1', order: 1 })]} />);

        await user.click(screen.getByRole('button', { name: 'Open Grilled Lamb photo 1 full screen' }));
        expect(screen.getByRole('dialog')).toBeTruthy();

        await user.keyboard('{Escape}');

        expect(screen.queryByRole('dialog')).toBeNull();
    });
});

describe('PhotoCarousel (web) — touch targets (44px floor)', () => {
    it('gives the lightbox close control the full 44px target', async () => {
        const user = userEvent.setup();
        render(<PhotoCarousel title="Grilled Lamb" photos={[makePhoto({ id: 'pho_1', order: 1 })]} />);

        await user.click(screen.getByRole('button', { name: 'Open Grilled Lamb photo 1 full screen' }));
        const close = within(screen.getByRole('dialog')).getByRole('button', { name: 'Close photo' });

        // `size-10` (40px) misses the floor; the overlay control is touch-only chrome so it stays 44px
        // everywhere (there is no desktop-density reason to shrink it).
        expect(close.className).toContain('size-11');
        expect(close.className).not.toContain('size-10');
    });

    it('wraps each 10px navigation dot in a 44px touch target, reset for the mouse at sm', () => {
        render(
            <PhotoCarousel
                title="Grilled Lamb"
                photos={[makePhoto({ id: 'pho_1', order: 1 }), makePhoto({ id: 'pho_2', order: 2 })]}
            />,
        );
        const dot = screen.getByRole('link', { name: 'Go to Grilled Lamb photo 1' });

        // The DOT stays visually 10px; the hit area around it is what grows — so the strip still reads as
        // dots while being tappable.
        expect(dot.className).toContain('size-11');
        expect(dot.className).toContain('sm:size-4');
        expect(dot.querySelector('[class*="size-2.5"]')).not.toBeNull();
    });
});

describe('PhotoCarousel (web) — paging chevrons and tracking dots', () => {
    const photos = [
        makePhoto({ id: 'pho_1', order: 1 }),
        makePhoto({ id: 'pho_2', order: 2 }),
        makePhoto({ id: 'pho_3', order: 3 }),
    ];
    const scrollIntoView = vi.fn();

    /** The strip's slides sit 400 apart, as a 388 wide slide and a 12 gap would. */
    function layOut(): void {
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
            value: scrollIntoView,
            configurable: true,
            writable: true,
        });
        Object.defineProperty(HTMLElement.prototype, 'offsetLeft', {
            configurable: true,
            get(this: HTMLElement) {
                return (Number(this.id.replace('recipe-photo-pho_', '')) - 1) * 400 || 0;
            },
        });
    }

    afterEach(() => {
        scrollIntoView.mockReset();
        Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
        Reflect.deleteProperty(HTMLElement.prototype, 'offsetLeft');
    });

    const dot = (index: number): HTMLElement => screen.getByRole('link', { name: `Go to Grilled Lamb photo ${index}` });

    /** Settle the strip at `scrollLeft`. */
    function scrollTo(scrollLeft: number): void {
        const strip = screen.getAllByRole('listitem')[0]?.parentElement as HTMLElement;

        fireEvent.scroll(strip, { target: { scrollLeft } });
    }

    it('opens on the first photo: Next is drawn, Previous is not, and the first dot is the current one', () => {
        layOut();
        render(<PhotoCarousel title="Grilled Lamb" photos={photos} />);

        expect(screen.getByRole('button', { name: 'Next Grilled Lamb photo' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Previous Grilled Lamb photo' })).toBeNull();
        expect(dot(1).getAttribute('aria-current')).toBe('true');
        expect(dot(2).getAttribute('aria-current')).toBeNull();
    });

    it('draws no chevron for a single photo', () => {
        render(<PhotoCarousel title="Grilled Lamb" photos={[photos[0] as (typeof photos)[number]]} />);

        expect(screen.queryByRole('button', { name: 'Next Grilled Lamb photo' })).toBeNull();
    });

    it('scrolls the next slide into view on Next, without scrolling the page, and moves the dot', () => {
        layOut();
        render(<PhotoCarousel title="Grilled Lamb" photos={photos} />);

        fireEvent.click(screen.getByRole('button', { name: 'Next Grilled Lamb photo' }));

        expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        expect(scrollIntoView.mock.contexts[0]).toBe(document.getElementById('recipe-photo-pho_2'));
        expect(dot(2).getAttribute('aria-current')).toBe('true');
        expect(screen.getByRole('button', { name: 'Previous Grilled Lamb photo' })).toBeTruthy();
    });

    it('scrolls back one slide on Previous', () => {
        layOut();
        render(<PhotoCarousel title="Grilled Lamb" photos={photos} />);
        fireEvent.click(screen.getByRole('button', { name: 'Next Grilled Lamb photo' }));
        scrollIntoView.mockClear();

        fireEvent.click(screen.getByRole('button', { name: 'Previous Grilled Lamb photo' }));

        expect(scrollIntoView.mock.contexts[0]).toBe(document.getElementById('recipe-photo-pho_1'));
        expect(dot(1).getAttribute('aria-current')).toBe('true');
    });

    it('draws no Next on the last photo', () => {
        layOut();
        render(<PhotoCarousel title="Grilled Lamb" photos={photos} />);
        fireEvent.click(screen.getByRole('button', { name: 'Next Grilled Lamb photo' }));
        fireEvent.click(screen.getByRole('button', { name: 'Next Grilled Lamb photo' }));

        expect(screen.queryByRole('button', { name: 'Next Grilled Lamb photo' })).toBeNull();
        expect(dot(3).getAttribute('aria-current')).toBe('true');
    });

    it('follows a swipe: the dot and the chevrons move to the slide the strip rests on', () => {
        layOut();
        render(<PhotoCarousel title="Grilled Lamb" photos={photos} />);

        scrollTo(800);

        expect(dot(3).getAttribute('aria-current')).toBe('true');
        expect(screen.queryByRole('button', { name: 'Next Grilled Lamb photo' })).toBeNull();
    });

    it('rounds up a scroll past the midpoint of a slide', () => {
        layOut();
        render(<PhotoCarousel title="Grilled Lamb" photos={photos} />);

        scrollTo(400 + 250);

        expect(dot(3).getAttribute('aria-current')).toBe('true');
    });

    it('stays on the last photo for a scroll past the end', () => {
        layOut();
        render(<PhotoCarousel title="Grilled Lamb" photos={photos} />);

        scrollTo(5000);

        expect(dot(3).getAttribute('aria-current')).toBe('true');
    });

    it('rounds a scroll between two slides to the nearer one', () => {
        layOut();
        render(<PhotoCarousel title="Grilled Lamb" photos={photos} />);

        scrollTo(400 + 150);

        expect(dot(2).getAttribute('aria-current')).toBe('true');
    });
});
