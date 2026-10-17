/**
 * DialogFrame (native) — the centred dialog's fixed chrome (`docs/design/compactHeightLayout.md` §9): the window, the
 * scrim inside the safe area, the keyboard, the card capped by what the keyboard leaves, the scroll and the title.
 * Three dialogs hand-rolled this and had drifted (width, height cap, radius, padding, scrim); none avoided the keyboard
 * and none cleared the safe area, so the account erase dialog's phrase field sat under the keyboard sideways.
 *
 * ⚠️ `Modal`, `ScrollView` and `KeyboardAvoidingView` are the real ones, wrapped to record their props: react-native-web
 * has no keyboard, no window flags and no tap persistence to observe. `sendAccessibilityEvent` is mocked because
 * react-native-web does not implement it.
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import { createElement, type ComponentProps } from 'react';
import {
    AccessibilityInfo,
    Text,
    type KeyboardAvoidingView as KeyboardAvoidingViewType,
    type Modal as ModalType,
    type ScrollView as ScrollViewType,
} from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { palette, tint } from '../../tokens/colors.js';
import { nativeTokens } from '../../tokens/native.js';
import { bodyFontFace } from '../../tokens/scale.js';
import { DialogFrame } from '../DialogFrame.native.js';
import { DIALOG_CARD_MAX_WIDTH_DP } from '../dialogFrameLayout.js';
import type { DialogFrameProps } from '../props.js';

const state = vi.hoisted(() => ({
    // A distinct value per edge, so a padding taken from the wrong edge cannot pass. The left inset is under the
    // 16 dp floor, so the floor shows; the others are over it, so the inset shows.
    insets: { top: 24, right: 48, bottom: 21, left: 4 },
    modal: undefined as ComponentProps<typeof ModalType> | undefined,
    scroll: undefined as ComponentProps<typeof ScrollViewType> | undefined,
    avoider: undefined as ComponentProps<typeof KeyboardAvoidingViewType> | undefined,
}));

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: vi.fn() },
        // `onShow` is held back, so a test fires it itself: focus that moved WITHOUT it came from somewhere else.
        Modal: (props: ComponentProps<typeof ModalType>) => {
            state.modal = props;

            return createElement(actual.Modal, { ...props, onShow: undefined });
        },
        ScrollView: (props: ComponentProps<typeof ScrollViewType>) => {
            state.scroll = props;

            return createElement(actual.ScrollView, props);
        },
        KeyboardAvoidingView: (props: ComponentProps<typeof KeyboardAvoidingViewType>) => {
            state.avoider = props;

            return createElement(actual.KeyboardAvoidingView, props);
        },
    };
});
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => state.insets }));

beforeEach(() => {
    vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();
});

afterEach(() => {
    cleanup();
    state.modal = undefined;
    state.scroll = undefined;
    state.avoider = undefined;
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

function renderFrame(overrides: Partial<DialogFrameProps> = {}): { readonly onRequestClose: () => void } {
    const onRequestClose = vi.fn();

    render(
        <DialogFrame open onRequestClose={onRequestClose} title="Erase your account?" role="dialog" {...overrides}>
            <Text>Everything goes.</Text>
        </DialogFrame>,
    );

    return { onRequestClose };
}

/**
 * The card: the element with the role nearest around the title header. It carries no name of its own: the header names
 * it, so the title is said once (`docs/design/nativeContainerNames.md` N1).
 */
const card = (role: 'alert' | 'dialog' = 'dialog'): HTMLElement =>
    screen.getByRole('heading', { name: 'Erase your account?' }).closest(`[role="${role}"]`) as HTMLElement;
/** The scrim: the card sits in the keyboard avoider, inside it. */
const scrim = (role: 'alert' | 'dialog' = 'dialog'): HTMLElement =>
    card(role).parentElement?.parentElement as HTMLElement;

describe('DialogFrame (native)', () => {
    it('renders nothing while closed', () => {
        renderFrame({ open: false });

        expect(screen.queryByRole('heading', { name: 'Erase your account?' })).toBeNull();
        expect(state.modal).toBeUndefined();
    });

    it('is a modal card, the title the first thing in it', () => {
        renderFrame();

        expect(card().getAttribute('aria-modal')).toBe('true');
        expect(card().textContent?.startsWith('Erase your account?')).toBe(true);
    });

    // Rewritten for F8 (`evaluateFinal.md`): a dialog title is `sectionTitle` (Inter 600), the web dialog's role.
    // Playfair sets names only, so neither a dialog nor a sheet title is the display face any longer.
    it('sets its title in the sectionTitle role, as the web dialog does', () => {
        renderFrame();

        expect(appliedStyle(screen.getByRole('heading', { name: 'Erase your account?' }), 'font-family')).toBe(
            bodyFontFace.semibold,
        );
    });

    it('passes the role through: an interrupting confirmation is an alert', () => {
        renderFrame({ role: 'alert' });

        expect(card('alert')).toBeTruthy();
        expect(card('alert').getAttribute('role')).toBe('alert');
        expect(card('alert').getAttribute('aria-modal')).toBe('true');
    });

    it('opens a fading, transparent window drawn under the status and navigation bars, closed by Android back', () => {
        const { onRequestClose } = renderFrame();

        expect(state.modal).toMatchObject({
            visible: true,
            transparent: true,
            animationType: 'fade',
            statusBarTranslucent: true,
            navigationBarTranslucent: true,
        });
        // The Modal adapter wraps the close request (a Back with the keyboard open closes the keyboard only), so the
        // frame's own callback is what a close request with the keyboard closed reaches.
        state.modal?.onRequestClose?.({} as never);
        expect(onRequestClose).toHaveBeenCalledTimes(1);
    });

    it('keeps the card inside the safe area: each edge padded by its inset, at least 16 dp', () => {
        renderFrame();

        expect(appliedStyle(scrim(), 'padding-top')).toBe('24px');
        expect(appliedStyle(scrim(), 'padding-right')).toBe('48px');
        expect(appliedStyle(scrim(), 'padding-bottom')).toBe('21px');
        expect(appliedStyle(scrim(), 'padding-left')).toBe(`${nativeTokens.spacing[4]}px`);
    });

    it('dims the screen with the charcoal scrim token, not a near-charcoal of its own', () => {
        renderFrame();

        expect(appliedStyle(scrim(), 'background-color')?.replace(/\s/gu, '')).toBe(
            tint(palette.charcoal, 0.4).replace(/\s/gu, ''),
        );
    });

    it('lifts the card clear of the keyboard through the shared modal keyboard avoider', () => {
        renderFrame();

        expect(state.avoider).toBeDefined();
        expect(card().parentElement?.parentElement).toBe(scrim());
    });

    it('caps the card at 480 dp wide and at the height the keyboard leaves, and scrolls its content', () => {
        renderFrame();

        expect(DIALOG_CARD_MAX_WIDTH_DP).toBe(480);
        expect(appliedStyle(card(), 'max-width')).toBe('480px');
        expect(appliedStyle(card(), 'max-height')).toBe('100%');
        expect(card().contains(screen.getByText('Everything goes.'))).toBe(true);
    });

    // With the keyboard up, the first tap on Erase must press Erase, not only close the keyboard.
    it('lets the first tap with the keyboard up reach a control', () => {
        renderFrame();

        expect(state.scroll?.keyboardShouldPersistTaps).toBe('handled');
    });

    it('moves screen-reader focus to the title each time the window shows', () => {
        renderFrame();

        expect(AccessibilityInfo.sendAccessibilityEvent).not.toHaveBeenCalled();

        act(() => state.modal?.onShow?.({} as never));

        expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenLastCalledWith(
            screen.getByRole('heading', { name: 'Erase your account?' }),
            'focus',
        );
    });
});

/**
 * `docs/design/nativeContainerNames.md` N1 rule 2: the card's title header names the dialog, so the card carries no
 * name; the title is said once, by the header, inside the card that keeps its role (N4). Both roles the frame takes are
 * checked.
 */
describe('DialogFrame (native) — N1: the dialog’s name is said once, by its title header', () => {
    it.each(['dialog', 'alert'] as const)(
        'in the %s role, says the title through one header inside it, and no node is labelled with it',
        (role) => {
            renderFrame({ role });

            const headings = screen.getAllByRole('heading', { name: 'Erase your account?' });
            expect(headings).toHaveLength(1);
            expect(headings[0]?.closest(`[role="${role}"]`)).not.toBeNull();
            expect(screen.queryAllByLabelText('Erase your account?')).toEqual([]);
        },
    );
});
