/**
 * Native component tests for the paste leaf (react-native-web under jsdom).
 *
 * Mirrors the web leaf state for state — empty, admissible, each refusal reason, submitting, failed — so
 * the two platforms cannot disagree about which pastes a cook may submit. The admission verdict comes from
 * the shared `toParseSubmissionModel` in both, and these are what prove each leaf actually HONOURS it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { ParsePasteForm } from '../ParsePasteForm.native.js';
import { recipeParseMessages } from '../messages.js';
import { toParseSubmissionModel } from '../model.js';
import type { ParsePasteFormProps } from '../props.js';

const messages = recipeParseMessages.en;

afterEach(cleanup);

/** Render over the REAL submission projection for `value`, so no test hand-writes an admission verdict. */
function renderForm(value: string, overrides: Partial<ParsePasteFormProps> = {}) {
    const props: ParsePasteFormProps = {
        value,
        onChange: vi.fn(),
        submission: toParseSubmissionModel(value, messages),
        onSubmit: vi.fn(),
        submitting: false,
        errorNotice: undefined,
        ...overrides,
    };

    render(<ParsePasteForm {...props} />);

    return props;
}

describe('ParsePasteForm (native)', () => {
    it('renders an empty, labelled field with the submit control unavailable', () => {
        renderForm('');

        expect(screen.getByLabelText(messages.pasteLabel)).toHaveProperty('value', '');
        expect(screen.getByRole('button', { name: messages.pasteSubmit }).getAttribute('aria-disabled')).toBe('true');
    });

    it('reports every keystroke to its owner — the field is fully controlled', async () => {
        const props = renderForm('');

        await userEvent.type(screen.getByLabelText(messages.pasteLabel), 'a');

        expect(props.onChange).toHaveBeenCalledWith('a');
    });

    it('counts the lines the job would actually store, not the raw newlines', () => {
        renderForm('2 cups flour\n\n   \n1 tsp salt');

        expect(screen.getByText('2 lines ready')).toBeTruthy();
    });

    it('says "1 line" in the singular', () => {
        renderForm('2 cups flour');

        expect(screen.getByText('1 line ready')).toBeTruthy();
    });

    it('submits an admissible paste', async () => {
        const props = renderForm('2 cups flour');

        await userEvent.click(screen.getByRole('button', { name: messages.pasteSubmit }));

        expect(props.onSubmit).toHaveBeenCalledTimes(1);
    });

    it('⛔ names the offending line and makes the control unavailable for an over-long line', () => {
        renderForm(`ok\n${'x'.repeat(1001)}`);

        expect(screen.getByText('Line 2 is longer than 1000 characters. Shorten it and try again.')).toBeTruthy();
        expect(screen.getByRole('button', { name: messages.pasteSubmit }).getAttribute('aria-disabled')).toBe('true');
    });

    it('lists every offending line at once rather than one round trip at a time', () => {
        const long = 'x'.repeat(1001);
        renderForm(`${long}\nok\n${long}`);

        expect(screen.getByText('Line 1 is longer than 1000 characters. Shorten it and try again.')).toBeTruthy();
        expect(screen.getByText('Line 3 is longer than 1000 characters. Shorten it and try again.')).toBeTruthy();
    });

    it('blocks a paste past the line cap, naming the cap', () => {
        renderForm(Array.from({ length: 201 }, (_, i) => `line ${String(i)}`).join('\n'));

        expect(screen.getByText('That’s more than 200 lines. Paste them in smaller batches.')).toBeTruthy();
        expect(screen.getByRole('button', { name: messages.pasteSubmit }).getAttribute('aria-disabled')).toBe('true');
    });

    it('does not shout at a cook who has not typed anything yet', () => {
        // An empty field is the RESTING state, not an error — announcing the (true) "nothing to read yet"
        // refusal before a keystroke turns the first thing a user sees into a complaint.
        renderForm('');

        expect(screen.queryByText(messages.refusalNoLines)).toBeNull();
    });

    it('announces the in-flight create and makes the control unavailable', () => {
        renderForm('2 cups flour', { submitting: true });

        expect(screen.getByText(messages.pasteSubmitting)).toBeTruthy();
        expect(screen.getByRole('button', { name: messages.pasteSubmit }).getAttribute('aria-disabled')).toBe('true');
    });

    it('⚠️ keeps the pasted text on screen when the create fails — a cook must not retype it', () => {
        renderForm('2 cups flour', { errorNotice: messages.pasteFailed });

        expect(screen.getByText(messages.pasteFailed)).toBeTruthy();
        expect(screen.getByLabelText(messages.pasteLabel)).toHaveProperty('value', '2 cups flour');
        expect(screen.getByRole('button', { name: messages.pasteSubmit }).getAttribute('aria-disabled')).not.toBe(
            'true',
        );
    });
});
