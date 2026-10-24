/**
 * Native component tests for the "Make this collection public?" confirm (plan 2026-10-14-009 T1), rendered via
 * react-native-web under jsdom. Mirrors the web leaf's branches — closed, every consequence's words, exactly two verbs,
 * confirm and keep — so the two platforms cannot drift.
 */
import { LocaleProvider } from '@commise/i18n/react';
import { fireEvent } from '@testing-library/dom';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CollectionMakePublicDialog } from '../CollectionMakePublicDialog.js';
import type { CollectionMakePublicDialogProps } from '../detailModel.js';
import { collectionMessages } from '../messages.js';

const m = collectionMessages.en.dialogs;

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

describe('CollectionMakePublicDialog (native)', () => {
    it('renders nothing while closed', () => {
        renderDialog({ open: false });

        expect(screen.queryByRole('heading', { name: m.makePublicTitle })).toBeNull();
    });

    it.each([
        ['final', m.makePublicBodyFinal],
        ['premium', m.makePublicBodyPremium],
        ['unknown', m.makePublicBodyUnknown],
    ] as const)(
        'under %s, is an interrupting alert titled by the question, saying what it costs',
        (consequence, body) => {
            renderDialog({ consequence });

            expect(screen.getByRole('alert')).toBeTruthy();
            expect(screen.getByRole('heading', { name: 'Make this collection public?' })).toBeTruthy();
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
});
