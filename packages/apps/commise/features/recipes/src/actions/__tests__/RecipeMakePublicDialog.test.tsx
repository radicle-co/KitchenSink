// @vitest-environment jsdom
/**
 * Component tests for the web "Make this recipe public?" confirm (UX SPECIFY 2026-10-15; plan 2026-10-14-009 Q5): what
 * a downgraded owner sees before a private recipe goes public. Every consequence's words, the two verb buttons (no
 * Pro button, no third choice — the deceptive-pattern rule), focus opening on Keep private, Escape as Keep, and the
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
        consequence: 'frees',
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

    // REWRITTEN for the owner ruling of 2026-10-26 (ADR-0073): public is NEVER final. The `final` and `unknown` words
    // ("You won't be able to make this one private again", "You may not be able to...") are gone; a private recipe made
    // public frees one of the cook's slots, and a free slot is all it takes to make it private again.
    it.each([
        [
            'frees',
            'Anyone can see a public recipe and save a copy. It frees one of your private slots, and you can make it private again while you have a free slot.',
        ],
        ['premium', "Anyone can see a public recipe and save a copy. To make this one private again, you'll need Pro."],
    ] as const)('under %s, asks "Make this recipe public?" and says plainly what it costs', (consequence, body) => {
        renderDialog({ consequence });

        const dialog = screen.getByRole('alertdialog', { name: 'Make this recipe public?' });

        expect(dialog.getAttribute('aria-modal')).toBe('true');
        expect(screen.getByText(body)).toBeTruthy();
    });

    it('⛔ never claims public is final, in any consequence', () => {
        for (const consequence of ['frees', 'premium'] as const) {
            const { unmount } = render(
                <RecipeMakePublicDialog open consequence={consequence} onConfirm={vi.fn()} onKeep={vi.fn()} />,
            );

            expect(screen.queryByText(/won.t be able|may not be able|never/iu)).toBeNull();
            unmount();
        }
    });

    it('⛔ offers exactly two verbs — Keep private and Make public — and nothing that sells', () => {
        renderDialog({ consequence: 'premium' });

        const buttons = screen.getAllByRole('button').map((button) => button.textContent);

        expect(buttons).toEqual(['Keep private', 'Make public']);
        expect(screen.queryByRole('button', { name: /Pro/u })).toBeNull();
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
