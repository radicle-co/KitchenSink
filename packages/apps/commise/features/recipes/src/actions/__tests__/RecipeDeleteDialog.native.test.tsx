/**
 * Native component tests for the recipe delete-confirmation dialog (T068), rendered via react-native-web
 * under jsdom. Mirrors the web leaf across every branch — closed, open (names the recipe), confirm/cancel,
 * and the deleting state — so the two platform renders can't drift on behaviour or accessibility.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { createElement, type ComponentProps } from 'react';
import type { KeyboardAvoidingView as KeyboardAvoidingViewType, ScrollView as ScrollViewType } from 'react-native';

import { role } from '@commise/ui/colors';

import { cssColor } from '../../__tests__/cssColor.js';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeDeleteDialog } from '../RecipeDeleteDialog.native.js';
import type { RecipeDeleteDialogProps } from '../model.js';

// The real ScrollView, its element marked: jsdom has no layout, so "can the actions be scrolled to" is asserted as
// "the actions sit inside the scroll region".
vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        ScrollView: (props: ComponentProps<typeof ScrollViewType>) =>
            createElement(
                'div',
                { 'data-scroll-region': props.keyboardShouldPersistTaps ?? 'never' },
                createElement(actual.ScrollView, props),
            ),
        KeyboardAvoidingView: (props: ComponentProps<typeof KeyboardAvoidingViewType>) =>
            createElement('div', { 'data-keyboard-avoider': true }, createElement(actual.KeyboardAvoidingView, props)),
    };
});

afterEach(cleanup);

const noop = () => undefined;

function renderDialog(overrides: Partial<RecipeDeleteDialogProps> = {}) {
    const props: RecipeDeleteDialogProps = {
        recipeTitle: 'Mediterranean Grilled Lamb',
        open: true,
        onConfirm: noop,
        onCancel: noop,
        ...overrides,
    };
    render(<RecipeDeleteDialog {...props} />);

    return props;
}

describe('RecipeDeleteDialog (native)', () => {
    it('renders nothing while closed', () => {
        renderDialog({ open: false });

        expect(screen.queryByRole('button', { name: 'Delete recipe' })).toBeNull();
    });

    it('renders an accessible alert that names the recipe when open', () => {
        renderDialog({ recipeTitle: 'Asparagus with Green Sauce' });

        expect(screen.getByRole('alert')).toBeTruthy();
        expect(screen.getByText(/Asparagus with Green Sauce/)).toBeTruthy();
    });

    it('reports confirm requests upward', () => {
        const onConfirm = vi.fn();
        renderDialog({ onConfirm });

        fireEvent.click(screen.getByRole('button', { name: 'Delete recipe' }));

        expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('reports cancel requests upward', () => {
        const onCancel = vi.fn();
        renderDialog({ onCancel });

        fireEvent.click(screen.getByRole('button', { name: 'Keep recipe' }));

        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('disables the confirm action while deleting and does not fire again', () => {
        const onConfirm = vi.fn();
        renderDialog({ deleting: true, onConfirm });

        const confirm = screen.getByRole('button', { name: 'Delete recipe' });
        expect(confirm.getAttribute('aria-disabled')).toBe('true');

        fireEvent.click(confirm);
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it('surfaces a busy indicator while deleting', () => {
        renderDialog({ deleting: true });

        expect(screen.getByText('Deleting…')).toBeTruthy();
    });
});

/**
 * Both dialog actions are the design-system `Button` (there is no Radix `AlertDialog.Cancel` owning an
 * element on native, which is the ONLY reason the web leaf's cancel stays hand-rolled), so they inherit the DS
 * palette, the 44pt touch floor, the press-scale motion, and — for confirm — the real in-place spinner plus the
 * disabled + busy in-flight guard that used to be hand-rolled here.
 */
describe('RecipeDeleteDialog (native) — design-system action controls', () => {
    /** The DS Button's pill: the node inside the button carrying the 44pt floor. */
    const pill = (button: HTMLElement): HTMLElement | undefined =>
        [...button.querySelectorAll<HTMLElement>('*')].find(
            (node) => window.getComputedStyle(node).minHeight === '44px',
        );

    it('gives BOTH actions the 44pt touch floor', () => {
        renderDialog();

        expect(pill(screen.getByRole('button', { name: 'Delete recipe' }))).toBeDefined();
        expect(pill(screen.getByRole('button', { name: 'Keep recipe' }))).toBeDefined();
    });

    // ⚠️ REWRITTEN in UI-overhaul slice 2: a confirm dialog's destructive action is the DS destructive tier's FILLED
    // `confirm` tone (spec §6.5, "Delete recipe (filled error)") — the one place the danger fill appears.
    it('paints confirm as the DS destructive tier’s filled confirm tone, not an ad-hoc red fill', () => {
        renderDialog();
        const surface = pill(screen.getByRole('button', { name: 'Delete recipe' }))!;

        expect(window.getComputedStyle(surface).backgroundColor).toBe(cssColor(role.danger));
    });

    it('paints cancel as the DS secondary tier, so it never competes with the destructive action', () => {
        renderDialog();
        const surface = pill(screen.getByRole('button', { name: 'Keep recipe' }))!;

        // Secondary is neutral (UI-overhaul slice 2: no coral on any control); destructive (asserted above) is the
        // danger fill. They must stay visibly DIFFERENT tiers — same-looking cancel/confirm is the real hazard.
        expect(window.getComputedStyle(surface).borderTopColor).toBe(cssColor(role.lineControl));
        expect(window.getComputedStyle(surface).backgroundColor).toBe(cssColor(role.paper));
        expect(window.getComputedStyle(surface).backgroundColor).not.toBe(cssColor(role.danger));
    });

    it('swaps the confirm icon for a REAL spinner while deleting (not a label swap)', () => {
        renderDialog({ deleting: true });

        // The DS Button renders an ActivityIndicator in the icon slot. The slot is aria-hidden (busy is
        // announced via accessibilityState.busy), so the spinner is queried with `hidden`.
        expect(screen.getByRole('progressbar', { hidden: true })).toBeTruthy();
    });

    it('shows NO spinner when idle (the busy affordance is real state, not decoration)', () => {
        renderDialog();

        expect(screen.queryByRole('progressbar', { hidden: true })).toBeNull();
    });

    it('guards confirm against a double-fire while deleting, and re-enables it when idle', () => {
        // NOTE on what is NOT asserted here: the DS Button announces busy through `PressScale`'s
        // `accessibilityState={{ busy }}`, which react-native-web does NOT map to an `aria-busy` attribute
        // (verified empirically — it maps only `disabled`). So the ANNOUNCEMENT is a device-only behaviour,
        // covered by Maestro; what is assertable under jsdom is the observable in-flight guard plus the real
        // spinner above, and those are what these assertions pin.
        const onConfirm = vi.fn();
        renderDialog({ deleting: true, onConfirm });

        const busyConfirm = screen.getByRole('button', { name: 'Delete recipe' });
        expect(busyConfirm.getAttribute('aria-disabled')).toBe('true');
        fireEvent.click(busyConfirm);
        expect(onConfirm).not.toHaveBeenCalled();

        cleanup();
        renderDialog({ onConfirm });
        const idleConfirm = screen.getByRole('button', { name: 'Delete recipe' });
        expect(idleConfirm.getAttribute('aria-disabled')).not.toBe('true');
        fireEvent.click(idleConfirm);
        expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('leaves CANCEL enabled while deleting — a stuck delete must stay dismissible', () => {
        const onCancel = vi.fn();
        renderDialog({ deleting: true, onCancel });

        const cancel = screen.getByRole('button', { name: 'Keep recipe' });
        expect(cancel.getAttribute('aria-disabled')).not.toBe('true');

        fireEvent.click(cancel);
        expect(onCancel).toHaveBeenCalledTimes(1);
    });
});

describe('RecipeDeleteDialog (native) — delete error (B17: no silent stop)', () => {
    it('surfaces the failed-delete copy inside the dialog when error is set', () => {
        renderDialog({ error: true });

        expect(screen.getByText('We couldn\u2019t delete this recipe. Try again.')).toBeTruthy();
    });

    it('does not show the error while a delete is still in flight', () => {
        renderDialog({ error: true, deleting: true });

        expect(screen.queryByText(/couldn\u2019t delete/)).toBeNull();
    });
});

// A landscape phone is about 360 dp tall, and with large text the body pushes the actions below the window, where a
// card that does not scroll strands them (WCAG 2.2 SC 1.4.4).
describe('RecipeDeleteDialog (native) — a short window', () => {
    it('keeps the copy, both actions and the error in a scroll region inside the alert', () => {
        renderDialog({ error: true });

        // The frame is an `alert`, and the failure inside it is an `alert` too (it interrupts: the delete failed).
        const region = screen
            .getAllByRole('alert')
            .map((alert) => alert.querySelector('[data-scroll-region]'))
            .find((found) => found !== null);

        expect(region).toBeDefined();
        expect(region?.contains(screen.getByRole('button', { name: 'Delete recipe' }))).toBe(true);
        expect(region?.contains(screen.getByRole('button', { name: 'Keep recipe' }))).toBe(true);
        expect(region?.contains(screen.getByText(/couldn\u2019t delete/))).toBe(true);
    });

    // `docs/design/compactHeightLayout.md` §9: the card is the design system's `DialogFrame`, so it clears the keyboard
    // and the safe area, and the first tap reaches an action.
    it('sits on the design system’s dialog frame: in the keyboard avoider, in a region whose first tap lands', () => {
        renderDialog();

        for (const action of [
            screen.getByRole('button', { name: 'Delete recipe' }),
            screen.getByRole('button', { name: 'Keep recipe' }),
        ]) {
            expect(action.closest('[data-keyboard-avoider]')).not.toBeNull();
            expect(action.closest('[data-scroll-region]')?.getAttribute('data-scroll-region')).toBe('handled');
        }
    });
});
