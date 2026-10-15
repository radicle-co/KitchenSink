// @vitest-environment jsdom
/**
 * Component tests for the web "Make this recipe public?" confirm (UX SPECIFY 2026-10-15; plan 2026-10-14-009 Q5): what
 * a downgraded owner sees before a private recipe goes public. Every consequence's words, the two verb buttons (no
 * Premium button, no third choice — the deceptive-pattern rule), focus opening on Keep private, Escape as Keep, and the
 * busy and failed states the recipe page uses.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { RecipeMakePublicDialog } from '../RecipeMakePublicDialog.js';
import { recipeActionMessages } from '../messages.js';
import type { RecipeMakePublicDialogProps } from '../model.js';

const m = recipeActionMessages.en.makePublicDialog;

afterEach(cleanup);

function renderDialog(overrides: Partial<RecipeMakePublicDialogProps> = {}) {
    const props: RecipeMakePublicDialogProps = {
        open: true,
        consequence: 'final',
        onConfirm: vi.fn(),
        onKeep: vi.fn(),
        ...overrides,
    };
    render(<RecipeMakePublicDialog {...props} />);

    return props;
}

describe('RecipeMakePublicDialog (web)', () => {
    it('renders nothing while closed', () => {
        renderDialog({ open: false });

        expect(screen.queryByRole('alertdialog')).toBeNull();
    });

    it.each([
        ['final', "Anyone can see a public recipe and save a copy. You won't be able to make this one private again."],
        [
            'premium',
            "Anyone can see a public recipe and save a copy. To make this one private again, you'll need Premium.",
        ],
        [
            'unknown',
            'Anyone can see a public recipe and save a copy. You may not be able to make this one private again.',
        ],
    ] as const)('under %s, asks "Make this recipe public?" and says plainly what it costs', (consequence, body) => {
        renderDialog({ consequence });

        const dialog = screen.getByRole('alertdialog', { name: 'Make this recipe public?' });

        expect(dialog.getAttribute('aria-modal')).toBe('true');
        expect(screen.getByText(body)).toBeTruthy();
    });

    it('⛔ offers exactly two verbs — Keep private and Make public — and nothing that sells', () => {
        renderDialog({ consequence: 'premium' });

        const buttons = screen.getAllByRole('button').map((button) => button.textContent);

        expect(buttons).toEqual(['Keep private', 'Make public']);
        expect(screen.queryByRole('button', { name: /Premium/u })).toBeNull();
    });

    it('opens with focus on Keep private', () => {
        renderDialog();

        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep private' }));
    });

    it('Make public confirms; Keep private and Escape keep', async () => {
        const user = userEvent.setup();
        const props = renderDialog();

        await user.click(screen.getByRole('button', { name: 'Make public' }));
        expect(props.onConfirm).toHaveBeenCalledTimes(1);

        await user.click(screen.getByRole('button', { name: 'Keep private' }));
        await user.keyboard('{Escape}');
        expect(props.onKeep).toHaveBeenCalledTimes(2);
    });

    it('while busy, says "Making public…" politely and the confirm cannot fire again', async () => {
        const user = userEvent.setup();
        const props = renderDialog({ busy: true });

        expect(screen.getByRole('status').textContent).toBe(m.busy);
        await user.click(screen.getByRole('button', { name: 'Make public' }));

        expect(props.onConfirm).not.toHaveBeenCalled();
    });

    it('a failed change is said inside the dialog', () => {
        renderDialog({ error: true });

        expect(screen.getByRole('alert').textContent).toBe(recipeActionMessages.en.visibility.error);
    });
});
