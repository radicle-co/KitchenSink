/**
 * Component tests for the U16 create-your-own-food vertical in the web ingredient picker — every state
 * of the shared sub-machine, driven through the REAL `useIngredientResolver` over the type-checked
 * fake-client seam (only the transport is stubbed).
 *
 * The states, per `authoredFoodCreate.model.ts`: the affordance itself, the open form (with the typed
 * query prefilled), inline per-field validation, submitting, the resolved create-and-attach, the
 * ⛔ DISTINCT duplicate state with its reuse affordance, the retryable submit failure, and cancel.
 *
 * Queries use role/label/text only (`getByRole`/`getByLabelText` — no test ids).
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithRecipeClient } from '@commise/test-utils';

import { IngredientPicker } from '@/components/recipes/IngredientPicker';

import { makeIngredient } from './__fixtures__/ingredientFixtures';

/** Mount with an always-empty local suggest, so the create affordance is the natural next step. */
function mount(onSelect = vi.fn()): {
    readonly client: ReturnType<typeof createFakeRecipeServiceClient>;
    readonly user: ReturnType<typeof userEvent.setup>;
    readonly onSelect: ReturnType<typeof vi.fn>;
} {
    const client = createFakeRecipeServiceClient();
    vi.spyOn(client, 'suggestIngredients').mockResolvedValue({ suggestions: [], catalogAvailability: 'ok' });
    renderWithRecipeClient(<IngredientPicker onSelect={onSelect} />, client);

    return { client, user: userEvent.setup(), onSelect };
}

/** Type a query and open the create form from the affordance. */
async function openForm(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'grandma blend');
    await user.click(await screen.findByRole('button', { name: 'Create your own food' }));
}

/** Fill the four macro fields with a valid profile. */
async function fillMacros(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    await user.type(screen.getByLabelText('Calories (kcal)'), '100');
    await user.type(screen.getByLabelText('Protein (g)'), '10');
    await user.type(screen.getByLabelText('Carbs (g)'), '20');
    await user.type(screen.getByLabelText('Fat (g)'), '5');
}

afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
});

describe('IngredientPicker — the U16 create-your-own-food vertical', () => {
    it('offers the affordance on an EMPTY result set, and opens the form with the query prefilled', async () => {
        const { user } = mount();

        await openForm(user);

        expect(screen.getByRole('form', { name: /Create .grandma blend./u })).toBeInTheDocument();
        expect(screen.getByLabelText('Food name')).toHaveValue('grandma blend');
        // The only-you promise (D9a/U11) is on screen before anything is submitted.
        expect(screen.getByText('Only you can see foods you create.')).toBeInTheDocument();
    });

    it('renders INLINE per-field errors on an invalid submit — nothing reaches the wire', async () => {
        const { client, user } = mount();
        const create = vi.spyOn(client, 'createAuthoredFoodViaPicker');

        await openForm(user);
        await user.click(screen.getByRole('button', { name: 'Create and add' }));

        // The four empty macros each carry their own inline error; the create call never fired.
        expect(screen.getAllByRole('alert').map((node) => node.textContent)).toEqual([
            'Required',
            'Required',
            'Required',
            'Required',
        ]);
        expect(create).not.toHaveBeenCalled();
    });

    /**
     * ⛔ THE MIXED INVALID STATE — a state the suite had no case for at all, and the one the product got
     * wrong. A cook types ONE macro out of range and has not reached the other three yet. Validation used
     * to answer every presence question first and RETURN before the range authority ran, so the three
     * untouched fields each said `Required` while the field actually at fault said NOTHING — and only
     * named itself on a SECOND submit, once everything else was already correct.
     *
     * TWO assertions, because they fail for different reasons. The ordered list of alerts — calories,
     * protein, carbs, fat, the form's own DOM order, with no entry for `name` because the affordance
     * prefilled it from the query — is what catches a stray fifth alert or a missing one. The accessible
     * DESCRIPTION is what catches the thing the bug actually was: the verdict has to be ATTACHED to the
     * field at fault, and a positional list alone would still pass the day someone reorders the inputs.
     */
    it('⛔ names the out-of-range field WHILE other fields are still empty — one submit, every verdict', async () => {
        const { client, user } = mount();
        const create = vi.spyOn(client, 'createAuthoredFoodViaPicker');

        await openForm(user);
        await user.type(screen.getByLabelText('Carbs (g)'), '150');
        await user.click(screen.getByRole('button', { name: 'Create and add' }));

        expect(screen.getAllByRole('alert').map((node) => node.textContent)).toEqual([
            'Required',
            'Required',
            'Outside the allowed range',
            'Required',
        ]);
        // The association, read the way a screen reader reads it (`aria-invalid` + `aria-describedby`).
        expect(screen.getByLabelText('Carbs (g)')).toHaveAccessibleDescription('Outside the allowed range');
        expect(screen.getByLabelText('Calories (kcal)')).toHaveAccessibleDescription('Required');
        expect(create).not.toHaveBeenCalled();
    });

    it('creates and ATTACHES in one flow — the resolved line reaches onSelect and the picker resets', async () => {
        const { client, user, onSelect } = mount();
        const admitted = makeIngredient({ id: 'ing-a1', name: 'grandma blend', foodId: 'F_new' });

        vi.spyOn(client, 'createAuthoredFoodViaPicker').mockResolvedValue({ created: true, ingredient: admitted });

        await openForm(user);
        await fillMacros(user);
        await user.click(screen.getByRole('button', { name: 'Create and add' }));

        await waitFor(() => {
            expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ ingredientId: 'ing-a1' }));
        });
        // The form closed and the picker reset to a blank search — same convergence as every pick.
        expect(screen.queryByRole('form', { name: /Create/u })).not.toBeInTheDocument();
        expect(screen.getByRole('searchbox', { name: 'Search ingredients' })).toHaveValue('');
    });

    it('⛔ the per-author duplicate renders its OWN sentence and a working reuse affordance', async () => {
        const { client, user, onSelect } = mount();
        const existing = makeIngredient({ id: 'ing-prior', name: 'grandma blend', foodId: 'F_prior' });

        vi.spyOn(client, 'createAuthoredFoodViaPicker').mockResolvedValue({
            created: false,
            reason: 'duplicate',
            existingFoodId: 'F_prior',
        });
        const byFood = vi.spyOn(client, 'addIngredientByFood').mockResolvedValue(existing);

        await openForm(user);
        await fillMacros(user);
        await user.click(screen.getByRole('button', { name: 'Create and add' }));

        // A DISTINCT sentence — not the generic validation copy, and not an alert (nothing failed).
        expect(await screen.findByText('You already have a food named “grandma blend”.')).toBeInTheDocument();
        expect(screen.queryByText('Outside the allowed range')).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Use that one' }));

        await waitFor(() => {
            expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ ingredientId: 'ing-prior' }));
        });
        expect(byFood).toHaveBeenCalledWith('F_prior');
    });

    it('a FAILED create surfaces the retryable alert with every field intact', async () => {
        const { client, user } = mount();

        vi.spyOn(client, 'createAuthoredFoodViaPicker').mockRejectedValue(new Error('down'));

        await openForm(user);
        await fillMacros(user);
        await user.click(screen.getByRole('button', { name: 'Create and add' }));

        expect(
            await screen.findByText('Could not create the food. Check your connection and try again.'),
        ).toBeInTheDocument();
        // The draft survives — a retry does not mean re-typing four numbers.
        expect(screen.getByLabelText('Calories (kcal)')).toHaveValue('100');
    });

    it('cancel closes the form and returns to the search results', async () => {
        const { user } = mount();

        await openForm(user);
        await user.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(screen.queryByRole('form', { name: /Create/u })).not.toBeInTheDocument();
        expect(screen.getByRole('searchbox', { name: 'Search ingredients' })).toBeInTheDocument();
    });
    /**
     * ⛔ FOCUS FOLLOWS THE DISCLOSURE (WCAG 2.2 SC 2.4.3 Focus Order), per staff-ux-engineer.
     *
     * The form opens BELOW the whole results card — the USDA hits and the "Search USDA" control sit between it
     * and its trigger — so nothing about tab order carries a keyboard user to it. Focus has to: into the form
     * when it opens, onto the reuse control when the duplicate branch swaps the form out (the focused submit
     * button is removed with it), and back to the trigger on cancel.
     */
    it('⛔ opening the form moves focus into its first field, and the trigger reports it expanded', async () => {
        const { user } = mount();

        await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'grandma blend');
        const trigger = await screen.findByRole('button', { name: 'Create your own food' });
        expect(trigger).toHaveAttribute('aria-expanded', 'false');

        await user.click(trigger);

        expect(screen.getByLabelText('Food name')).toHaveFocus();
        expect(trigger).toHaveAttribute('aria-expanded', 'true');
        // …and names WHAT it expanded: the form is a sibling of the results card, not inside it.
        const form = screen.getByRole('form', { name: /Create .grandma blend./u });
        expect(form.id).not.toBe('');
        expect(trigger).toHaveAttribute('aria-controls', form.id);
    });

    it('does NOT pull focus back to the first field when an invalid submit re-renders the open form', async () => {
        const { user } = mount();

        await openForm(user);
        const submit = screen.getByRole('button', { name: 'Create and add' });
        await user.click(submit);

        expect(await screen.findAllByRole('alert')).not.toHaveLength(0);
        expect(submit).toHaveFocus();
    });

    it('⛔ the duplicate branch moves focus onto its reuse control, not to <body>', async () => {
        const { client, user } = mount();
        vi.spyOn(client, 'createAuthoredFoodViaPicker').mockResolvedValue({
            created: false,
            reason: 'duplicate',
            existingFoodId: 'F_prior',
        });

        await openForm(user);
        await fillMacros(user);
        await user.click(screen.getByRole('button', { name: 'Create and add' }));

        expect(await screen.findByRole('button', { name: 'Use that one' })).toHaveFocus();
    });

    /**
     * ⛔ The trigger reports `aria-expanded`, so it is a DISCLOSURE — and a disclosure's second press collapses what
     * it expanded. Re-opening instead would announce "expanded" on a control that does nothing visible, and
     * reset the form under the cook.
     */
    it('⛔ pressing the trigger again collapses the form, as its expanded state promises', async () => {
        const { user } = mount();

        await openForm(user);
        const trigger = screen.getByRole('button', { name: 'Create your own food' });
        await user.click(trigger);

        expect(screen.queryByRole('form', { name: /Create .grandma blend./u })).not.toBeInTheDocument();
        expect(trigger).toHaveAttribute('aria-expanded', 'false');
        expect(trigger).toHaveFocus();
    });

    it('⛔ cancel returns focus to the control that opened the form', async () => {
        const { user } = mount();

        await openForm(user);
        await user.click(screen.getByRole('button', { name: 'Cancel' }));

        const trigger = screen.getByRole('button', { name: 'Create your own food' });
        expect(trigger).toHaveFocus();
        expect(trigger).toHaveAttribute('aria-expanded', 'false');
    });

    it('⛔ keeps every control FOCUSABLE while the create is in flight — read-only fields, aria-disabled buttons', async () => {
        // Native `disabled` on the control holding focus drops focus to <body> in a real browser (jsdom does not),
        // which is the WCAG 2.2 SC 2.4.3 loss this form exists to avoid. The hook refuses the actions instead.
        const { client, user } = mount();
        vi.spyOn(client, 'createAuthoredFoodViaPicker').mockReturnValue(new Promise(() => undefined));

        await openForm(user);
        await fillMacros(user);
        const submit = screen.getByRole('button', { name: 'Create and add' });
        await user.click(submit);

        await waitFor(() => {
            expect(submit).toHaveAttribute('aria-disabled', 'true');
        });
        expect(submit).not.toBeDisabled();
        expect(screen.getByRole('button', { name: 'Cancel' })).toHaveAttribute('aria-disabled', 'true');
        expect(screen.getByRole('button', { name: 'Cancel' })).not.toBeDisabled();
        expect(screen.getByLabelText('Calories (kcal)')).toHaveAttribute('readonly');
        expect(screen.getByLabelText('Calories (kcal)')).not.toBeDisabled();
        // The trigger would collapse the form, which a pending create refuses — so it says it is unavailable too.
        const trigger = screen.getByRole('button', { name: 'Create your own food' });
        expect(trigger).toHaveAttribute('aria-disabled', 'true');
        expect(trigger).not.toBeDisabled();

        // …and a second press does nothing: one create, and Cancel cannot close the form under a pending request.
        await user.click(submit);
        const cancel = screen.getByRole('button', { name: 'Cancel' });
        await user.click(cancel);
        await user.click(trigger);
        expect(client.createAuthoredFoodViaPicker).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('form', { name: /Create/u })).toBeInTheDocument();
        expect(trigger).toHaveAttribute('aria-expanded', 'true');
        await user.click(cancel);
        // ⛔ …and a refused Cancel moves NOTHING: focus stays on the Cancel the cook pressed, not on a trigger that
        // would only make sense had the form actually closed.
        expect(cancel).toHaveFocus();
    });

    it('⛔ the duplicate branch does NOT steal focus from a cook who has moved on to the search box', async () => {
        const { client, user } = mount();
        let answer: (value: { created: false; reason: 'duplicate'; existingFoodId: string }) => void = () => undefined;
        vi.spyOn(client, 'createAuthoredFoodViaPicker').mockReturnValue(
            new Promise((resolve) => {
                answer = resolve;
            }),
        );

        await openForm(user);
        await fillMacros(user);
        await user.click(screen.getByRole('button', { name: 'Create and add' }));
        const search = screen.getByRole('searchbox', { name: 'Search ingredients' });
        search.focus();

        answer({ created: false, reason: 'duplicate', existingFoodId: 'F_prior' });

        expect(await screen.findByRole('button', { name: 'Use that one' })).toBeInTheDocument();
        expect(search).toHaveFocus();
    });
});
