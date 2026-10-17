// @vitest-environment jsdom
/**
 * Component tests for the web "Make this collection public?" confirm (plan 2026-10-14-009 T1): what a downgraded owner
 * sees before a private collection goes public. Every consequence's words, the two verb buttons (no Premium button, no
 * third choice — the deceptive-pattern rule), focus opening on Keep private, and Escape as Keep.
 */
import { LocaleProvider } from '@commise/i18n/react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CollectionMakePublicDialog } from '../CollectionMakePublicDialog.js';
import type { CollectionMakePublicDialogProps } from '../detailModel.js';

afterEach(cleanup);

function renderDialog(overrides: Partial<CollectionMakePublicDialogProps> = {}) {
    const props: CollectionMakePublicDialogProps = {
        open: true,
        consequence: 'final',
        onConfirm: vi.fn(),
        onKeep: vi.fn(),
        ...overrides,
    };
    render(
        <LocaleProvider locale="en">
            <CollectionMakePublicDialog {...props} />
        </LocaleProvider>,
    );

    return props;
}

describe('CollectionMakePublicDialog (web)', () => {
    it('renders nothing while closed', () => {
        renderDialog({ open: false });

        expect(screen.queryByRole('alertdialog')).toBeNull();
    });

    it.each([
        [
            'final',
            "Anyone can see a public collection and save a copy. You won't be able to make this one private again.",
        ],
        [
            'premium',
            "Anyone can see a public collection and save a copy. To make this one private again, you'll need Premium.",
        ],
        [
            'unknown',
            'Anyone can see a public collection and save a copy. You may not be able to make this one private again.',
        ],
    ] as const)('under %s, asks "Make this collection public?" and says plainly what it costs', (consequence, body) => {
        renderDialog({ consequence });

        const dialog = screen.getByRole('alertdialog', { name: 'Make this collection public?' });

        expect(dialog.getAttribute('aria-modal')).toBe('true');
        expect(screen.getByText(body)).toBeTruthy();
    });

    it('⛔ offers exactly two verbs — Keep private and Make public — and nothing that sells', () => {
        renderDialog({ consequence: 'premium' });

        expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
            'Keep private',
            'Make public',
        ]);
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
        expect(props.onKeep).not.toHaveBeenCalled();

        await user.click(screen.getByRole('button', { name: 'Keep private' }));
        await user.keyboard('{Escape}');
        expect(props.onKeep).toHaveBeenCalledTimes(2);
    });
});
