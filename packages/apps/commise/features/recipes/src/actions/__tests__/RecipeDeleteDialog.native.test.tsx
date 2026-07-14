/**
 * Native component tests for the recipe delete-confirmation dialog (T068), rendered via react-native-web
 * under jsdom. Mirrors the web leaf across every branch — closed, open (names the recipe), confirm/cancel,
 * and the deleting state — so the two platform renders can't drift on behaviour or accessibility.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

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
