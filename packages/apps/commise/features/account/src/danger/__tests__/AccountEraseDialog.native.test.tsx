/**
 * Native component tests for the account-ERASURE dialog (CR-002 / U4b), rendered via react-native-web under
 * jsdom. Mirrors the web leaf across every branch — closed, open (irreversibility + closure distinction), the
 * donate election (loading / error / empty / populated + toggle), the phrase gate (disabled until the exact
 * phrase, and while submitting), confirm/cancel, and the B17 failure surface — so the two platform renders
 * can't drift on behaviour or the destructive gate.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { createElement, type ComponentProps } from 'react';
import type { KeyboardAvoidingView as KeyboardAvoidingViewType, ScrollView as ScrollViewType } from 'react-native';
import { role, roleDark } from '@commise/ui/colors';
import { rgb, systemScheme } from '@commise/ui/testing/system-color-scheme';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { AccountEraseDialog } from '../AccountEraseDialog.native.js';
import { accountDangerMessages } from '../messages.js';
import type { AccountEraseDialogProps } from '../model.js';
import { makeDonatableRecipe } from '../__fixtures__/index.js';

const PHRASE = 'ERASE MY DATA';

// The real ScrollView and KeyboardAvoidingView, their elements marked: jsdom has no keyboard and no layout, so "the
// field and the actions move clear of the keyboard" is asserted as "they sit in the keyboard avoider, in a scroll
// region whose first tap reaches a control".
vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();
    const { withSystemScheme } = await import('@commise/ui/testing/system-color-scheme');

    return withSystemScheme({
        ...actual,
        ScrollView: (props: ComponentProps<typeof ScrollViewType>) =>
            createElement(
                'div',
                { 'data-scroll-region': props.keyboardShouldPersistTaps ?? 'never' },
                createElement(actual.ScrollView, props),
            ),
        KeyboardAvoidingView: (props: ComponentProps<typeof KeyboardAvoidingViewType>) =>
            createElement('div', { 'data-keyboard-avoider': true }, createElement(actual.KeyboardAvoidingView, props)),
    });
});

afterEach(() => {
    cleanup();
    systemScheme.current = null;
});

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

// `docs/design/compactHeightLayout.md` §9 (A7): sideways, the keyboard covered the phrase field and both actions, and
// nothing moved them. The dialog now sits on the design system's `DialogFrame`.
describe('AccountEraseDialog (native) — the keyboard', () => {
    it('keeps the phrase field and both actions in the keyboard avoider, in a region whose first tap lands', () => {
        renderDialog({ phrase: PHRASE });

        for (const control of [
            screen.getByLabelText('Confirmation phrase'),
            screen.getByRole('button', { name: 'Erase my data' }),
            screen.getByRole('button', { name: 'Cancel' }),
        ]) {
            expect(control.closest('[data-keyboard-avoider]')).not.toBeNull();
            expect(control.closest('[data-scroll-region]')?.getAttribute('data-scroll-region')).toBe('handled');
        }
    });

    // A native dialog carries no name of its own: its header names it, so the title is said once
    // (`docs/design/nativeContainerNames.md` N1).
    it('is a dialog named by its title header alone, so the title is said once', () => {
        renderDialog();

        const dialog = screen.getByRole('dialog');

        expect(within(dialog).getByRole('heading', { name: 'Erase my data' })).toBeTruthy();
        expect(dialog.getAttribute('aria-label')).toBeNull();
    });
});

/**
 * D15: the dialog paints from colour roles at render, as the web twin does. The warning and a failure are `dangerText`,
 * body copy `inkMuted`, a heading and a recipe `ink`, the phrase field `ink` inside a `lineControl` edge, and Erase the
 * `danger` fill under its `onAction` label (4.66:1 in both themes).
 */
describe.each(['light', 'dark'] as const)('AccountEraseDialog (native) — the %s scheme', (scheme) => {
    const colours = scheme === 'dark' ? roleDark : role;
    const e = accountDangerMessages.en.erase;
    const style = (element: Element): CSSStyleDeclaration => getComputedStyle(element);

    it('paints the warning in dangerText, the body in inkMuted and the donate heading in ink', () => {
        systemScheme.current = scheme;
        renderDialog();

        expect(style(screen.getByText(e.warning)).color).toBe(rgb(colours.dangerText));
        expect(style(screen.getByText(e.distinction)).color).toBe(rgb(colours.inkMuted));
        expect(style(screen.getByRole('heading', { name: e.donateHeading })).color).toBe(rgb(colours.ink));
    });

    it('draws the phrase field ink inside a lineControl edge, and Erase on the danger fill', () => {
        systemScheme.current = scheme;
        renderDialog({ phrase: PHRASE });
        const field = screen.getByLabelText(e.phraseLabel);
        const erase = screen.getByRole('button', { name: e.confirm });

        expect(style(field).color).toBe(rgb(colours.ink));
        expect(style(field).borderTopColor).toBe(rgb(colours.lineControl));
        expect(style(erase).backgroundColor).toBe(rgb(colours.danger));
        expect(style(within(erase).getByText(e.confirm)).color).toBe(rgb(colours.onAction));
        expect(style(within(screen.getByRole('button', { name: e.cancel })).getByText(e.cancel)).color).toBe(
            rgb(colours.inkMuted),
        );
    });

    it('lists a donatable recipe in ink, and a failed erase in dangerText', () => {
        systemScheme.current = scheme;
        renderDialog({ donatableRecipes: [makeDonatableRecipe({ id: 'r1', title: 'Soup' })], submitError: true });

        expect(style(screen.getByText('Soup')).color).toBe(rgb(colours.ink));
        expect(style(screen.getByText(e.error)).color).toBe(rgb(colours.dangerText));
    });
});
