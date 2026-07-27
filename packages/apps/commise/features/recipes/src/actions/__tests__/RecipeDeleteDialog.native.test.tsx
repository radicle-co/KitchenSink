/**
 * Native component tests for the recipe delete-confirmation dialog (T068), rendered via react-native-web
 * under jsdom. Mirrors the web leaf across every branch — closed, open (names the recipe), confirm/cancel,
 * and the deleting state — so the two platform renders can't drift on behaviour or accessibility.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

import { palette, semantic } from '@commise/ui';

import { cssColor } from './cssColor.js';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeDeleteDialog } from '../RecipeDeleteDialog.native.js';
import type { RecipeDeleteDialogProps } from '../model.js';

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

        expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    });

    it('renders an accessible alert that names the recipe when open', () => {
        renderDialog({ recipeTitle: 'Asparagus with Green Sauce' });

        expect(screen.getByRole('alert')).toBeTruthy();
        expect(screen.getByText(/Asparagus with Green Sauce/)).toBeTruthy();
    });

    it('reports confirm requests upward', () => {
        const onConfirm = vi.fn();
        renderDialog({ onConfirm });

        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

        expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('reports cancel requests upward', () => {
        const onCancel = vi.fn();
        renderDialog({ onCancel });

        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('disables the confirm action while deleting and does not fire again', () => {
        const onConfirm = vi.fn();
        renderDialog({ deleting: true, onConfirm });

        const confirm = screen.getByRole('button', { name: 'Delete' });
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
 * Both dialog actions are the design-system {@link Button} (there is no Radix `AlertDialog.Cancel` owning an
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

        expect(pill(screen.getByRole('button', { name: 'Delete' }))).toBeDefined();
        expect(pill(screen.getByRole('button', { name: 'Cancel' }))).toBeDefined();
    });

    it('paints confirm as the DS destructive tier (error-toned edge), not an ad-hoc red fill', () => {
        renderDialog();
        const surface = pill(screen.getByRole('button', { name: 'Delete' }))!;

        expect(window.getComputedStyle(surface).borderTopColor).toBe(cssColor(palette.error));
    });

    it('paints cancel as the DS secondary tier, so it never competes with the destructive action', () => {
        renderDialog();
        const surface = pill(screen.getByRole('button', { name: 'Cancel' }))!;

        expect(window.getComputedStyle(surface).borderTopColor).toBe(semantic.border);
        expect(window.getComputedStyle(surface).backgroundColor).toBe(cssColor(palette.white));
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

        const busyConfirm = screen.getByRole('button', { name: 'Delete' });
        expect(busyConfirm.getAttribute('aria-disabled')).toBe('true');
        fireEvent.click(busyConfirm);
        expect(onConfirm).not.toHaveBeenCalled();

        cleanup();
        renderDialog({ onConfirm });
        const idleConfirm = screen.getByRole('button', { name: 'Delete' });
        expect(idleConfirm.getAttribute('aria-disabled')).not.toBe('true');
        fireEvent.click(idleConfirm);
        expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('leaves CANCEL enabled while deleting — a stuck delete must stay dismissible', () => {
        const onCancel = vi.fn();
        renderDialog({ deleting: true, onCancel });

        const cancel = screen.getByRole('button', { name: 'Cancel' });
        expect(cancel.getAttribute('aria-disabled')).not.toBe('true');

        fireEvent.click(cancel);
        expect(onCancel).toHaveBeenCalledTimes(1);
    });
});

describe('RecipeDeleteDialog (native) — delete error (B17: no silent stop)', () => {
    it('surfaces the failed-delete copy inside the dialog when error is set', () => {
        renderDialog({ error: true });

        expect(screen.getByText('We couldn\u2019t delete this recipe. Please try again.')).toBeTruthy();
    });

    it('does not show the error while a delete is still in flight', () => {
        renderDialog({ error: true, deleting: true });

        expect(screen.queryByText(/couldn\u2019t delete/)).toBeNull();
    });
});
