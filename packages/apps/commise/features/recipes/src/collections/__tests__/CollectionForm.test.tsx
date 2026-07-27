// @vitest-environment jsdom
/**
 * Component tests for the web collection form (create/rename). Covers every branch T073 requires — the
 * mode-dependent title and submit label (create vs rename), the controlled name input and its change
 * contract, submit and cancel, the error display, and the submitting/disabled state — asserting on
 * role/name/text and mock-call arguments so a wrong branch or a dropped handler fails.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CollectionForm } from '../CollectionForm.js';
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

/**
 * This form's title IS the page title of `/collections/new` and `/collections/[id]/rename`, so it must be the
 * `h1` (levels asserted, not just names). It used to be an `h2` beneath the app shell's hard-coded "Home"
 * `h1`; now that the shell's top-bar title is plain banner text, an `h2` here would leave both routes with no
 * `h1` at all.
 */
describe('CollectionForm (web) — mode labels', () => {
    it('renders the create title as the page’s h1, with the create submit label', () => {
        renderForm({ mode: 'create' });

        expect(screen.getByRole('heading', { level: 1, name: 'New collection' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Create' })).toBeTruthy();
    });

    it('renders the rename title as the page’s h1, with the save submit label', () => {
        renderForm({ mode: 'rename' });

        expect(screen.getByRole('heading', { level: 1, name: 'Rename collection' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
    });
});

describe('CollectionForm (web) — name input', () => {
    it('reflects the controlled name value', () => {
        renderForm({ name: 'Weeknight Dinners' });

        expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Collection name' }).value).toBe(
            'Weeknight Dinners',
        );
    });

    it('reports name changes upward', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        renderForm({ onChange });

        // This is a controlled input backed by a `vi.fn()` onChange (no state update between keystrokes), so
        // `user.type` would fire once per character with the char alone, never the full string — paste
        // fires a single change event with the whole value, matching the "one edit" intent of this test.
        const input = screen.getByRole('textbox', { name: 'Collection name' });
        await user.click(input);
        await user.paste('Holiday Baking');

        expect(onChange).toHaveBeenCalledWith('Holiday Baking');
    });
});

describe('CollectionForm (web) — submit & cancel', () => {
    it('reports submit upward', async () => {
        const user = userEvent.setup();
        const onSubmit = vi.fn();
        renderForm({ mode: 'create', name: 'Weeknight Dinners', onSubmit });

        await user.click(screen.getByRole('button', { name: 'Create' }));

        expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    it('reports cancel upward', async () => {
        const user = userEvent.setup();
        const onCancel = vi.fn();
        renderForm({ onCancel });

        await user.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(onCancel).toHaveBeenCalledTimes(1);
    });
});

describe('CollectionForm (web) — error', () => {
    it('shows the error message when one is provided', () => {
        renderForm({ error: 'A collection with that name already exists.' });

        expect(screen.getByRole('alert').textContent).toBe('A collection with that name already exists.');
    });

    it('shows no alert when there is no error', () => {
        renderForm();

        expect(screen.queryByRole('alert')).toBeNull();
    });
});

describe('CollectionForm (web) — submitting state', () => {
    it('disables the input, submit, and cancel while submitting', () => {
        renderForm({ submitting: true });

        expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Collection name' }).disabled).toBe(true);
        expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Create' }).disabled).toBe(true);
        expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Cancel' }).disabled).toBe(true);
    });

    it('does not fire submit while submitting', async () => {
        const user = userEvent.setup();
        const onSubmit = vi.fn();
        renderForm({ submitting: true, onSubmit });

        await user.click(screen.getByRole('button', { name: 'Create' }));

        expect(onSubmit).not.toHaveBeenCalled();
    });
});
