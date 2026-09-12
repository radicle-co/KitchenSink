/**
 * Native component tests for the {@link PhotoCarousel} leaf (W2 Task 2.2, D2), rendered via
 * react-native-web under jsdom. Mirrors the web carousel's branches — N slides, dot count, single-photo,
 * no-photo, and open/close of the Modal lightbox — so the two platform renders can't drift. RN elements are
 * queried by their `accessibilityLabel` (there is no stable role for an RN `Image`).
 *
 * ⚠️ REWRITTEN for `docs/design/compactHeightLayout.md` §8. A slide used to be the WINDOW's width inside a strip
 * 32 dp (and the side insets) narrower, so paging drifted by that much per slide, upright as well as sideways; and at
 * 4:3 of a sideways window a slide was taller than the screen. The strip now takes its width from its own layout and
 * renders its slides once that is known, so these tests lay the strip out first. react-native-web reports layout
 * through a `ResizeObserver` and each node's `offsetWidth`, neither of which jsdom has, so this file records the
 * observer and serves the width. The window's height comes from react-native-web's `Dimensions`, which reads the root
 * element on a window resize.
 *
 * The lightbox is drawn edge to edge, so its Close and its photo sit inside the safe area: this file serves a sideways
 * phone's insets (a 3-button navigation bar on the right).
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, type ComponentProps } from 'react';
import type { Modal as ModalType } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makePhoto } from '../../__fixtures__/index.js';
import { PhotoCarousel } from '../PhotoCarousel.native.js';

/** The one `ResizeObserver` react-native-web creates, recorded so a test can report layout through it. */
const observer = vi.hoisted(() => {
    const recorded = { callback: undefined as ResizeObserverCallback | undefined, observed: new Set<Element>() };

    globalThis.ResizeObserver = class {
        public constructor(callback: ResizeObserverCallback) {
            recorded.callback = callback;
        }

        public observe(target: Element): void {
            recorded.observed.add(target);
        }

        public unobserve(target: Element): void {
            recorded.observed.delete(target);
        }

        public disconnect(): void {
            recorded.observed.clear();
        }
    } as unknown as typeof ResizeObserver;

    return recorded;
});

const state = vi.hoisted(() => ({ modal: undefined as ComponentProps<typeof ModalType> | undefined }));

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        Modal: (props: ComponentProps<typeof ModalType>) => {
            state.modal = props;

            return createElement(actual.Modal, props);
        },
    };
});
vi.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, right: 48, bottom: 21, left: 0 }),
}));

beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    state.modal = undefined;
    Reflect.deleteProperty(document.documentElement, 'clientHeight');
    act(() => {
        window.dispatchEvent(new Event('resize'));
    });
});

/**
 * The value react-native-web applied for a CSS property: `StyleSheet.create` styles compile to atomic `r-*` classes
 * (walked back to their rules, since jsdom's `getComputedStyle` does not resolve them), and per-render styles land
 * inline.
 */
function appliedStyle(element: Element, property: string): string | undefined {
    const inline = (element as HTMLElement).style.getPropertyValue(property);

    if (inline !== '') {
        return inline;
    }

    let resolved: string | undefined;

    for (const className of element.className.split(' ').filter((name) => name.startsWith('r-'))) {
        for (const sheet of Array.from(document.styleSheets)) {
            for (const rule of Array.from(sheet.cssRules)) {
                if (rule instanceof CSSStyleRule && rule.selectorText === `.${className}`) {
                    resolved = rule.style.getPropertyValue(property) || resolved;
                }
            }
        }
    }

    return resolved;
}

/** Resize the window: react-native-web's `Dimensions` reads the root element's height on a resize event. */
function windowHeight(height: number): void {
    Object.defineProperty(document.documentElement, 'clientHeight', { value: height, configurable: true });
    act(() => {
        window.dispatchEvent(new Event('resize'));
    });
}

/** Lay the strip out at `width`: the carousel's container is the node labelled "Recipe photos". */
function layOutStrip(width: number): void {
    const container = screen.getByLabelText('Recipe photos');

    Object.defineProperty(container, 'offsetWidth', { value: width, configurable: true });
    act(() => {
        observer.callback?.(
            [...observer.observed].map((target) => ({ target }) as unknown as ResizeObserverEntry),
            {} as ResizeObserver,
        );
    });
    act(() => {
        vi.runOnlyPendingTimers();
    });
}

const twoPhotos = [makePhoto({ id: 'pho_1', order: 1 }), makePhoto({ id: 'pho_2', order: 2 })];

describe('PhotoCarousel (native)', () => {
    it('renders one slide image per photo, each with an accessible alt label', () => {
        windowHeight(851);
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
        layOutStrip(361);

        expect(screen.getByLabelText('Grilled Lamb photo 1')).toBeTruthy();
        expect(screen.getByLabelText('Grilled Lamb photo 3')).toBeTruthy();
    });

    it('renders one navigation dot per photo when there is more than one', () => {
        render(<PhotoCarousel title="Grilled Lamb" photos={twoPhotos} />);

        expect(screen.getByLabelText('Photo navigation')).toBeTruthy();
        expect(screen.getAllByLabelText(/^Go to Grilled Lamb photo/)).toHaveLength(2);
    });

    it('omits the dot navigation for a single photo', () => {
        windowHeight(851);
        render(<PhotoCarousel title="Grilled Lamb" photos={[makePhoto({ id: 'pho_1', order: 1 })]} />);
        layOutStrip(361);

        expect(screen.getByLabelText('Grilled Lamb photo 1')).toBeTruthy();
        expect(screen.queryByLabelText('Photo navigation')).toBeNull();
    });

    it('renders nothing when the recipe has no photos', () => {
        const { container } = render(<PhotoCarousel title="Grilled Lamb" photos={[]} />);

        expect(container.firstChild).toBeNull();
    });

    it('draws no slide before it knows how wide its strip is', () => {
        render(<PhotoCarousel title="Grilled Lamb" photos={twoPhotos} />);

        expect(screen.queryByLabelText('Grilled Lamb photo 1')).toBeNull();
        expect(screen.getByLabelText('Recipe photos')).toBeTruthy();
    });

    describe('slide size (compactHeightLayout.md §8)', () => {
        /** A slide's box: the pressable that opens it. */
        const slide = (index: number): Element => screen.getByLabelText(`Open Grilled Lamb photo ${index} full screen`);

        it('is 4:3 at the STRIP’s width, not the window’s, so paging lands on each photo', () => {
            windowHeight(851);
            render(<PhotoCarousel title="Grilled Lamb" photos={twoPhotos} />);
            layOutStrip(361);

            expect(appliedStyle(slide(1), 'width')).toBe('361px');
            expect(appliedStyle(slide(1), 'height')).toBe('271px');
            expect(appliedStyle(slide(2), 'width')).toBe('361px');
        });

        it('sideways, is capped at 40% of the window’s height and narrowed to keep 4:3, centred', () => {
            windowHeight(393);
            render(<PhotoCarousel title="Grilled Lamb" photos={twoPhotos} />);
            layOutStrip(771);

            expect(appliedStyle(slide(1), 'width')).toBe('209px');
            expect(appliedStyle(slide(1), 'height')).toBe('157px');
            // The paging strip — the horizontal ScrollView, which react-native-web draws as the element that scrolls on
            // x — is exactly one slide wide, so a page is a photo.
            const strip = slide(1).closest('[class*="r-overflowX"]') as Element;

            expect(appliedStyle(strip, 'width')).toBe('209px');
        });
    });

    describe('the lightbox', () => {
        async function openLightbox(): Promise<ReturnType<typeof userEvent.setup>> {
            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

            windowHeight(851);
            render(<PhotoCarousel title="Grilled Lamb" photos={twoPhotos} />);
            layOutStrip(361);
            await user.click(screen.getByLabelText('Open Grilled Lamb photo 2 full screen'));

            return user;
        }

        it('opens on a slide, and closes on its Close control', async () => {
            const user = await openLightbox();

            expect(screen.getByLabelText('Close photo')).toBeTruthy();

            await user.click(screen.getByLabelText('Close photo'));

            expect(screen.queryByLabelText('Close photo')).toBeNull();
        });

        it('is drawn edge to edge, so the safe-area insets it pads by are the real ones', async () => {
            await openLightbox();

            expect(state.modal).toMatchObject({ statusBarTranslucent: true, navigationBarTranslucent: true });
        });

        it('gives Close a 48 dp square inside the safe area, clear of a side navigation bar', async () => {
            await openLightbox();

            const close = screen.getByLabelText('Close photo');

            expect(appliedStyle(close, 'width')).toBe('48px');
            expect(appliedStyle(close, 'height')).toBe('48px');
            expect(appliedStyle(close, 'top')).toBe('8px');
            expect(appliedStyle(close, 'right')).toBe('56px');
        });

        it('keeps the photo inside the safe area too', async () => {
            await openLightbox();

            // The slide's image and the lightbox's share the alt text; the lightbox, portalled last, is the last one.
            const lightboxPhoto = screen.getAllByLabelText('Grilled Lamb photo 2').at(-1) as Element;
            const box = lightboxPhoto.parentElement as Element;

            expect(appliedStyle(box, 'padding-right')).toBe('48px');
            expect(appliedStyle(box, 'padding-bottom')).toBe('21px');
        });
    });
});
