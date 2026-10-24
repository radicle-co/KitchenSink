/**
 * Native component tests for the "Make this recipe public?" confirm (UX SPECIFY 2026-10-15), rendered via
 * react-native-web under jsdom. Mirrors the web leaf's branches — closed, every consequence's words, exactly two verbs,
 * confirm and keep, busy and failed — so the two platforms cannot drift.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

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

describe('RecipeMakePublicDialog (native)', () => {
    it('renders nothing while closed', () => {
        renderDialog({ open: false });

        expect(screen.queryByRole('heading', { name: m.title })).toBeNull();
    });

    it.each([
        ['final', m.bodyFinal],
        ['premium', m.bodyPremium],
        ['unknown', m.bodyUnknown],
    ] as const)(
        'under %s, is an interrupting alert titled by the question, saying what it costs',
        (consequence, body) => {
            renderDialog({ consequence });

            expect(screen.getByRole('alert')).toBeTruthy();
            expect(screen.getByRole('heading', { name: 'Make this recipe public?' })).toBeTruthy();
            expect(screen.getByText(body)).toBeTruthy();
        },
    );

    it('⛔ offers exactly two verbs — Keep private and Make public — and nothing that sells', () => {
        renderDialog({ consequence: 'premium' });

        const names = screen.getAllByRole('button').map((button) => button.textContent);

        expect(names).toEqual(expect.arrayContaining(['Keep private', 'Make public']));
        expect(names).toHaveLength(2);
        expect(screen.queryByRole('button', { name: /Premium/u })).toBeNull();
    });

    it('Make public confirms; Keep private keeps', () => {
        const props = renderDialog();

        fireEvent.click(screen.getByRole('button', { name: 'Make public' }));
        fireEvent.click(screen.getByRole('button', { name: 'Keep private' }));

        expect(props.onConfirm).toHaveBeenCalledTimes(1);
        expect(props.onKeep).toHaveBeenCalledTimes(1);
    });

    it('while busy, says "Making public…" and the confirm cannot fire again', () => {
        const props = renderDialog({ busy: true });

        expect(screen.getByText(m.busy)).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Make public' }));

        expect(props.onConfirm).not.toHaveBeenCalled();
    });

    it('a failed change is said inside the dialog', () => {
        renderDialog({ error: true });

        expect(screen.getByText(recipeActionMessages.en.visibility.error)).toBeTruthy();
    });
});
