// @vitest-environment jsdom
/**
 * Component tests for the web recipe delete-confirmation dialog (T068). Covers EVERY branch the mandate
 * requires — closed (renders nothing), open (accessible alertdialog that names the recipe), confirm/cancel
 * interaction contracts, and the deleting state (confirm disabled + busy, so a second confirm can't fire).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

import { RecipeDeleteDialog } from '../RecipeDeleteDialog.js';
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

describe('RecipeDeleteDialog (web)', () => {
    it('renders nothing while closed', () => {
        renderDialog({ open: false });

        expect(screen.queryByRole('alertdialog')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    });

    it('renders an accessible alertdialog when open', () => {
        renderDialog();

        const dialog = screen.getByRole('alertdialog', { name: 'Delete recipe' });
        expect(dialog).toBeTruthy();
        expect(dialog.getAttribute('aria-modal')).toBe('true');
    });

    it('names the recipe being deleted', () => {
        renderDialog({ recipeTitle: 'Asparagus with Green Sauce' });

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

        const confirm = screen.getByRole<HTMLButtonElement>('button', { name: 'Delete' });
        expect(confirm.disabled).toBe(true);
        expect(confirm.getAttribute('aria-busy')).toBe('true');

        fireEvent.click(confirm);
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it('surfaces a busy status while deleting', () => {
        renderDialog({ deleting: true });

        expect(screen.getByRole('status')).toBeTruthy();
        expect(screen.getByText('Deleting…')).toBeTruthy();
    });
});
