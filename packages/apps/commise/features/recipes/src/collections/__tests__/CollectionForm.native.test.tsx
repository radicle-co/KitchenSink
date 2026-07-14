/**
 * Native component tests for the collection form (rendered via react-native-web under jsdom). Mirrors the
 * web leaf across every branch — mode-dependent title/submit label, the controlled name input, submit and
 * cancel, the error display, and the submitting/disabled state — so the two platform renders cannot drift.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { CollectionForm } from '../CollectionForm.native.js';
import type { CollectionFormProps } from '../model.js';

afterEach(cleanup);

const noop = () => undefined;

function renderForm(overrides: Partial<CollectionFormProps> = {}) {
    const props: CollectionFormProps = {
        mode: 'create',
        name: '',
        onChange: noop,
        onSubmit: noop,
        onCancel: noop,
        ...overrides,
    };
    render(<CollectionForm {...props} />);

    return props;
}

describe('CollectionForm (native) — mode labels', () => {
    it('renders the create title and submit label in create mode', () => {
        renderForm({ mode: 'create' });

        expect(screen.getByRole('heading', { name: 'New collection' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Create' })).toBeTruthy();
    });

    it('renders the rename title and submit label in rename mode', () => {
        renderForm({ mode: 'rename' });

        expect(screen.getByRole('heading', { name: 'Rename collection' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
    });
});

describe('CollectionForm (native) — name input', () => {
    it('reports name changes upward', () => {
        const onChange = vi.fn();
        renderForm({ onChange });

        fireEvent.change(screen.getByLabelText('Collection name'), { target: { value: 'Holiday Baking' } });

        expect(onChange).toHaveBeenCalledWith('Holiday Baking');
    });
});

describe('CollectionForm (native) — submit & cancel', () => {
    it('reports submit and cancel upward', () => {
        const onSubmit = vi.fn();
        const onCancel = vi.fn();
        renderForm({ mode: 'create', name: 'Weeknight Dinners', onSubmit, onCancel });

        fireEvent.click(screen.getByRole('button', { name: 'Create' }));
        expect(onSubmit).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onCancel).toHaveBeenCalledTimes(1);
    });
});

describe('CollectionForm (native) — error', () => {
    it('shows the error message when one is provided', () => {
        renderForm({ error: 'A collection with that name already exists.' });

        expect(screen.getByRole('alert').textContent).toBe('A collection with that name already exists.');
    });

    it('shows no alert when there is no error', () => {
        renderForm();

        expect(screen.queryByRole('alert')).toBeNull();
    });
});

describe('CollectionForm (native) — submitting state', () => {
    it('does not fire submit while submitting', () => {
        const onSubmit = vi.fn();
        renderForm({ submitting: true, onSubmit });

        fireEvent.click(screen.getByRole('button', { name: 'Create' }));

        expect(onSubmit).not.toHaveBeenCalled();
    });
});
