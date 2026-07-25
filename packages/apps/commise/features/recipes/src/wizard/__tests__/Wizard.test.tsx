// @vitest-environment jsdom
/**
 * Component tests for the web `Wizard` compound shell (w3/e1,e2). A small harness owns `step`/`values` the
 * way `useRecipeEditor` would (using the SAME pure `canAdvanceFromStep`/`stepErrorsFor` the real hook calls),
 * so `goNext`'s validity gate and the rail's invalid-flagging behave exactly as they would wired to the real
 * hook, without needing the hook's network/query machinery. Covers: each `Wizard.Step` renders only while
 * active; `Next` is gated by step validity and flags the invalid step in the rail; the rail's
 * current/completed/invalid states; Save Draft / Publish call the given actions; Cancel-with-unsaved-edits
 * shows the discard dialog and confirming discards; Publish while another step is invalid flags that OTHER
 * step (not just the current one) without this shell ever calling `onCancel`/navigating; Preview shows the
 * current draft values.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type FC } from 'react';

import {
    canAdvanceFromStep,
    defaultRecipeFormValues,
    stepErrorsFor,
    type RecipeFormValues,
    type RecipeWizardStep,
} from '../../form/model.js';
import { Wizard } from '../Wizard.js';

afterEach(cleanup);

const validValues = (): RecipeFormValues => ({
    ...defaultRecipeFormValues(),
    title: 'Herb Risotto',
    servings: 4,
    ingredients: [{ ingredientId: 'ing_1', name: 'Arborio rice', quantity: 300, unit: 'g' }],
    steps: [{ instruction: 'Toast the rice.' }],
});

interface HarnessProps {
    readonly initialValues?: RecipeFormValues;
    readonly initialStep?: RecipeWizardStep;
    readonly mode?: 'create' | 'edit';
    readonly isDirty?: boolean;
    readonly onCancel?: () => void;
    readonly onSaveDraft?: () => void;
    readonly onPublish?: () => void;
}

/** A minimal stand-in for `useRecipeEditor`'s step/value contract, driven by the SAME pure validators. */
const Harness: FC<HarnessProps> = ({
    initialValues = defaultRecipeFormValues(),
    initialStep = 1,
    mode = 'create',
    isDirty = false,
    onCancel = vi.fn(),
    onSaveDraft = vi.fn(),
    onPublish = vi.fn(),
}) => {
    const [values, setValues] = useState(initialValues);
    const [step, setStep] = useState<RecipeWizardStep>(initialStep);

    return (
        <Wizard
            mode={mode}
            step={step}
            values={values}
            canAdvanceFrom={(s) => canAdvanceFromStep(values, s)}
            stepErrors={(s) => stepErrorsFor(values, s)}
            goNext={() => {
                if (step < 4 && canAdvanceFromStep(values, step)) {
                    setStep((step + 1) as RecipeWizardStep);
                }
            }}
            goPrev={() => {
                if (step > 1) {
                    setStep((step - 1) as RecipeWizardStep);
                }
            }}
            goToStep={setStep}
            saveDraft={onSaveDraft}
            publish={onPublish}
            onCancel={onCancel}
            isDirty={isDirty}
            submitting={false}
        >
            <Wizard.Rail />
            <Wizard.TopBar />
            <Wizard.Step step={1}>
                <input
                    aria-label="Title"
                    value={values.title}
                    onChange={(e) => setValues({ ...values, title: e.target.value })}
                />
            </Wizard.Step>
            <Wizard.Step step={2}>
                <p>Ingredients step body</p>
            </Wizard.Step>
            <Wizard.Step step={3}>
                <p>Instructions step body</p>
            </Wizard.Step>
            <Wizard.Step step={4}>
                <p>Photos step body</p>
            </Wizard.Step>
            <Wizard.Controls />
        </Wizard>
    );
};

describe('Wizard (web) — Wizard.Step gating', () => {
    it('renders only the active step body', () => {
        render(<Harness initialStep={1} />);

        expect(screen.getByLabelText('Title')).toBeTruthy();
        expect(screen.queryByText('Ingredients step body')).toBeFalsy();
        expect(screen.queryByText('Instructions step body')).toBeFalsy();
        expect(screen.queryByText('Photos step body')).toBeFalsy();
    });

    it('switches which step body renders when the step changes', () => {
        render(<Harness initialStep={3} />);

        expect(screen.queryByLabelText('Title')).toBeFalsy();
        expect(screen.getByText('Instructions step body')).toBeTruthy();
    });
});

describe('Wizard (web) — Next gating + rail invalidity', () => {
    it('Next does not advance while the current step is invalid, and flags that step in the rail', async () => {
        const user = userEvent.setup();
        // Blank title -> step 1 invalid (validateRecipeForm requires a non-blank title).
        render(<Harness initialValues={defaultRecipeFormValues()} initialStep={1} />);

        await user.click(screen.getByRole('button', { name: /Next: Ingredients/ }));

        // Still on step 1 — the step body did not change.
        expect(screen.getByLabelText('Title')).toBeTruthy();
        expect(screen.queryByText('Ingredients step body')).toBeFalsy();
        // The rail flags step 1 as needing attention now that it was attempted.
        expect(screen.getByRole('button', { name: /Basic: needs attention/ })).toBeTruthy();
    });

    it('Next advances to the following step when the current step is valid', async () => {
        const user = userEvent.setup();
        render(<Harness initialValues={validValues()} initialStep={1} />);

        await user.click(screen.getByRole('button', { name: /Next: Ingredients/ }));

        expect(screen.getByText('Ingredients step body')).toBeTruthy();
    });

    it('does not flag an unattempted step invalid merely because it currently has errors', () => {
        render(<Harness initialValues={defaultRecipeFormValues()} initialStep={1} />);

        // Step 2 (ingredients) is empty/invalid too, but has never been attempted — not flagged.
        expect(screen.getByRole('button', { name: /Ingredients: not yet started/ })).toBeTruthy();
    });

    it('the rail shows a completed step behind the current one', async () => {
        const user = userEvent.setup();
        render(<Harness initialValues={validValues()} initialStep={1} />);

        await user.click(screen.getByRole('button', { name: /Next: Ingredients/ }));

        expect(screen.getByRole('button', { name: /Basic: completed/ })).toBeTruthy();
        expect(screen.getByRole('button', { name: /Ingredients: current step/ })).toBeTruthy();
    });
});

describe('Wizard (web) — top-bar actions', () => {
    it('Save Draft calls the given action', async () => {
        const user = userEvent.setup();
        const onSaveDraft = vi.fn();
        render(<Harness onSaveDraft={onSaveDraft} />);

        await user.click(screen.getByRole('button', { name: 'Save Draft' }));

        expect(onSaveDraft).toHaveBeenCalledTimes(1);
    });

    it('Publish calls the given action and carries the "Publish" accessible name in create mode (w3/e7)', async () => {
        const user = userEvent.setup();
        const onPublish = vi.fn();
        render(<Harness mode="create" onPublish={onPublish} />);

        await user.click(screen.getByRole('button', { name: 'Publish' }));

        expect(onPublish).toHaveBeenCalledTimes(1);
    });

    it('Publish carries the SAME "Publish" accessible name in edit mode (w3/e7: label matches behavior, not mode)', () => {
        render(<Harness mode="edit" />);

        expect(screen.getByRole('button', { name: 'Publish' })).toBeTruthy();
    });

    it('Publish while another step is invalid flags that OTHER step in the rail (no navigation occurs)', async () => {
        const user = userEvent.setup();
        const onPublish = vi.fn();
        // Step 1 is valid; steps 2/3 (ingredients/instructions) are still empty/invalid.
        const partial: RecipeFormValues = { ...defaultRecipeFormValues(), title: 'Herb Risotto', servings: 4 };
        render(<Harness initialValues={partial} initialStep={1} onPublish={onPublish} />);

        await user.click(screen.getByRole('button', { name: 'Publish' }));

        expect(onPublish).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('button', { name: /Ingredients: needs attention/ })).toBeTruthy();
        expect(screen.getByRole('button', { name: /Instructions: needs attention/ })).toBeTruthy();
        // Still on step 1 — this shell never navigates on Publish; that is the hook's job.
        expect(screen.getByLabelText('Title')).toBeTruthy();
    });
});

describe('Wizard (web) — discard guard', () => {
    it('Cancel with no unsaved edits calls onCancel immediately (no dialog)', async () => {
        const user = userEvent.setup();
        const onCancel = vi.fn();
        render(<Harness isDirty={false} onCancel={onCancel} />);

        await user.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('alertdialog')).toBeFalsy();
    });

    it('Cancel with unsaved edits shows the discard dialog; confirming discards (calls onCancel)', async () => {
        const user = userEvent.setup();
        const onCancel = vi.fn();
        render(<Harness isDirty onCancel={onCancel} />);

        await user.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(onCancel).not.toHaveBeenCalled();
        expect(screen.getByRole('alertdialog', { name: 'Discard unsaved changes?' })).toBeTruthy();

        await user.click(screen.getByRole('button', { name: 'Discard changes' }));

        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('Cancel with unsaved edits: choosing "Keep editing" dismisses the dialog without discarding', async () => {
        const user = userEvent.setup();
        const onCancel = vi.fn();
        render(<Harness isDirty onCancel={onCancel} />);

        await user.click(screen.getByRole('button', { name: 'Cancel' }));
        await user.click(screen.getByRole('button', { name: 'Keep editing' }));

        expect(onCancel).not.toHaveBeenCalled();
        expect(screen.queryByRole('alertdialog')).toBeFalsy();
    });

    it('backward rail navigation with unsaved edits is guarded too', async () => {
        const user = userEvent.setup();
        render(<Harness initialValues={validValues()} initialStep={3} isDirty />);

        await user.click(screen.getByRole('button', { name: /Basic:/ }));

        expect(screen.getByRole('alertdialog')).toBeTruthy();
        // Still on step 3 until confirmed.
        expect(screen.getByText('Instructions step body')).toBeTruthy();

        await user.click(screen.getByRole('button', { name: 'Discard changes' }));
        expect(screen.getByLabelText('Title')).toBeTruthy();
    });
});

describe('Wizard (web) — chrome landmark labels (a11y, localized, not shared)', () => {
    it('gives the rail nav and the top-bar toolbar their OWN distinct localized accessible names', () => {
        render(<Harness />);

        expect(screen.getByRole('navigation', { name: 'Recipe wizard steps' })).toBeTruthy();
        expect(screen.getByRole('toolbar', { name: 'Recipe wizard actions' })).toBeTruthy();
    });

    it('gives the footer step-navigation region a localized accessible name (not a raw literal)', () => {
        render(<Harness />);

        expect(screen.getByLabelText('Wizard step navigation')).toBeTruthy();
    });
});

describe('Wizard (web) — Preview', () => {
    it('shows the current draft values and can be closed', async () => {
        const user = userEvent.setup();
        render(<Harness initialValues={validValues()} />);

        await user.click(screen.getByRole('button', { name: 'Preview' }));

        const preview = screen.getByRole('dialog', { name: 'Preview' });
        expect(within(preview).getByText('Herb Risotto')).toBeTruthy();
        expect(within(preview).getByText('4')).toBeTruthy();

        await user.click(screen.getByRole('button', { name: 'Close preview' }));
        expect(screen.queryByRole('dialog', { name: 'Preview' })).toBeFalsy();
    });

    // Minor a11y gap (opus review): the hand-rolled preview dialog previously had no Escape/backdrop
    // dismissal, unlike the Radix ConfirmDialog rendered in the same file.
    it('closes on Escape', async () => {
        const user = userEvent.setup();
        render(<Harness initialValues={validValues()} />);

        await user.click(screen.getByRole('button', { name: 'Preview' }));
        expect(screen.getByRole('dialog', { name: 'Preview' })).toBeTruthy();

        await user.keyboard('{Escape}');

        expect(screen.queryByRole('dialog', { name: 'Preview' })).toBeFalsy();
    });

    it('closes on a backdrop click, but NOT on a click inside the panel card', async () => {
        const user = userEvent.setup();
        render(<Harness initialValues={validValues()} />);

        await user.click(screen.getByRole('button', { name: 'Preview' }));
        const preview = screen.getByRole('dialog', { name: 'Preview' });

        // A click on content INSIDE the card must not dismiss the panel.
        await user.click(within(preview).getByText('Herb Risotto'));
        expect(screen.getByRole('dialog', { name: 'Preview' })).toBeTruthy();

        // A click on the backdrop itself (the dialog element, outside the card) dismisses it.
        await user.click(preview);
        expect(screen.queryByRole('dialog', { name: 'Preview' })).toBeFalsy();
    });
});
