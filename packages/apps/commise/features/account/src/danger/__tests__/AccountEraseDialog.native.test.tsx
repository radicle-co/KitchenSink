/**
 * Native component tests for the account-ERASURE dialog (CR-002 / U4b), rendered via react-native-web under
 * jsdom. Mirrors the web leaf across every branch — closed, open (irreversibility + closure distinction), the
 * donate election (loading / error / empty / populated + toggle), the phrase gate (disabled until the exact
 * phrase, and while submitting), confirm/cancel, and the B17 failure surface — so the two platform renders
 * can't drift on behaviour or the destructive gate.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { AccountEraseDialog } from '../AccountEraseDialog.native.js';
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

describe('AccountEraseDialog (native) — visibility', () => {
    it('renders nothing while closed', () => {
        renderDialog({ open: false });

        expect(screen.queryByRole('button', { name: 'Erase my data' })).toBeNull();
    });

    it('states the action is irreversible and distinct from closing', () => {
        renderDialog();

        expect(screen.getByText(/cannot be undone/i)).toBeTruthy();
        expect(screen.getByText(/not the same as closing your account/i)).toBeTruthy();
    });
});

describe('AccountEraseDialog (native) — donate election', () => {
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

        // react-native-web renders `aria-checked` only for the checked state (absent when unchecked).
        expect(screen.getByRole('checkbox', { name: 'Ramen' }).getAttribute('aria-checked')).not.toBe('true');
        expect(screen.getByRole('checkbox', { name: 'Miso Soup' }).getAttribute('aria-checked')).toBe('true');
    });

    it('reports a recipe toggle upward with the recipe id', () => {
        const onToggleRecipe = vi.fn();
        renderDialog({ donatableRecipes: [makeDonatableRecipe({ id: 'a', title: 'Ramen' })], onToggleRecipe });

        fireEvent.click(screen.getByRole('checkbox', { name: 'Ramen' }));

        expect(onToggleRecipe).toHaveBeenCalledWith('a');
    });
});

describe('AccountEraseDialog (native) — phrase gate', () => {
    it('disables confirm until the exact phrase is typed', () => {
        renderDialog({ phrase: 'erase my data' });

        expect(screen.getByRole('button', { name: 'Erase my data' }).getAttribute('aria-disabled')).toBe('true');
    });

    it('enables confirm once the exact phrase is present', () => {
        renderDialog({ phrase: PHRASE });

        expect(screen.getByRole('button', { name: 'Erase my data' }).getAttribute('aria-disabled')).not.toBe('true');
    });

    it('reports typing into the confirmation field', () => {
        const onPhraseChange = vi.fn();
        renderDialog({ onPhraseChange });

        fireEvent.change(screen.getByLabelText('Confirmation phrase'), { target: { value: 'ERASE' } });

        expect(onPhraseChange).toHaveBeenCalledWith('ERASE');
    });
});

describe('AccountEraseDialog (native) — confirm / cancel', () => {
    it('confirms erasure when the gate is satisfied', () => {
        const onConfirm = vi.fn();
        renderDialog({ phrase: PHRASE, onConfirm });

        fireEvent.click(screen.getByRole('button', { name: 'Erase my data' }));

        expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('does not confirm while the phrase gate is unsatisfied', () => {
        const onConfirm = vi.fn();
        renderDialog({ phrase: '', onConfirm });

        fireEvent.click(screen.getByRole('button', { name: 'Erase my data' }));

        expect(onConfirm).not.toHaveBeenCalled();
    });

    it('cancels via the Cancel control', () => {
        const onCancel = vi.fn();
        renderDialog({ onCancel });

        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(onCancel).toHaveBeenCalledTimes(1);
    });
});

describe('AccountEraseDialog (native) — submitting / error (B17: no silent stop)', () => {
    it('marks confirm busy and disabled while erasing, even with a valid phrase', () => {
        renderDialog({ phrase: PHRASE, submitting: true });

        const confirm = screen.getByRole('button', { name: 'Erase my data' });
        expect(confirm.getAttribute('aria-disabled')).toBe('true');
        expect(screen.getByText('Erasing…')).toBeTruthy();
    });

    it('surfaces the failure copy when the erasure request fails', () => {
        renderDialog({ phrase: PHRASE, submitError: true });

        expect(screen.getByText('We couldn’t start erasing your data. Please try again.')).toBeTruthy();
    });

    it('does not show the error while a submit is still in flight', () => {
        renderDialog({ phrase: PHRASE, submitError: true, submitting: true });

        expect(screen.queryByText(/couldn’t start erasing/i)).toBeNull();
    });
});
