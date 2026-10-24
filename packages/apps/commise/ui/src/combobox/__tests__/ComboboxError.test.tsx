/**
 * Combobox (web) — the field's own error (`error`, `docs/design/uiOverhaul/cuisineField.md` §3.3, §4 P4).
 *
 * The slot is drawn directly under the field row, before the host's `belowField` line and before the list, as a plain
 * paragraph with NO role: it is never live, because a host that must speak an error uses `alertAnnouncement`, and a
 * second voice would say it twice. The input is tied to it by `aria-describedby` (error, then hint, then the host's id)
 * and marked `aria-invalid`.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type FC } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fieldErrorId } from '../../input/props.js';
import { Combobox } from '../Combobox.js';
import type { ComboboxProps } from '../props.js';

afterEach(cleanup);

const MESSAGE = 'Choose a cuisine, or type your own.';

const Host: FC<Partial<ComboboxProps> & { readonly initial?: string }> = ({ initial = '', ...overrides }) => {
    const [value, setValue] = useState(initial);

    return (
        <Combobox
            id="cuisine"
            label="Cuisine"
            listLabel="Cuisine suggestions"
            value={value}
            onValueChange={setValue}
            groups={value === '' ? [] : [{ key: 'all', label: 'All', options: [{ key: 'thai', label: 'Thai' }] }]}
            onSelect={vi.fn()}
            countAnnouncement=""
            {...overrides}
        />
    );
};

const field = (): HTMLInputElement => screen.getByRole('combobox', { name: 'Cuisine' });

describe('fieldErrorId', () => {
    it('is the field id plus -error, beside the hint and label ids', () => {
        expect(fieldErrorId('cuisine')).toBe('cuisine-error');
    });
});

describe('Combobox (web) — the field’s own error', () => {
    it('draws it as a plain paragraph with the error id and no role, so it is not announced by itself', () => {
        render(<Host error={MESSAGE} />);
        const message = screen.getByText(MESSAGE);

        expect(message.tagName).toBe('P');
        expect(message.id).toBe('cuisine-error');
        expect(message.getAttribute('role')).toBeNull();
        expect(message.closest('[aria-live]')).toBeNull();
        // The host's `alertAnnouncement` region is the only alert, and it is empty: the slot added no second voice.
        expect(screen.queryByRole('alert')?.textContent ?? '').toBe('');
    });

    it('makes the field invalid and describes it by the error, then the hint, then the host’s id', () => {
        render(<Host error={MESSAGE} hint="Choose one." describedBy="row-note" />);

        expect(field().getAttribute('aria-invalid')).toBe('true');
        expect((field().getAttribute('aria-describedby') ?? '').split(' ')).toEqual([
            'cuisine-error',
            'cuisine-hint',
            'row-note',
        ]);
    });

    it('describes the field by the error alone with no hint and no host id', () => {
        render(<Host error={MESSAGE} />);

        expect(field().getAttribute('aria-describedby')).toBe('cuisine-error');
    });

    it('still lists the error first with the label hidden', () => {
        render(<Host labelVisibility="hidden" error={MESSAGE} hint="Choose one." />);

        expect(field().getAttribute('aria-describedby')).toBe('cuisine-error cuisine-hint');
    });

    it('draws it directly under the field, before the host’s line and before the list', async () => {
        const user = userEvent.setup();
        render(<Host error={MESSAGE} belowField={<p>Live reading</p>} />);
        await user.type(field(), 'th');
        const message = screen.getByText(MESSAGE);

        expect(field().compareDocumentPosition(message)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
        expect(message.compareDocumentPosition(screen.getByText('Live reading'))).toBe(
            Node.DOCUMENT_POSITION_FOLLOWING,
        );
        expect(message.compareDocumentPosition(screen.getByRole('listbox'))).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    });

    it('draws nothing and sets neither attribute without an error', () => {
        render(<Host />);

        expect(document.getElementById('cuisine-error')).toBeNull();
        expect(field().getAttribute('aria-invalid')).toBeNull();
        expect(field().getAttribute('aria-describedby')).toBeNull();
    });

    it('keeps `invalid` for an edge with no text: invalid, and nothing to describe it by', () => {
        render(<Host invalid />);

        expect(field().getAttribute('aria-invalid')).toBe('true');
        expect(field().getAttribute('aria-describedby')).toBeNull();
    });
});
