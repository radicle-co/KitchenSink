import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { ConfirmDialog } from '../ConfirmDialog.js';
import type { ConfirmDialogProps } from '../props.js';

/**
 * ConfirmDialog (native) — the house B6 confirmation modal (RN `Modal`), mirroring
 * `RecipeDeleteDialog.native`'s accessible-alert card pattern.
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

describe('ConfirmDialog (native)', () => {
    it('renders nothing while closed', () => {
        render(<ConfirmDialog {...baseProps({ open: false })} />);

        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('renders an accessible alert naming the dialog and its body copy when open', () => {
        render(<ConfirmDialog {...baseProps()} />);

        expect(screen.getByLabelText('Discard unsaved changes?')).toBeTruthy();
        expect(screen.getByText('You have unsaved changes. Leaving now will discard them.')).toBeTruthy();
    });

    it('confirming calls onConfirm', () => {
        const onConfirm = vi.fn();
        render(<ConfirmDialog {...baseProps({ onConfirm })} />);

        fireEvent.click(screen.getByLabelText('Discard changes'));

        expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('cancelling calls onCancel', () => {
        const onCancel = vi.fn();
        render(<ConfirmDialog {...baseProps({ onCancel })} />);

        fireEvent.click(screen.getByLabelText('Keep editing'));

        expect(onCancel).toHaveBeenCalledTimes(1);
    });
});
