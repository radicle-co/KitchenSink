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

import { FIELD_CLASS } from '@commise/ui/input';

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

    /**
     * ⛔ NO DISMISSAL MID-ERASURE. The flow chains the account leg and the sign-out off the recipe leg's answer, and a
     * dismissal unmounts the flow that owns that chain: the recipe leg finished with no account erasure and no sign-out.
     */
    it('⛔ neither Cancel nor Escape dismisses while erasing', async () => {
        const user = userEvent.setup();
        const onCancel = vi.fn();
        renderDialog({ phrase: PHRASE, submitting: true, onCancel });

        await user.click(screen.getByRole('button', { name: 'Cancel' }));
        await user.keyboard('{Escape}');

        expect(onCancel).not.toHaveBeenCalled();
        expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Cancel' }).disabled).toBe(true);
    });
});

describe('AccountEraseDialog (web) — submitting / error (B17: no silent stop)', () => {
    // REWRITTEN for W-24: the confirm is the design-system `Button`, whose busy state is `aria-disabled` + `aria-busy`
    // on a control that STAYS FOCUSABLE (a natively `disabled` button drops focus, WCAG 2.2 SC 2.4.3). The old test
    // asserted `.disabled`, which the hand-rolled button used; the claim that matters, that a press does nothing, is
    // kept below.
    it('marks confirm busy and blocked while erasing, even with a valid phrase, and a press does nothing', async () => {
        const user = userEvent.setup();
        const onConfirm = vi.fn();
        renderDialog({ phrase: PHRASE, submitting: true, onConfirm });

        const confirm = screen.getByRole<HTMLButtonElement>('button', { name: 'Erase my data' });
        expect(confirm.getAttribute('aria-disabled')).toBe('true');
        expect(confirm.getAttribute('aria-busy')).toBe('true');
        expect(screen.getByText('Erasing…')).toBeTruthy();

        await user.click(confirm);

        expect(onConfirm).not.toHaveBeenCalled();
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

/**
 * W-24: the erase dialog wears the same frame and type roles as the Close dialog (`ConfirmDialog`): a `rounded-lg`
 * `paper-overlay` panel, a `section-title` title, a `body` / `inkMuted` description. The warning is no longer an
 * all-red paragraph; colour is not the only cue (build spec §10), so a warning glyph in `dangerText` stands beside
 * words that already say "permanently" and "cannot be undone".
 */
describe('AccountEraseDialog (web) — the shared dialog frame and type roles (W-24)', () => {
    const OLD_TOKENS = /text-heading-lg|text-body-md|text-body-sm|font-display/;

    it('wears the Close dialog’s frame: a rounded-lg paper-overlay panel', () => {
        renderDialog();

        const panel = screen.getByRole('dialog', { name: 'Erase my data' });
        expect(panel.className).toContain('rounded-lg');
        expect(panel.className).toContain('bg-paper-overlay');
        expect(panel.className).not.toContain('bg-paper ');
    });

    it('titles the dialog in the section-title role, not a serif display face', () => {
        renderDialog();

        const title = screen.getByRole('heading', { name: 'Erase my data' });
        expect(title.className).toContain('text-section-title');
        expect(title.className).toContain('text-ink');
        expect(title.className).not.toMatch(OLD_TOKENS);
    });

    it('reads the warning in body / inkMuted, not all red, and pairs the danger colour with a warning glyph', () => {
        renderDialog();

        const warning = screen.getByText(/cannot be undone/i);
        expect(warning.className).toContain('text-body');
        expect(warning.className).toContain('text-ink-muted');
        expect(warning.className).not.toContain('text-danger-text');

        const glyph = screen.getByRole('dialog').querySelector('svg.lucide-triangle-alert');
        expect(glyph).not.toBeNull();
        expect(glyph?.parentElement?.className).toContain('text-danger-text');
        // The description is still what the dialog is described BY.
        expect(screen.getByRole('dialog').getAttribute('aria-describedby')).toBe(warning.id);
    });

    it('uses no pre-overhaul type token anywhere in the dialog', () => {
        renderDialog({ donatableRecipes: [makeDonatableRecipe({ id: 'a', title: 'Ramen' })], submitError: true });

        const dirty = Array.from(screen.getByRole('dialog').querySelectorAll('[class]')).filter((node) =>
            OLD_TOKENS.test(node.getAttribute('class') ?? ''),
        );

        expect(dirty.map((node) => node.outerHTML.slice(0, 80))).toEqual([]);
    });

    it('takes the phrase in the design-system Input, named by its label and described by the prompt', () => {
        renderDialog();

        const field = screen.getByLabelText('Confirmation phrase');
        expect(field.className).toContain(FIELD_CLASS.split(' ')[0] ?? '');
        expect(field.className).toContain('min-h-12');
        expect(document.getElementById(field.getAttribute('aria-describedby') ?? '')?.textContent).toContain(PHRASE);
    });

    it('draws Cancel on the secondary surface and Erase on the filled destructive surface', () => {
        renderDialog({ phrase: PHRASE });

        expect(screen.getByRole('button', { name: 'Cancel' }).className).toContain('border-line-control');
        expect(screen.getByRole('button', { name: 'Erase my data' }).className).toContain('bg-danger');
    });
});
