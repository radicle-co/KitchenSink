// @vitest-environment jsdom
/**
 * Component tests for the WEB paste leaf — every state: empty, admissible, refused (each refusal reason),
 * submitting, and failed.
 *
 * ⛔ The assertion that matters most is the NEGATIVE one: a refused paste must not reach `onSubmit`. The
 * client refuses it again with no network call, so a leaf that fired anyway would produce a thrown
 * `InvalidRequestError` from a control the cook was invited to press — a defect that looks like a service
 * outage and is not one.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ParsePasteForm } from '../ParsePasteForm.js';
import { recipeParseMessages } from '../messages.js';
import { toParseSubmissionModel } from '../model.js';
import type { ParsePasteFormProps } from '../props.js';

const messages = recipeParseMessages.en;

afterEach(cleanup);

/** Render the form over the REAL submission projection for `value`, so no test hand-writes an admission. */
function renderForm(value: string, overrides: Partial<ParsePasteFormProps> = {}) {
    const props: ParsePasteFormProps = {
        value,
        onChange: vi.fn(),
        submission: toParseSubmissionModel(value, messages),
        onSubmit: vi.fn(),
        submitting: false,
        errorNotice: undefined,
        onBack: vi.fn(),
        ...overrides,
    };

    render(<ParsePasteForm {...props} />);

    return props;
}

describe('ParsePasteForm (web)', () => {
    it('renders an empty, labelled field with the submit control disabled', () => {
        renderForm('');

        expect(screen.getByLabelText(messages.pasteLabel)).toHaveProperty('value', '');
        expect((screen.getByRole('button', { name: messages.pasteSubmit }) as HTMLButtonElement).disabled).toBe(true);
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

    it('⛔ names the offending line and blocks submission for an over-long line', async () => {
        const props = renderForm(`ok\n${'x'.repeat(1001)}`);

        expect(screen.getByRole('alert').textContent).toContain(
            'Line 2 is longer than 1000 characters. Shorten it and try again.',
        );
        const control = screen.getByRole('button', { name: messages.pasteSubmit });
        expect((control as HTMLButtonElement).disabled).toBe(true);
        await userEvent.click(control);
        expect(props.onSubmit).not.toHaveBeenCalled();
    });

    it('lists every offending line at once rather than one round trip at a time', () => {
        const long = 'x'.repeat(1001);
        renderForm(`${long}\nok\n${long}`);

        const alert = screen.getByRole('alert');
        expect(alert.textContent).toContain('Line 1');
        expect(alert.textContent).toContain('Line 3');
    });

    it('blocks a paste past the line cap, naming the cap', () => {
        renderForm(Array.from({ length: 201 }, (_, i) => `line ${String(i)}`).join('\n'));

        expect(screen.getByRole('alert').textContent).toContain('That’s more than 200 lines');
        expect((screen.getByRole('button', { name: messages.pasteSubmit }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('does not shout at a cook who has not typed anything yet', () => {
        // An empty field is the RESTING state, not an error. `refusalNoLines` is true but announcing it
        // before a single keystroke turns the first thing a user sees into a complaint.
        renderForm('');

        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('announces the in-flight create and refuses a second press', async () => {
        const props = renderForm('2 cups flour', { submitting: true });
        const control = screen.getByRole('button', { name: messages.pasteSubmit });

        expect(screen.getByRole('status').textContent).toContain(messages.pasteSubmitting);
        expect((control as HTMLButtonElement).disabled).toBe(true);
        await userEvent.click(control);
        expect(props.onSubmit).not.toHaveBeenCalled();
    });

    it('⚠️ keeps the pasted text on screen when the create fails — a cook must not retype it', () => {
        renderForm('2 cups flour', { errorNotice: messages.pasteFailed });

        expect(screen.getByRole('alert').textContent).toContain(messages.pasteFailed);
        expect(screen.getByLabelText(messages.pasteLabel)).toHaveProperty('value', '2 cups flour');
        expect((screen.getByRole('button', { name: messages.pasteSubmit }) as HTMLButtonElement).disabled).toBe(false);
    });
});

describe('ParsePasteForm — the way out', () => {
    it('⛔ offers a back control even with nothing typed — the submit is disabled, this must not be', async () => {
        const user = userEvent.setup();
        const props = renderForm('');

        await user.click(screen.getByRole('button', { name: recipeParseMessages.en.backAction }));

        expect(props.onBack).toHaveBeenCalledTimes(1);
    });
});
