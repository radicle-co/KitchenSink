import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

import { placeholderContrast } from '@commise/test-utils';

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

    it('draws the PLACEHOLDER above the WCAG AA body-text floor on its white field', () => {
        render(<Input label="Email" value="" onChangeText={vi.fn()} placeholder="you@example.com" />);

        // Placeholder copy is TEXT a reader reads — a field's only visible instruction before they type — so it
        // owes the 4.5:1 of SC 1.4.3, not the 3:1 an accent owes. This primitive passed
        // `placeholderTextColor={palette.mist}`, which measured 1.90:1 against its own white field: the palette
        // JSDoc in `../../tokens/colors.ts` states once that `mist` is a hairline tone and never a text tone.
        // Fixing it HERE fixes every form built on the primitive, which is the reason it exists.
        //
        // `placeholderContrast` reads the colour react-native-web actually paints (the `--placeholderTextColor`
        // custom property its compiled `::placeholder` rule resolves) and composites the field's own background
        // over the surface — so this fails if the token drifts AND if the prop stops being passed at all.
        //
        // There is no web `Input.tsx`: this primitive is native-only, so there is no web half to keep in step.
        expect(
            placeholderContrast(screen.getByRole('textbox', { name: 'Email' })),
            'Input placeholder on its white field',
        ).toBeGreaterThanOrEqual(4.5);
    });
});
