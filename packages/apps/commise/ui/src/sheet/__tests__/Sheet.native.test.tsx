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
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { createElement, useState, type ComponentProps, type JSX, type ReactNode } from 'react';
import { AccessibilityInfo, Pressable, Text, type Modal as ModalType } from 'react-native';
import { render, renderWithTamagui, resolvedStyle } from '../../testing/tamaguiTesting.native.js';
import { scaledTypeSize } from '../../text/scaledType.js';
import { nativeTokens } from '../../tokens/native.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { role } from '../../tokens/colors.js';
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

afterEach(() => {
    cleanup();
    // jsdom's own width, so a test that resized the window leaves the next one the default.
    windowWidth(0);
});

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

/** Resize the window: react-native-web's `Dimensions` reads the root element's width on a resize event. */
function windowWidth(width: number): void {
    Object.defineProperty(document.documentElement, 'clientWidth', { value: width, configurable: true });
    act(() => {
        window.dispatchEvent(new Event('resize'));
    });
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

/**
 * The window's root view. A centred dialog pads it by the top inset; a bottom sheet does NOT (its engine frame must start at
 * the window top, see `topInsetPadding`), so the root is then the outermost ancestor that sets how the frame stands.
 */
const backdrop = (): Element => {
    const chain: Element[] = [];

    for (let node = dialog().parentElement; node !== null; node = node.parentElement) {
        chain.push(node);
    }

    const padded = chain.find((node) => appliedStyle(node, 'padding-top') === `${state.insets.top}px`);
    const roots = chain.filter((node) => appliedStyle(node, 'justify-content') !== undefined);

    return padded ?? (roots[roots.length - 1] as Element);
};

/**
 * The element that takes the status bar's room off the panel's space on a bottom sheet: the keyboard lift's box, the nearest
 * ancestor of the dialog that pads its head by the top inset. It sits INSIDE the engine's frame, so the frame itself starts at
 * the window's top and ends at its foot.
 */
const topInsetPadding = (): Element => {
    for (let node = dialog().parentElement; node !== null; node = node.parentElement) {
        if (resolvedStyle(node, 'paddingTop') === `${state.insets.top}px`) {
            return node;
        }
    }

    throw new Error('no ancestor of the dialog pads its head by the top inset');
};

/** The scrim catcher: the sibling that stands right behind the panel (and the tone scope around it). */
const scrim = (): Element => {
    let node: Element | null = dialog();

    while (node !== null && node.previousElementSibling === null) {
        node = node.parentElement;
    }

    return node?.previousElementSibling as Element;
};

describe('Sheet (native)', () => {
    it('renders nothing while closed', () => {
        renderSheet({ open: false });

        expect(screen.queryByRole('heading', { name: 'Filter recipes' })).toBeNull();
    });

    // F8: a sheet title is `barTitle`, Inter 16/600 (`buildSpec.md` §1.5). Manrope sets names only. REWRITTEN for the
    // owner's type-scale ruling (2026-10-25): the role was 17, and 17 is off the 14/16/18/28 scale.
    it('sets the title in the barTitle role, never the display face', () => {
        renderSheet();

        const title = screen.getAllByText('Filter recipes').find((node) => node.getAttribute('role') === 'heading');

        expect(resolvedStyle(title as Element, 'fontFamily')).not.toMatch(/Manrope/u);
        expect(resolvedStyle(title as Element, 'fontSize')).toBe(`${String(nativeTokens.type.barTitle.fontSize)}px`);
        expect(resolvedStyle(title as Element, 'fontSize')).toBe('16px');
    });

    // REWRITTEN from W-23 ("sheet header truncate:1"): the designer ruled that a sheet title wraps and is never clipped.
    // At the iOS cap (3.1x) the Sort sheet's "Sort recipes" read "Sort recip…". A title is the dialog's name, so a cook who
    // needs the large text must be able to read all of it. No line limit, no ellipsis, no no-wrap.
    it('wraps a long title in full at the largest text scale, with no line limit and no ellipsis', () => {
        const long = 'Add to Weeknight dinners for the whole family and any guests who drop by';

        renderWithTamagui(
            <Sheet open onOpenChange={vi.fn()} title={long} closeLabel="Close filters" size="content">
                <Text>Dietary</Text>
            </Sheet>,
            'light',
            3.1,
        );

        const title = screen.getByRole('heading', { name: long });

        expect(title.textContent).toBe(long);
        expect(appliedStyle(title, 'white-space')).not.toBe('nowrap');
        expect(appliedStyle(title, 'text-overflow')).not.toBe('ellipsis');
        expect(appliedStyle(title, '-webkit-line-clamp')).toBeUndefined();
    });

    // The title is the design-system Text (role `barTitle`), so it grows with the system text scale up to the role's ceiling
    // (1.5x) instead of staying at 16 px while the rest of the screen scales.
    it('draws the title at the scaled barTitle size at the largest text scale', () => {
        renderWithTamagui(
            <Sheet open onOpenChange={vi.fn()} title="Sections" closeLabel="Close" size="content">
                <Text>Dietary</Text>
            </Sheet>,
            'light',
            3.1,
        );

        const title = screen.getByRole('heading', { name: 'Sections' });
        const scaled = scaledTypeSize('barTitle', 3.1);

        expect(resolvedStyle(title, 'fontSize')).toBe(`${String(scaled.fontSize)}px`);
        expect(resolvedStyle(title, 'lineHeight')).toBe(`${String(scaled.lineHeight)}px`);
        expect(scaled.fontSize).toBeGreaterThan(nativeTokens.type.barTitle.fontSize);
    });

    // The window is shown each time the Modal reports `onShow`, and a host that wants to focus a field of a sheet that has just
    // come back (Keep editing after a discard question) must wait for that, or the field is not on screen yet and the focus is lost.
    it('tells the host each time its window is shown', () => {
        const onShown = vi.fn();
        renderSheet({ onShown });

        expect(onShown).not.toHaveBeenCalled();

        act(() => state.modal?.onShow?.({} as never));
        expect(onShown).toHaveBeenCalledOnce();

        act(() => state.modal?.onShow?.({} as never));
        expect(onShown).toHaveBeenCalledTimes(2);
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

    // REWRITTEN for the Tamagui Sheet: a bottom sheet's scrim is the engine's overlay (`dismissOnOverlayPress`, asserted in
    // `SheetEngine.native.test.tsx`), which a test cannot press. A centred dialog keeps the pressable scrim this tests.
    it('closes a centred dialog through a tap on the scrim, which is not an accessibility element', () => {
        windowWidth(834);
        const { onOpenChange } = renderSheet({ presentation: 'dialog' });
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

        // React Native 0.86 `Modal.js` sets `isRendered` false on EVERY dismissal report and back to true only on a
        // `visible` false-to-true edge. So a report that lands while the sheet is open leaves the Modal unable to slide
        // out: the next close unmounts it, and no report for that close can arrive. Rewritten from "ignores a dismissal
        // that lands after the sheet opened again", which then fired a report the source shows cannot happen.
        it('on iOS ignores a dismissal that lands while open, and reports the next close itself', () => {
            state.os = 'ios';
            const onDismissed = vi.fn();
            const { rerender } = render(sheet(true, onDismissed));

            act(() => rerender(sheet(false, onDismissed)));
            act(() => rerender(sheet(true, onDismissed)));
            act(() => state.modal?.onDismiss?.());
            expect(onDismissed).not.toHaveBeenCalled();

            act(() => rerender(sheet(false, onDismissed)));
            expect(onDismissed).toHaveBeenCalledTimes(1);
        });

        // The order the Simulator logged for New collection: Close, Keep editing, Create (newCollectionSheet).
        it('on iOS reports every close when one close is reported twice, the second time after the reopen', () => {
            state.os = 'ios';
            const onDismissed = vi.fn();
            const { rerender } = render(sheet(true, onDismissed));

            act(() => rerender(sheet(false, onDismissed)));
            act(() => state.modal?.onDismiss?.());
            expect(onDismissed).toHaveBeenCalledTimes(1);

            act(() => rerender(sheet(true, onDismissed)));
            act(() => state.modal?.onDismiss?.());
            expect(onDismissed).toHaveBeenCalledTimes(1);

            act(() => rerender(sheet(false, onDismissed)));
            expect(onDismissed).toHaveBeenCalledTimes(2);

            // A report that still arrives for that close is not a third close.
            act(() => state.modal?.onDismiss?.());
            expect(onDismissed).toHaveBeenCalledTimes(2);
        });

        it('on iOS waits again for the dismissal at the opening after one that a stray report reached', () => {
            state.os = 'ios';
            const onDismissed = vi.fn();
            const { rerender } = render(sheet(true, onDismissed));

            act(() => state.modal?.onDismiss?.());
            act(() => rerender(sheet(false, onDismissed)));
            expect(onDismissed).toHaveBeenCalledTimes(1);

            act(() => rerender(sheet(true, onDismissed)));
            act(() => rerender(sheet(false, onDismissed)));
            expect(onDismissed).toHaveBeenCalledTimes(1);

            act(() => state.modal?.onDismiss?.());
            expect(onDismissed).toHaveBeenCalledTimes(2);
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
        // REWRITTEN: the backdrop no longer pads a bottom sheet's frame by the status bar (that put the frame's foot below the
        // screen on a device). The lift takes it inside the frame, which has the same effect on the panel and none on the foot.
        it('keeps the panel below the top inset, inside a frame that starts at the window top', () => {
            renderSheet();

            expect(topInsetPadding()).toBeTruthy();
            expect(appliedStyle(backdrop(), 'padding-top')).toBeUndefined();
        });

        // Designer ruling 2026-11-03: the scrim dims the WHOLE screen, status bar strip included, as iOS and Material both do
        // behind a modal sheet. The earlier iOS shot showed the strip undimmed because the backdrop padded the engine's frame
        // (and so its overlay) down by the top inset. Nothing between the window and the overlay may pad or inset it, and the
        // window must not be a page sheet (which leaves a strip of the presenting screen above it).
        it.each(['ios', 'android'] as const)(
            '%s: the scrim reaches the top of the window, over the status bar',
            (os) => {
                state.os = os;
                renderSheet();

                expect(appliedStyle(backdrop(), 'padding-top')).toBeUndefined();
                expect(appliedStyle(backdrop(), 'margin-top')).toBeUndefined();
                expect([undefined, 'overFullScreen', 'fullScreen']).toContain(state.modal?.presentationStyle);
                expect(state.modal?.transparent).toBe(true);
            },
        );

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

        // Owner ruling 2026-10-26 (platform guidelines): a `dialog` presentation is a bottom sheet on a phone and a CENTRED
        // dialog at most 448 dp wide on a tablet (834 and 1194 alike).
        it('presentation dialog: a bottom sheet below 600 dp, a centred 448 dp dialog from it', () => {
            windowWidth(390);
            renderSheet({ presentation: 'dialog' });
            expect(appliedStyle(dialog(), 'max-width')).toBeUndefined();
            expect(appliedStyle(dialog(), 'border-bottom-left-radius')).toBeUndefined();
            expect(appliedStyle(backdrop(), 'justify-content')).toBe('flex-end');
            cleanup();

            for (const width of [834, 1194]) {
                windowWidth(width);
                renderSheet({ presentation: 'dialog' });
                expect(appliedStyle(dialog(), 'max-width')).toBe('448px');
                expect(appliedStyle(dialog(), 'border-bottom-left-radius')).toBe(`${radius.xl}px`);
                expect(appliedStyle(backdrop(), 'justify-content')).toBe('center');
                cleanup();
            }
        });

        // REWRITTEN for parity item 7: a sheet is a dialog-class surface, so its corners are radius.xl (24); lg (18) is a
        // notice's. The centred dialog above rounds all four at the same step.
        it('rounds its top corners at radius.xl, and a centred dialog dims the screen behind it', () => {
            renderSheet();

            expect(appliedStyle(dialog(), 'border-top-left-radius')).toBe(`${radius.xl}px`);
            expect(appliedStyle(dialog(), 'border-top-right-radius')).toBe(`${radius.xl}px`);
            cleanup();

            windowWidth(834);
            renderSheet({ presentation: 'dialog' });

            const scrimColour = appliedStyle(backdrop(), 'background-color');

            expect(scrimColour?.replace(/\s/gu, '')).toBe(role.scrim.replace(/\s/gu, ''));
        });

        it('takes the available height at size full, and grows with its content at size content', () => {
            renderSheet({ size: 'full' });
            expect(appliedStyle(dialog(), 'height')).toBe('100%');
            cleanup();

            renderSheet({ size: 'content' });
            expect(appliedStyle(dialog(), 'height')).toBeUndefined();
            expect(appliedStyle(dialog(), 'max-height')).toBe('100%');
        });

        // E24: `page` is a web size (the preview is a page from `sm`). A phone sheet is already as wide as the window
        // allows, so on native it IS the full-height sheet; accepting the size keeps the two prop types identical.
        it('takes the available height at size page, as full does', () => {
            renderSheet({ size: 'page' });
            expect(appliedStyle(dialog(), 'height')).toBe('100%');
            expect(appliedStyle(dialog(), 'max-height')).toBeUndefined();
        });

        // REWRITTEN: a bottom sheet draws no window animation (the engine animates it, under `motionPropsOf`: see
        // `SheetEngine.native.test.tsx`); a centred dialog keeps the window's, by the same reduce-motion rule.
        it('gives a centred dialog no window animation while reduce motion is on or unknown, and a slide when it is off', () => {
            windowWidth(834);

            for (const [reduceMotion, animationType] of [
                [undefined, 'none'],
                [true, 'none'],
                [false, 'slide'],
            ] as const) {
                state.reduceMotion = reduceMotion;
                renderSheet({ presentation: 'dialog' });
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
