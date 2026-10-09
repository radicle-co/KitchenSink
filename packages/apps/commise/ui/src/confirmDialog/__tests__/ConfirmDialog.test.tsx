import { describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type JSX } from 'react';
import { afterEach } from 'vitest';

import { ConfirmDialog } from '../ConfirmDialog.js';
import type { ConfirmDialogProps } from '../props.js';

/**
 * ConfirmDialog (web) — the house B6 confirmation modal (`@radix-ui/react-alert-dialog`).
 *
 * Covers: closed renders nothing; open renders an accessible alertdialog naming the title/description;
 * confirm/cancel wire to their callbacks; Escape-dismiss (Radix's own `onOpenChange`) also routes to
 * `onKeep` — a single exit path, not two; the destructive tier is a visually distinct affordance; and
 * focus-return to the SIBLING control that opened it, on every one of the three exit paths.
 *
 * ⛔ The focus cases are a BEHAVIOUR this leaf did not have. Radix restores focus on close only to an OWNED
 * `*.Trigger`; every caller of this dialog (`Wizard`, `AccountCloseForm`, `AccountDangerZone`) opens it from
 * a sibling control, so Radix's default focused NOTHING and a keyboard user was dropped at the top of the
 * document. `useReturnFocusOnClose` owns the repair for the six surfaces that already had it; these pin it
 * for the seventh.
 */
afterEach(cleanup);

/** A sibling-triggered dialog, which is the ONLY way any caller in this repository uses it. */
function SiblingTriggered(overrides: Partial<ConfirmDialogProps> = {}): JSX.Element {
    const [open, setOpen] = useState(false);

    return (
        <>
            <button type="button" onClick={() => setOpen(true)}>
                Open
            </button>
            <button type="button">Unrelated sibling</button>
            <ConfirmDialog {...baseProps({ ...overrides, open, onKeep: () => setOpen(false) })} />
        </>
    );
}

/**
 * Radix's `FocusScope` restores focus from an unmount-cleanup `setTimeout(0)`
 * (`@radix-ui/react-focus-scope`) — a real macrotask, so a close needs one real tick to settle.
 */
async function focusToSettle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 100));
}

function baseProps(overrides: Partial<ConfirmDialogProps> = {}): ConfirmDialogProps {
    return {
        open: true,
        title: 'Discard unsaved changes?',
        body: 'You have unsaved changes. Leaving now will discard them.',
        confirm: { label: 'Discard changes', icon: 'trash' },
        keep: { label: 'Keep editing' },
        onConfirm: vi.fn(),
        onKeep: vi.fn(),
        ...overrides,
    };
}

describe('ConfirmDialog (web)', () => {
    it('renders nothing while closed', () => {
        render(<ConfirmDialog {...baseProps({ open: false })} />);

        expect(screen.queryByRole('alertdialog')).toBeNull();
    });

    it('renders an accessible alertdialog naming the title and description when open', () => {
        render(<ConfirmDialog {...baseProps()} />);

        expect(screen.getByRole('alertdialog', { name: 'Discard unsaved changes?' })).toBeTruthy();
        expect(screen.getByText('You have unsaved changes. Leaving now will discard them.')).toBeTruthy();
    });

    it('confirming calls onConfirm', async () => {
        const user = userEvent.setup();
        const onConfirm = vi.fn();
        render(<ConfirmDialog {...baseProps({ onConfirm })} />);

        await user.click(screen.getByRole('button', { name: 'Discard changes' }));

        expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('the Keep action calls onKeep', async () => {
        const user = userEvent.setup();
        const onKeep = vi.fn();
        render(<ConfirmDialog {...baseProps({ onKeep })} />);

        await user.click(screen.getByRole('button', { name: 'Keep editing' }));

        expect(onKeep).toHaveBeenCalledTimes(1);
    });

    it('Escape-dismissal also calls onKeep (one exit path, not two)', async () => {
        const user = userEvent.setup();
        const onKeep = vi.fn();
        render(<ConfirmDialog {...baseProps({ onKeep })} />);

        await user.keyboard('{Escape}');

        expect(onKeep).toHaveBeenCalledTimes(1);
    });
});

describe('ConfirmDialog (web) — focus-return to the sibling control that opened it', () => {
    it('restores focus to the opener when the explicit cancel action closes it', async () => {
        const user = userEvent.setup();
        render(<SiblingTriggered />);

        await user.click(screen.getByRole('button', { name: 'Open' }));
        expect(screen.getByRole('alertdialog')).toBeTruthy();

        await user.click(screen.getByRole('button', { name: 'Keep editing' }));

        expect(screen.queryByRole('alertdialog')).toBeNull();
        await focusToSettle();
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open' }));
    });

    it('restores focus to the opener when Escape closes it', async () => {
        const user = userEvent.setup();
        render(<SiblingTriggered />);

        await user.click(screen.getByRole('button', { name: 'Open' }));
        await user.keyboard('{Escape}');

        expect(screen.queryByRole('alertdialog')).toBeNull();
        await focusToSettle();
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open' }));
    });

    // The edge guard, at the component's own level: a busy/error re-render while the dialog is open must not
    // re-snapshot, or focus would return to a control INSIDE the dialog rather than to the opener.
    it('does not re-snapshot when it re-renders while open', async () => {
        const user = userEvent.setup();
        const { rerender } = render(<SiblingTriggered />);

        await user.click(screen.getByRole('button', { name: 'Open' }));
        // Focus is now inside the dialog, exactly as Radix's own autofocus-on-mount leaves it.
        rerender(<SiblingTriggered title="Still discarding?" />);
        await user.keyboard('{Escape}');

        await focusToSettle();
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open' }));
    });

    it('restores nothing, and does not throw, when no control had focus before it opened', async () => {
        const user = userEvent.setup();
        const { rerender } = render(<ConfirmDialog {...baseProps({ open: false })} />);

        // Opened programmatically with focus nowhere — a gated widget opening it on mount, say. There is no
        // opener to restore, so closing must leave focus alone rather than reset it to some other control.
        rerender(<ConfirmDialog {...baseProps({ open: true })} />);
        await user.keyboard('{Escape}');
        rerender(<ConfirmDialog {...baseProps({ open: false })} />);

        await focusToSettle();
        expect(document.activeElement).toBe(document.body);
    });
});

/**
 * Slice 2 of the UI overhaul (blueprint Part B, ConfirmDialog; spec §6.5): verb buttons with glyphs, focus that opens
 * on the safe one, the filled destructive tone, buttons that stack below a 400 px dialog, and the busy and failed
 * states a destructive request goes through.
 */
describe('ConfirmDialog (web) — the overhaul contract', () => {
    const tokensOf = (element: Element): readonly string[] => element.className.split(/\s+/u);

    it('opens with focus on Keep, the non-destructive action', () => {
        render(<ConfirmDialog {...baseProps()} />);

        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep editing' }));
    });

    it('draws the confirm in the filled destructive tone with its glyph, and Keep as secondary with an x', () => {
        render(<ConfirmDialog {...baseProps()} />);

        const confirm = screen.getByRole('button', { name: 'Discard changes' });
        const keep = screen.getByRole('button', { name: 'Keep editing' });

        expect(tokensOf(confirm)).toContain('bg-danger');
        expect(confirm.querySelector('svg.lucide-trash')).not.toBeNull();
        expect(tokensOf(keep)).toEqual(expect.arrayContaining(['bg-paper', 'border-line-control']));
        expect(keep.querySelector('svg.lucide-x')).not.toBeNull();
    });

    it('draws Keep with the glyph it is given', () => {
        render(<ConfirmDialog {...baseProps({ keep: { label: 'Keep editing', icon: 'pencilLine' } })} />);

        expect(
            screen.getByRole('button', { name: 'Keep editing' }).querySelector('svg.lucide-pencil-line'),
        ).not.toBeNull();
    });

    it('stacks its buttons below a 400px dialog, destructive on top, and sets them side by side above it, Keep first', () => {
        render(<ConfirmDialog {...baseProps()} />);

        const dialog = screen.getByRole('alertdialog');
        const actions = screen.getByRole('button', { name: 'Keep editing' }).parentElement as HTMLElement;

        expect(tokensOf(dialog)).toContain('@container/dialog');
        expect(tokensOf(actions)).toEqual(
            expect.arrayContaining(['flex-col-reverse', '@[25rem]/dialog:flex-row', '@[25rem]/dialog:justify-end']),
        );
        expect([...actions.querySelectorAll('button')].map((button) => button.textContent)).toStrictEqual([
            'Keep editing',
            'Discard changes',
        ]);
    });

    it('fills each button across the stacked dialog', () => {
        render(<ConfirmDialog {...baseProps()} />);

        expect(tokensOf(screen.getByRole('button', { name: 'Keep editing' }))).toContain('w-full');
        expect(tokensOf(screen.getByRole('button', { name: 'Discard changes' }))).toContain('w-full');
    });

    it('while busy, spins the confirm and cannot fire again, says so, and Keep stays able to close it', async () => {
        const user = userEvent.setup();
        const onConfirm = vi.fn();
        const onKeep = vi.fn();
        render(<ConfirmDialog {...baseProps({ busy: true, busyLabel: 'Discarding…', onConfirm, onKeep })} />);

        const confirm = screen.getByRole('button', { name: 'Discard changes' });

        expect(confirm.getAttribute('aria-busy')).toBe('true');
        expect(screen.getByRole('status').textContent).toBe('Discarding…');

        await user.click(confirm);
        await user.click(screen.getByRole('button', { name: 'Keep editing' }));

        expect(onConfirm).not.toHaveBeenCalled();
        expect(onKeep).toHaveBeenCalledOnce();
    });

    it('shows a failure inside the dialog as an alert, but not while a retry is in flight', () => {
        const { rerender } = render(<ConfirmDialog {...baseProps({ error: 'We couldn’t discard. Try again.' })} />);

        expect(screen.getByRole('alert').textContent).toBe('We couldn’t discard. Try again.');

        rerender(<ConfirmDialog {...baseProps({ error: 'We couldn’t discard. Try again.', busy: true })} />);

        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('titles the dialog in the section title role', () => {
        render(<ConfirmDialog {...baseProps()} />);

        expect(tokensOf(screen.getByRole('heading', { name: 'Discard unsaved changes?' }))).toContain(
            'text-section-title',
        );
    });
});
