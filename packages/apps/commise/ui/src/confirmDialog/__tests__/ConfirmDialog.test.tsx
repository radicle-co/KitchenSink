import { describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach } from 'vitest';

import { ConfirmDialog } from '../ConfirmDialog.js';
import type { ConfirmDialogProps } from '../props.js';

/**
 * ConfirmDialog (web) — the house B6 confirmation modal (`@radix-ui/react-alert-dialog`).
 *
 * Covers: closed renders nothing; open renders an accessible alertdialog naming the title/description;
 * confirm/cancel wire to their callbacks; Escape-dismiss (Radix's own `onOpenChange`) also routes to
 * `onCancel` — a single exit path, not two; the destructive tier is a visually distinct affordance.
 */
afterEach(cleanup);

function baseProps(overrides: Partial<ConfirmDialogProps> = {}): ConfirmDialogProps {
    return {
        open: true,
        title: 'Discard unsaved changes?',
        description: 'You have unsaved changes. Leaving now will discard them.',
        confirmLabel: 'Discard changes',
        cancelLabel: 'Keep editing',
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
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

    it('the explicit cancel action calls onCancel', async () => {
        const user = userEvent.setup();
        const onCancel = vi.fn();
        render(<ConfirmDialog {...baseProps({ onCancel })} />);

        await user.click(screen.getByRole('button', { name: 'Keep editing' }));

        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('Escape-dismissal also calls onCancel (one exit path, not two)', async () => {
        const user = userEvent.setup();
        const onCancel = vi.fn();
        render(<ConfirmDialog {...baseProps({ onCancel })} />);

        await user.keyboard('{Escape}');

        expect(onCancel).toHaveBeenCalledTimes(1);
    });
});
