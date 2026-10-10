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
import { createElement, useState, type ComponentProps, type JSX, type ReactNode } from 'react';
import { AccessibilityInfo, Pressable, Text, type Modal as ModalType } from 'react-native';
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
    // The platform the leaf reads; `undefined` keeps react-native-web's own.
    os: undefined as 'ios' | 'android' | undefined,
}));

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: vi.fn() },
        Platform: {
            ...actual.Platform,
            get OS() {
                return state.os ?? actual.Platform.OS;
            },
        },
        // The real Modal, with the props it was given recorded: its motion and window flags are the contract.
        // `onShow` and `onDismiss` are held back, so a test fires them itself: a focus move or a dismissal that
        // happened WITHOUT them came from somewhere else.
        Modal: (props: ComponentProps<typeof ModalType>) => {
            state.modal = props;

            return createElement(actual.Modal, { ...props, onShow: undefined, onDismiss: undefined });
        },
    };
});
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => state.insets }));
vi.mock('../../layout/useKeyboardShown.native.js', () => ({ useKeyboardShown: () => state.keyboardShown }));
vi.mock('../../motion/useReduceMotion.native.js', () => ({ useReduceMotion: () => state.reduceMotion }));

beforeEach(() => {
    state.keyboardShown = false;
    state.reduceMotion = undefined;
    state.os = undefined;
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

// react-native-web's Modal renders a dialog of its own around the content, so the Sheet's is the nearest one around its
// title header. Neither carries a name: the header names the Sheet (`docs/design/nativeContainerNames.md` N1).
const dialog = (): HTMLElement =>
    screen.getByRole('heading', { name: 'Filter recipes' }).closest('[role="dialog"]') as HTMLElement;

/** The dimmed window behind the sheet: the dialog sits in the keyboard-avoiding layer, inside it. */
const backdrop = (): Element => dialog().parentElement?.parentElement as Element;

/** The scrim: the backdrop's first child, behind the keyboard-avoiding layer. */
const scrim = (): Element => backdrop().firstElementChild as Element;

describe('Sheet (native)', () => {
    it('renders nothing while closed', () => {
        renderSheet({ open: false });

        expect(screen.queryByRole('heading', { name: 'Filter recipes' })).toBeNull();
    });

    // F8: a sheet title is `barTitle`, Inter 17/600 (`buildSpec.md` §1.5). Playfair sets names only.
    it('sets the title in the barTitle role, never the display face', () => {
        renderSheet();

        const title = screen.getAllByText('Filter recipes').find((node) => node.getAttribute('role') === 'heading');

        expect(appliedStyle(title as Element, 'font-family')).not.toMatch(/Playfair/u);
        expect(appliedStyle(title as Element, 'font-size')).toBe('17px');
    });

    it('is a modal dialog', () => {
        renderSheet();

        expect(dialog().getAttribute('aria-modal')).toBe('true');
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

    describe('onDismissed', () => {
        const sheet = (open: boolean, onDismissed: () => void, children: ReactNode = <Text>Dietary</Text>) => (
            <Sheet
                open={open}
                onOpenChange={vi.fn()}
                onDismissed={onDismissed}
                title="Filter recipes"
                closeLabel="Close filters"
                size="content"
            >
                {children}
            </Sheet>
        );

        it('is called once after a close where the Modal reports no dismissal (Android), never at mount or while open', () => {
            const onDismissed = vi.fn();
            const { rerender } = render(sheet(false, onDismissed));

            act(() => rerender(sheet(true, onDismissed)));
            act(() => rerender(sheet(true, onDismissed)));
            expect(onDismissed).not.toHaveBeenCalled();

            act(() => rerender(sheet(false, onDismissed)));
            act(() => rerender(sheet(false, onDismissed)));

            expect(onDismissed).toHaveBeenCalledTimes(1);
            expect(screen.queryByRole('heading', { name: 'Filter recipes' })).toBeNull();
        });

        it('on iOS stays mounted with visible false, so the Modal can slide out, and waits for its dismissal', () => {
            state.os = 'ios';
            const onDismissed = vi.fn();
            const { rerender } = render(sheet(true, onDismissed));

            act(() => rerender(sheet(false, onDismissed)));

            expect(state.modal?.visible).toBe(false);
            expect(onDismissed).not.toHaveBeenCalled();

            act(() => state.modal?.onDismiss?.());
            expect(onDismissed).toHaveBeenCalledTimes(1);

            // A second report of the same dismissal is not a second close.
            act(() => state.modal?.onDismiss?.());
            expect(onDismissed).toHaveBeenCalledTimes(1);
        });

        it('on iOS ignores a dismissal that lands after the sheet opened again', () => {
            state.os = 'ios';
            const onDismissed = vi.fn();
            const { rerender } = render(sheet(true, onDismissed));

            act(() => rerender(sheet(false, onDismissed)));
            act(() => rerender(sheet(true, onDismissed)));
            act(() => state.modal?.onDismiss?.());
            expect(onDismissed).not.toHaveBeenCalled();

            act(() => rerender(sheet(false, onDismissed)));
            act(() => state.modal?.onDismiss?.());
            expect(onDismissed).toHaveBeenCalledTimes(1);
        });

        it('starts the panel fresh at each opening, even one that comes before the slide-out ends', () => {
            // Slide: react-native-web keeps the content mounted while it slides out, as iOS does.
            state.reduceMotion = false;

            function Taps(): JSX.Element {
                const [taps, setTaps] = useState(0);

                return (
                    <Pressable accessibilityRole="button" onPress={() => setTaps((count) => count + 1)}>
                        <Text>{`Taps ${taps}`}</Text>
                    </Pressable>
                );
            }

            const onDismissed = vi.fn();
            const { rerender } = render(sheet(true, onDismissed, <Taps />));

            fireEvent.click(screen.getByRole('button', { name: 'Taps 0' }));
            expect(screen.getByText('Taps 1')).toBeDefined();

            act(() => rerender(sheet(false, onDismissed, <Taps />)));
            act(() => rerender(sheet(true, onDismissed, <Taps />)));

            expect(screen.getByText('Taps 0')).toBeDefined();
        });
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

        // `docs/design/compactHeightLayout.md` §6 (A6): centred from 600 dp, the sheet pads only by the part of a side
        // inset it reaches. This file's stub insets are 4 (left) and 6 (right).
        it('pads by the whole side insets while full width, and by none once centred well clear of them', () => {
            windowWidth(599);
            renderSheet();
            expect(appliedStyle(dialog(), 'padding-left')).toBe(`${state.insets.left}px`);
            expect(appliedStyle(dialog(), 'padding-right')).toBe(`${state.insets.right}px`);
            cleanup();

            windowWidth(851);
            renderSheet();
            expect(appliedStyle(dialog(), 'padding-left')).toBe('0px');
            expect(appliedStyle(dialog(), 'padding-right')).toBe('0px');
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

        // On iOS a Modal's window is portrait only unless it says otherwise, so a sheet opened in landscape would turn
        // the screen back to portrait (WCAG 2.2 SC 1.3.4). The window comes from `@commise/ui/modal`.
        it('opens a window that supports every orientation', () => {
            renderSheet();

            expect(state.modal?.supportedOrientations).toEqual(
                expect.arrayContaining(['portrait', 'landscape-left', 'landscape-right']),
            );
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

/**
 * `docs/design/nativeContainerNames.md` N1 rule 2 and N2 (filter sheet): the sheet's title header names it, so the
 * sheet carries no name; the title is said once, by the header inside the dialog (N4).
 */
describe('Sheet (native) — N1: the sheet’s name is said once, by its title header', () => {
    it('says the title through one header inside a dialog, and no node is labelled with it', () => {
        renderSheet();

        const headings = screen.getAllByRole('heading', { name: 'Filter recipes' });
        expect(headings).toHaveLength(1);
        expect(headings[0]?.closest('[role="dialog"]')).not.toBeNull();
        expect(screen.queryAllByLabelText('Filter recipes')).toEqual([]);
    });
});
