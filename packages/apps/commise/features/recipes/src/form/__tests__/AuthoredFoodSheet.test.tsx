// @vitest-environment jsdom
/**
 * Component tests for the web authored-food Sheet (`docs/design/rowEditorOpenDecisions.md` item 1): the create-my-own-
 * food form, moved off the picker onto `@commise/ui/sheet` (`docs/design/rowEditorBlueprint.md` decision 2).
 *
 * Every state the form has (§4 "Authoring"): closed, open, a field error, a failed submit, submitting, the duplicate,
 * its reuse in flight and its reuse failed; and the Sheet's own rules: its name, its close control, focus to the name
 * field on open, every close route reaching `onCancel`, and `onDismissed` once it is gone.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AuthoredFoodCreateState } from '../../hooks/authoredFoodCreate.model.js';
import { recipeMessages } from '../../messages.js';
import { AuthoredFoodSheet } from '../AuthoredFoodSheet.js';
import { recipeFormMessages } from '../messages.js';

afterEach(cleanup);

const copy = recipeMessages.en.ingredientCreateFood;
const form = recipeFormMessages.en;
const DRAFT = { name: 'saffron', calories: '', proteinG: '', carbsG: '', fatG: '' };

const handlers = () => ({
    onFieldChange: vi.fn(),
    onSubmit: vi.fn(),
    onReuse: vi.fn(),
    onCancel: vi.fn(),
    onDismissed: vi.fn(),
});

const renderSheet = (state: AuthoredFoodCreateState) => {
    const on = handlers();
    const view = render(<AuthoredFoodSheet state={state} {...on} />);

    return { ...on, ...view };
};

const OPEN: AuthoredFoodCreateState = { kind: 'open', draft: DRAFT, fieldErrors: {}, submitFailed: false };

describe('AuthoredFoodSheet (web)', () => {
    it('closed: no dialog, and the same sheet opened is a dialog', () => {
        const on = handlers();
        const { rerender } = render(<AuthoredFoodSheet state={{ kind: 'closed' }} {...on} />);

        expect(screen.queryByRole('dialog')).toBeNull();

        rerender(<AuthoredFoodSheet state={OPEN} {...on} />);

        expect(screen.getByRole('dialog', { name: 'Create “saffron”' })).toBeTruthy();
    });

    it('open: a dialog titled for the food, its close control named, the typed name in the name field, focused', () => {
        renderSheet(OPEN);

        expect(screen.getByRole('dialog', { name: 'Create “saffron”' })).toBeTruthy();
        expect(screen.getByRole('button', { name: copy.close })).toBeTruthy();

        const name = screen.getByRole<HTMLInputElement>('textbox', { name: copy.nameLabel });

        expect(name.value).toBe('saffron');
        expect(document.activeElement).toBe(name);

        for (const label of [copy.caloriesLabel, copy.proteinLabel, copy.carbsLabel, copy.fatLabel]) {
            expect(screen.getByRole('textbox', { name: label })).toBeTruthy();
        }

        expect(screen.getByText(copy.privateHint)).toBeTruthy();
    });

    it('typing reports each field; the submit button and Enter submit', async () => {
        const user = userEvent.setup();
        const { onFieldChange, onSubmit } = renderSheet(OPEN);

        await user.type(screen.getByRole('textbox', { name: copy.caloriesLabel }), '3');
        expect(onFieldChange).toHaveBeenLastCalledWith('calories', '3');

        await user.click(screen.getByRole('button', { name: copy.submit }));
        await user.type(screen.getByRole('textbox', { name: copy.nameLabel }), '{Enter}');

        expect(onSubmit).toHaveBeenCalledTimes(2);
    });

    it('a field error is worded beside its field, which is marked invalid and described by it', () => {
        renderSheet({ ...OPEN, fieldErrors: { calories: 'not_a_number' } });

        const calories = screen.getByRole('textbox', { name: copy.caloriesLabel });
        const error = screen.getByText(copy.errorNotANumber);

        expect(calories.getAttribute('aria-invalid')).toBe('true');
        expect(calories.getAttribute('aria-describedby')).toBe(error.id);
    });

    it('a failed submit stays in the Sheet with the draft, said assertively (statusAuthorFailed)', () => {
        renderSheet({ ...OPEN, draft: { ...DRAFT, calories: '310' }, submitFailed: true });

        expect(screen.getByRole('alert').textContent).toBe(form.statusAuthorFailed);
        expect(screen.getByRole<HTMLInputElement>('textbox', { name: copy.caloriesLabel }).value).toBe('310');
    });

    it('submitting: the fields read only, Create reads busy, Cancel refuses, and progress is said', async () => {
        const user = userEvent.setup();
        const { onCancel, onSubmit } = renderSheet({ kind: 'submitting', draft: DRAFT });
        const submit = screen.getByRole('button', { name: copy.submit });
        const cancel = screen.getByRole('button', { name: copy.cancel });

        expect(screen.getByRole<HTMLInputElement>('textbox', { name: copy.nameLabel }).readOnly).toBe(true);
        expect(submit.getAttribute('aria-busy')).toBe('true');
        expect(cancel.getAttribute('aria-disabled')).toBe('true');
        expect(screen.getByRole('status').textContent).toBe(copy.submitting);

        await user.click(cancel);
        await user.click(submit);

        expect(onCancel).not.toHaveBeenCalled();
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it('duplicate: its own sentence, and Use that one takes focus and reuses the food', async () => {
        const user = userEvent.setup();
        const { onReuse } = renderSheet({
            kind: 'duplicate',
            draft: DRAFT,
            existingFoodId: 'food_mine',
            reusePending: false,
            reuseFailed: false,
        });
        const reuse = screen.getByRole('button', { name: copy.duplicateReuse });

        expect(screen.getByText(copy.duplicateNotice.replace('{name}', 'saffron'))).toBeTruthy();
        expect(document.activeElement).toBe(reuse);

        await user.click(reuse);
        expect(onReuse).toHaveBeenCalledTimes(1);
    });

    it('duplicate, reuse in flight: it reads busy and refuses a second press; a failed reuse is said assertively', async () => {
        const user = userEvent.setup();
        const pending = renderSheet({
            kind: 'duplicate',
            draft: DRAFT,
            existingFoodId: 'food_mine',
            reusePending: true,
            reuseFailed: false,
        });
        const reuse = screen.getByRole('button', { name: copy.duplicateReuse });

        expect(reuse.getAttribute('aria-busy')).toBe('true');
        await user.click(reuse);
        expect(pending.onReuse).not.toHaveBeenCalled();
        cleanup();

        renderSheet({
            kind: 'duplicate',
            draft: DRAFT,
            existingFoodId: 'food_mine',
            reusePending: false,
            reuseFailed: true,
        });
        expect(screen.getByRole('alert').textContent).toBe(copy.duplicateReuseFailed);
    });

    it.each([
        [
            'Cancel',
            async (user: ReturnType<typeof userEvent.setup>) =>
                user.click(screen.getByRole('button', { name: copy.cancel })),
        ],
        [
            'Close',
            async (user: ReturnType<typeof userEvent.setup>) =>
                user.click(screen.getByRole('button', { name: copy.close })),
        ],
        ['Escape', async (user: ReturnType<typeof userEvent.setup>) => user.keyboard('{Escape}')],
    ])('%s reaches onCancel', async (_route, act) => {
        const user = userEvent.setup();
        const { onCancel } = renderSheet(OPEN);

        await act(user);

        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('reports onDismissed once the Sheet is gone, and not before', async () => {
        const on = handlers();
        const { rerender } = render(<AuthoredFoodSheet state={OPEN} {...on} />);

        expect(on.onDismissed).not.toHaveBeenCalled();
        rerender(<AuthoredFoodSheet state={{ kind: 'closed' }} {...on} />);
        await new Promise((resolve) => {
            setTimeout(resolve, 0);
        });

        expect(screen.queryByRole('dialog')).toBeNull();
        expect(on.onDismissed).toHaveBeenCalledTimes(1);
    });
});
