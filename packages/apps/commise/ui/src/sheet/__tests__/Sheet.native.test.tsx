/**
 * Sheet (native) — the design-system sheet over React Native's `Modal`, bottom-anchored
 * (`docs/design/ingredientSpecialization.md` §S8.1).
 *
 * Covers every state and rule the spec names for native: closed; open, named and modal; every close route (Close,
 * Android back through `onRequestClose` — Escape under react-native-web — and the scrim); screen-reader focus to the
 * title when the Modal shows; the device insets on all four edges; the width cap, the corner radius and the scrim
 * tint; the motion under reduce motion; and the collapse, which on native is an open keyboard in a sheet that HAS a
 * toolbar (such a sheet holds no other text input, so focus is not read).
 *
 * ⚠️ `sendAccessibilityEvent` is mocked because react-native-web does not implement it; `useKeyboardShown`,
 * `useReduceMotion` and the safe-area insets are mocked because their platforms do not exist under jsdom. The
 * on-device proof is the Maestro flow.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement, type ComponentProps } from 'react';
import { AccessibilityInfo, Text, type Modal as ModalType } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { palette, tint } from '../../tokens/colors.js';
import { radius } from '../../tokens/scale.js';
import type { SheetProps } from '../props.js';
import { SHEET_EDGE_PADDING_DP, SHEET_MAX_WIDTH_DP } from '../sheetPresentation.js';
import { Sheet } from '../Sheet.native.js';

const state = vi.hoisted(() => ({
    keyboardShown: false,
    reduceMotion: undefined as boolean | undefined,
    // A DISTINCT value per edge, so an assertion cannot pass on the wrong inset added to the wrong edge.
    insets: { top: 24, right: 6, bottom: 16, left: 4 },
    modal: undefined as ComponentProps<typeof ModalType> | undefined,
}));

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: vi.fn() },
        // The real Modal, with the props it was given recorded: its motion and window flags are the contract.
        // `onShow` is held back, so a test fires it itself: focus that moved WITHOUT it came from somewhere else.
        Modal: (props: ComponentProps<typeof ModalType>) => {
            state.modal = props;

            return createElement(actual.Modal, { ...props, onShow: undefined });
        },
    };
});
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => state.insets }));
vi.mock('../useKeyboardShown.native.js', () => ({ useKeyboardShown: () => state.keyboardShown }));
vi.mock('../../motion/useReduceMotion.native.js', () => ({ useReduceMotion: () => state.reduceMotion }));

beforeEach(() => {
    state.keyboardShown = false;
    state.reduceMotion = undefined;
    vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();
});

afterEach(cleanup);

/**
 * The value react-native-web applied for a CSS property: `StyleSheet.create` styles compile to atomic `r-*` classes
 * (walked back to their rules, since `getComputedStyle` does not resolve them), and per-render styles land inline.
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

function renderSheet(overrides: Partial<SheetProps> = {}): { readonly onOpenChange: ReturnType<typeof vi.fn> } {
    const onOpenChange = vi.fn();

    render(
        <Sheet
            open
            onOpenChange={onOpenChange}
            title="Filter recipes"
            closeLabel="Close filters"
            size="content"
            footer={<Text accessibilityRole="button">Done</Text>}
            {...overrides}
        >
            <Text>Dietary</Text>
        </Sheet>,
    );

    return { onOpenChange };
}

// react-native-web's Modal renders an unnamed dialog of its own around the content; the Sheet's is the named one.
const dialog = (): HTMLElement => screen.getByRole('dialog', { name: 'Filter recipes' });

/** The dimmed window behind the sheet: the dialog sits in the keyboard-avoiding layer, inside it. */
const backdrop = (): Element => dialog().parentElement?.parentElement as Element;

/** The scrim: the backdrop's first child, behind the keyboard-avoiding layer. */
const scrim = (): Element => backdrop().firstElementChild as Element;

describe('Sheet (native)', () => {
    it('renders nothing while closed', () => {
        renderSheet({ open: false });

        expect(screen.queryByRole('dialog', { name: 'Filter recipes' })).toBeNull();
    });

    it('is a modal dialog named by its title, with the title as a header', () => {
        renderSheet();

        expect(screen.getByRole('dialog', { name: 'Filter recipes' }).getAttribute('aria-modal')).toBe('true');
        expect(screen.getByRole('heading', { name: 'Filter recipes' })).toBeDefined();
    });

    it('closes through Close, named by closeLabel and at least 48 dp square', () => {
        const { onOpenChange } = renderSheet();
        const close = screen.getByRole('button', { name: 'Close filters' });

        expect(appliedStyle(close, 'min-width')).toBe('48px');
        expect(appliedStyle(close, 'min-height')).toBe('48px');

        fireEvent.click(close);

        expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('closes through the platform back route (onRequestClose; Escape under react-native-web)', () => {
        const { onOpenChange } = renderSheet();

        fireEvent.keyUp(document, { key: 'Escape' });

        expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('closes through a tap on the scrim, which is not an accessibility element', () => {
        const { onOpenChange } = renderSheet();
        expect(scrim().getAttribute('aria-hidden')).toBe('true');
        fireEvent.click(scrim());

        expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('moves screen-reader focus to the title when the Modal shows, and on every reopen', () => {
        const onOpenChange = vi.fn();
        const sheet = (open: boolean) => (
            <Sheet
                open={open}
                onOpenChange={onOpenChange}
                title="Filter recipes"
                closeLabel="Close filters"
                size="content"
            >
                <Text>Dietary</Text>
            </Sheet>
        );
        const { rerender } = render(sheet(true));
        const shows = (): void => act(() => state.modal?.onShow?.({} as never));

        // Not on mount: a mount effect runs before the Modal is on screen (§S8.1).
        expect(AccessibilityInfo.sendAccessibilityEvent).not.toHaveBeenCalled();

        shows();
        expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledTimes(1);
        expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenLastCalledWith(
            screen.getByRole('heading', { name: 'Filter recipes' }),
            'focus',
        );

        act(() => rerender(sheet(false)));
        act(() => rerender(sheet(true)));
        shows();

        expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledTimes(2);
        expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenLastCalledWith(
            screen.getByRole('heading', { name: 'Filter recipes' }),
            'focus',
        );
    });

    describe('insets', () => {
        it('stops the sheet at the top inset', () => {
            renderSheet();

            expect(appliedStyle(backdrop(), 'padding-top')).toBe(`${state.insets.top}px`);
        });

        it('pads the whole sheet by the side insets, for a camera cutout', () => {
            renderSheet();

            expect(appliedStyle(dialog(), 'padding-left')).toBe(`${state.insets.left}px`);
            expect(appliedStyle(dialog(), 'padding-right')).toBe(`${state.insets.right}px`);
        });

        it('pads the footer by the bottom inset, so Done clears the navigation bar', () => {
            renderSheet();

            const footer = screen.getByRole('button', { name: 'Done' }).parentElement as Element;

            expect(appliedStyle(footer, 'padding-bottom')).toBe(`${SHEET_EDGE_PADDING_DP + state.insets.bottom}px`);
        });

        it('drops the bottom inset while a keyboard is open: the keyboard, not the navigation bar, is below', () => {
            state.keyboardShown = true;
            renderSheet();

            const footer = screen.getByRole('button', { name: 'Done' }).parentElement as Element;

            expect(appliedStyle(footer, 'padding-bottom')).toBe(`${SHEET_EDGE_PADDING_DP}px`);
        });

        it('pads the end of the scroll region by the bottom inset when there is no footer', () => {
            renderSheet({ footer: undefined });

            const content = screen.getByText('Dietary').parentElement as Element;

            expect(appliedStyle(content, 'padding-bottom')).toBe(`${SHEET_EDGE_PADDING_DP + state.insets.bottom}px`);
        });
    });

    describe('geometry and motion', () => {
        /** Resize the window: react-native-web's `Dimensions` reads the root element's width on a resize event. */
        function windowWidth(width: number): void {
            Object.defineProperty(document.documentElement, 'clientWidth', { value: width, configurable: true });
            act(() => {
                window.dispatchEvent(new Event('resize'));
            });
        }

        afterEach(() => {
            Reflect.deleteProperty(document.documentElement, 'clientWidth');
            act(() => {
                window.dispatchEvent(new Event('resize'));
            });
        });

        it('spans the full width below 600 dp and caps at 560 dp from 600 dp', () => {
            windowWidth(599);
            renderSheet();
            expect(appliedStyle(dialog(), 'max-width')).toBeUndefined();
            cleanup();

            windowWidth(600);
            renderSheet();
            expect(appliedStyle(dialog(), 'max-width')).toBe(`${SHEET_MAX_WIDTH_DP}px`);
        });

        it('rounds its top corners at radius.lg and dims the screen behind it', () => {
            renderSheet();

            expect(appliedStyle(dialog(), 'border-top-left-radius')).toBe(`${radius.lg}px`);
            expect(appliedStyle(dialog(), 'border-top-right-radius')).toBe(`${radius.lg}px`);

            const scrimColour = appliedStyle(backdrop(), 'background-color');

            expect(scrimColour?.replace(/\s/gu, '')).toBe(tint(palette.charcoal, 0.4).replace(/\s/gu, ''));
        });

        it('takes the available height at size full, and grows with its content at size content', () => {
            renderSheet({ size: 'full' });
            expect(appliedStyle(dialog(), 'height')).toBe('100%');
            cleanup();

            renderSheet({ size: 'content' });
            expect(appliedStyle(dialog(), 'height')).toBeUndefined();
            expect(appliedStyle(dialog(), 'max-height')).toBe('100%');
        });

        it('does not animate while reduce motion is on or unknown, and slides when it is off', () => {
            for (const [reduceMotion, animationType] of [
                [undefined, 'none'],
                [true, 'none'],
                [false, 'slide'],
            ] as const) {
                state.reduceMotion = reduceMotion;
                renderSheet();
                expect(state.modal?.animationType).toBe(animationType);
                cleanup();
            }
        });

        it('draws edge to edge, under the status and navigation bars, over a transparent window', () => {
            renderSheet();

            expect(state.modal).toMatchObject({
                transparent: true,
                statusBarTranslucent: true,
                navigationBarTranslucent: true,
            });
        });
    });

    describe('the collapse', () => {
        const TOOLBAR = {
            heading: <Text>Search 40 options</Text>,
            controls: <Text accessibilityRole="search">Search</Text>,
        };

        it('shows the title, the heading under it, and the footer while the keyboard is closed', () => {
            renderSheet({ toolbar: TOOLBAR });

            expect(screen.getByText('Search 40 options')).toBeDefined();
            expect(screen.getByRole('button', { name: 'Done' })).toBeDefined();
            expect(appliedStyle(screen.getByRole('heading', { name: 'Filter recipes' }), 'position')).not.toBe(
                'absolute',
            );
        });

        it('collapses with the keyboard open: the title is visually hidden, the heading moves up, the footer hides', () => {
            state.keyboardShown = true;
            renderSheet({ toolbar: TOOLBAR });

            const title = screen.getByRole('heading', { name: 'Filter recipes' });

            expect(appliedStyle(title, 'position')).toBe('absolute');
            expect(appliedStyle(title, 'width')).toBe('1px');
            expect(screen.getByText('Search 40 options')).toBeDefined();
            expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
            expect(screen.getByRole('button', { name: 'Close filters' })).toBeDefined();
        });

        it('never collapses a sheet with no toolbar, so its footer stays with the keyboard open', () => {
            state.keyboardShown = true;
            renderSheet();

            expect(screen.getByRole('button', { name: 'Done' })).toBeDefined();
        });

        it('keeps the same controls and Close nodes through a collapse and back', () => {
            const onOpenChange = vi.fn();
            const sheet = (
                <Sheet
                    open
                    onOpenChange={onOpenChange}
                    title="Add details"
                    closeLabel="Close details"
                    size="full"
                    toolbar={TOOLBAR}
                >
                    <Text>Flat half</Text>
                </Sheet>
            );
            const { rerender } = render(sheet);
            const controls = screen.getByRole('search');
            const close = screen.getByRole('button', { name: 'Close details' });

            state.keyboardShown = true;
            act(() => rerender(sheet));
            expect(screen.getByRole('search')).toBe(controls);
            expect(screen.getByRole('button', { name: 'Close details' })).toBe(close);

            state.keyboardShown = false;
            act(() => rerender(sheet));
            expect(screen.getByRole('search')).toBe(controls);
            expect(screen.getByRole('button', { name: 'Close details' })).toBe(close);
        });
    });
});
