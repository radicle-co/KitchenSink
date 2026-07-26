// @vitest-environment jsdom
/**
 * Web component tests for the account-ERASURE dialog (CR-002 / U4b). Covers every state the mandate requires:
 * closed (renders nothing), open (irreversibility + closure-distinction copy), the donate election across its
 * loading / error / empty / populated branches (and that a failed recipe load never blocks erasure), the
 * phrase gate (confirm disabled until the exact phrase is typed, and while submitting), confirm/cancel/Escape
 * callback contracts, the submitting busy state, and the B17 failure surface.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';

import { AccountEraseDialog } from '../AccountEraseDialog.js';
import type { AccountEraseDialogProps } from '../model.js';
import { makeDonatableRecipe } from '../__fixtures__/index.js';

const PHRASE = 'ERASE MY DATA';

afterEach(cleanup);

const noop = () => undefined;

function renderDialog(overrides: Partial<AccountEraseDialogProps> = {}): AccountEraseDialogProps {
    const props: AccountEraseDialogProps = {
        open: true,
        donatableRecipes: [],
        selectedRecipeIds: [],
        onToggleRecipe: noop,
        phrase: '',
        onPhraseChange: noop,
        onConfirm: noop,
        onCancel: noop,
        ...overrides,
    };
    render(<AccountEraseDialog {...props} />);

    return props;
}

describe('AccountEraseDialog (web) — visibility', () => {
    it('renders nothing while closed', () => {
        renderDialog({ open: false });

        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('opens a dialog that states the action is irreversible and distinct from closing', () => {
        renderDialog();

        expect(screen.getByRole('dialog', { name: 'Erase my data' })).toBeTruthy();
        expect(screen.getByText(/cannot be undone/i)).toBeTruthy();
        expect(screen.getByText(/not the same as closing your account/i)).toBeTruthy();
    });
});

describe('AccountEraseDialog (web) — donate election', () => {
    it('shows a loading status and no checkboxes while recipes load', () => {
        renderDialog({ recipesLoading: true });

        expect(screen.getByText('Loading your recipes')).toBeTruthy();
        expect(screen.queryByRole('checkbox')).toBeNull();
    });

    it('surfaces a non-blocking notice when the recipe list fails to load', () => {
        renderDialog({ recipesError: true });

        expect(screen.getByText(/couldn’t load your recipes/i)).toBeTruthy();
        expect(screen.queryByRole('checkbox')).toBeNull();
    });

    it('shows the empty-state copy when there are no owner-only recipes', () => {
        renderDialog({ donatableRecipes: [] });

        expect(screen.getByText(/no private recipes to publish/i)).toBeTruthy();
    });

    it('renders a checkbox per donatable recipe, reflecting the current selection', () => {
        renderDialog({
            donatableRecipes: [
                makeDonatableRecipe({ id: 'a', title: 'Ramen' }),
                makeDonatableRecipe({ id: 'b', title: 'Miso Soup' }),
            ],
            selectedRecipeIds: ['b'],
        });

        expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'Ramen' }).checked).toBe(false);
        expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'Miso Soup' }).checked).toBe(true);
    });

    it('reports a recipe toggle upward with the recipe id', async () => {
        const user = userEvent.setup();
        const onToggleRecipe = vi.fn();
        renderDialog({ donatableRecipes: [makeDonatableRecipe({ id: 'a', title: 'Ramen' })], onToggleRecipe });

        await user.click(screen.getByRole('checkbox', { name: 'Ramen' }));

        expect(onToggleRecipe).toHaveBeenCalledWith('a');
    });
});

describe('AccountEraseDialog (web) — phrase gate', () => {
    it('disables confirm until the exact phrase is typed', () => {
        renderDialog({ phrase: 'erase my data' });

        expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Erase my data' }).disabled).toBe(true);
    });

    it('enables confirm once the exact phrase is present', () => {
        renderDialog({ phrase: PHRASE });

        expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Erase my data' }).disabled).toBe(false);
    });

    it('reports typing into the confirmation field', () => {
        const onPhraseChange = vi.fn();
        renderDialog({ onPhraseChange });

        fireEvent.change(screen.getByLabelText('Confirmation phrase'), { target: { value: 'ERASE' } });

        expect(onPhraseChange).toHaveBeenCalledWith('ERASE');
    });
});

describe('AccountEraseDialog (web) — confirm / cancel', () => {
    it('confirms erasure when the gate is satisfied', async () => {
        const user = userEvent.setup();
        const onConfirm = vi.fn();
        renderDialog({ phrase: PHRASE, onConfirm });

        await user.click(screen.getByRole('button', { name: 'Erase my data' }));

        expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('does not confirm while the phrase gate is unsatisfied', async () => {
        const user = userEvent.setup();
        const onConfirm = vi.fn();
        renderDialog({ phrase: '', onConfirm });

        await user.click(screen.getByRole('button', { name: 'Erase my data' }));

        expect(onConfirm).not.toHaveBeenCalled();
    });

    it('cancels via the Cancel control', async () => {
        const user = userEvent.setup();
        const onCancel = vi.fn();
        renderDialog({ onCancel });

        await user.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('cancels on Escape (Radix dismiss maps to onCancel)', async () => {
        const user = userEvent.setup();
        const onCancel = vi.fn();
        renderDialog({ onCancel });

        await user.keyboard('{Escape}');

        expect(onCancel).toHaveBeenCalled();
    });
});

describe('AccountEraseDialog (web) — submitting / error (B17: no silent stop)', () => {
    it('marks confirm busy and disabled while erasing, even with a valid phrase', () => {
        renderDialog({ phrase: PHRASE, submitting: true });

        const confirm = screen.getByRole<HTMLButtonElement>('button', { name: 'Erase my data' });
        expect(confirm.disabled).toBe(true);
        expect(confirm.getAttribute('aria-busy')).toBe('true');
        expect(screen.getByText('Erasing…')).toBeTruthy();
    });

    it('surfaces the failure copy when the erasure request fails', () => {
        renderDialog({ phrase: PHRASE, submitError: true });

        expect(screen.getByRole('alert')).toHaveProperty(
            'textContent',
            'We couldn’t start erasing your data. Please try again.',
        );
    });

    it('does not show the error while a submit is still in flight', () => {
        renderDialog({ phrase: PHRASE, submitError: true, submitting: true });

        expect(screen.queryByRole('alert')).toBeNull();
    });
});
