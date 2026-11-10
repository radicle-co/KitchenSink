// @vitest-environment jsdom
/**
 * The food edit sheet, web (states 13 and 14): a private food says Save, a public food says Send for review with the review
 * notice above the form, an unchanged public form cannot be sent and says why, and failures are said in the sheet.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { makeEditSession } from '../__fixtures__/foodEditSession.js';
import { FoodEditSheet } from '../FoodEditSheet.js';

afterEach(cleanup);

describe('FoodEditSheet (web)', () => {
    it('is a dialog titled for the food, with Save for a private food and no review notice', () => {
        render(<FoodEditSheet session={makeEditSession()} />);

        expect(screen.getByRole('dialog', { name: 'Edit Oat milk' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
        expect(screen.queryByText(/Staff review every change/u)).toBeNull();
    });

    it('⛔ a public food: the review notice before the form, and the button says Send for review', () => {
        render(<FoodEditSheet session={makeEditSession({ notice: 'review', sendsForReview: true })} />);

        expect(screen.getByText(/Staff review every change to a public food/u)).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Send for review' })).toBeTruthy();
    });

    it('a waiting edit adds that this replaces it', () => {
        render(<FoodEditSheet session={makeEditSession({ notice: 'replacesWaiting', sendsForReview: true })} />);

        expect(screen.getByText('This replaces the edit waiting for review.')).toBeTruthy();
    });

    it('⛔ nothing changed: Send for review is disabled and the line says why', () => {
        render(<FoodEditSheet session={makeEditSession({ sendsForReview: true, unchanged: true })} />);

        expect(screen.getByRole('button', { name: 'Send for review' }).getAttribute('aria-disabled')).toBe('true');
        expect(screen.getAllByText('Change something to send it for review.').length).toBeGreaterThan(0);
    });

    it('typing reports the field, and the form submits', async () => {
        const session = makeEditSession();
        render(<FoodEditSheet session={session} />);

        await userEvent.type(screen.getByLabelText('Fat (g)'), '1');
        await userEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(session.onChange).toHaveBeenCalledWith('fatG', '51');
        expect(session.onSubmit).toHaveBeenCalledOnce();
    });

    it('says a failure inside the sheet, and the duplicate name as its own line', () => {
        const { rerender } = render(<FoodEditSheet session={makeEditSession({ failed: true })} />);

        expect(screen.getByRole('alert').textContent).toBe('We couldn’t save your changes.');
        rerender(<FoodEditSheet session={makeEditSession({ duplicate: true })} />);
        expect(screen.getByRole('alert').textContent).toBe('You already have a food with that name.');
    });

    it('shows a field error under its field', () => {
        render(<FoodEditSheet session={makeEditSession({ fieldErrors: { calories: 'not_a_number' } })} />);

        expect(screen.getByLabelText('Calories (kcal)').getAttribute('aria-invalid')).toBe('true');
    });

    it('Cancel closes it', async () => {
        const session = makeEditSession();
        render(<FoodEditSheet session={session} />);

        await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(session.onCancel).toHaveBeenCalled();
    });

    it('renders nothing while closed', () => {
        render(<FoodEditSheet session={makeEditSession({ open: false })} />);

        expect(screen.queryByRole('dialog')).toBeNull();
    });
});
