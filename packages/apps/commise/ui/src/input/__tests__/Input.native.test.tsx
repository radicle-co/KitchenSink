import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

import { Input } from '../Input.native.js';

/**
 * Input (native) — rendered via react-native-web under jsdom. Covers the primitive's reason to exist: the
 * label is programmatically associated with the field, and the error slot (when present) is announced with
 * the field via `aria-invalid` + `aria-describedby` + an `alert` role. Also the controlled value round-trip.
 */

afterEach(cleanup);

describe('Input (native)', () => {
    it('associates the label with the field — the label text is the accessible name', () => {
        render(<Input label="Email" value="" onChangeText={vi.fn()} />);

        const field = screen.getByRole('textbox', { name: 'Email' });
        // The name comes from an aria-labelledby association to the visible label element (not a bare
        // aria-label), so the label and field are programmatically linked.
        const labelledby = field.getAttribute('aria-labelledby');
        expect(labelledby).toBeTruthy();
        expect(document.getElementById(labelledby ?? '')?.textContent).toContain('Email');
        // getByLabelText resolves via the same association.
        expect(screen.getByLabelText('Email')).toBe(field);
    });

    it('renders the controlled value and reports edits', () => {
        const onChangeText = vi.fn();
        render(<Input label="Email" value="a@b.com" onChangeText={onChangeText} />);

        const field = screen.getByRole<HTMLInputElement>('textbox', { name: 'Email' });
        expect(field.value).toBe('a@b.com');

        fireEvent.change(field, { target: { value: 'c@d.com' } });
        expect(onChangeText).toHaveBeenCalledWith('c@d.com');
    });

    it('is valid and shows no error slot when no error is given', () => {
        render(<Input label="Email" value="" onChangeText={vi.fn()} />);

        expect(screen.queryByRole('alert')).toBeNull();
        const field = screen.getByRole('textbox', { name: 'Email' });
        expect(field.getAttribute('aria-invalid')).not.toBe('true');
        expect(field.getAttribute('aria-describedby')).toBeNull();
    });

    it('associates an error slot with the field (aria-invalid + aria-describedby + alert)', () => {
        render(<Input label="Email" value="nope" onChangeText={vi.fn()} error="Enter a valid email" />);

        const alert = screen.getByRole('alert');
        expect(alert.textContent).toContain('Enter a valid email');

        const field = screen.getByRole('textbox', { name: 'Email' });
        expect(field.getAttribute('aria-invalid')).toBe('true');
        // The field points at the very element that carries the message — a real association, not just
        // two elements that happen to sit near each other.
        expect(field.getAttribute('aria-describedby')).toBe(alert.getAttribute('id'));
    });
});
