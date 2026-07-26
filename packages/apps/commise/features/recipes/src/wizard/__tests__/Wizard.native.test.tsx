/**
 * Component tests for the native `Wizard` compound shell (w3/e1,e2; U6 chrome remediation) — mirrors
 * `Wizard.test.tsx`'s harness and coverage against the RN leaf, run through react-native-web under jsdom per
 * this package's native test convention.
 *
 * **U6 chrome model (mirrored from the web spec):** the footer (`Wizard.Controls`) is the ONE contextual
 * primary — `Next: {name}` on steps 1–3, `Publish` on step 4 (never both), with a secondary `Prev` once past
 * step 1. The header (`Wizard.TopBar`) keeps `Preview` and demotes `Save Draft` + `Cancel` into an overflow
 * ("More actions") menu, so it never packs four buttons and Publish is gone from it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState, type FC } from 'react';
import { Text, TextInput } from 'react-native';

import {
    canAdvanceFromStep,
    defaultRecipeFormValues,
    stepErrorsFor,
    type RecipeFormValues,
    type RecipeWizardStep,
} from '../../form/model.js';
import { Wizard } from '../Wizard.native.js';

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
    readonly submitting?: boolean;
    readonly onCancel?: () => void;
    readonly onSaveDraft?: () => void;
    readonly onPublish?: () => void;
}

const Harness: FC<HarnessProps> = ({
    initialValues = defaultRecipeFormValues(),
    initialStep = 1,
    mode = 'create',
    isDirty = false,
    submitting = false,
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
            submitting={submitting}
        >
            <Wizard.Rail />
            <Wizard.TopBar />
            <Wizard.Step step={1}>
                <TextInput
                    accessibilityLabel="Title"
                    value={values.title}
                    onChangeText={(t) => setValues({ ...values, title: t })}
                />
            </Wizard.Step>
            <Wizard.Step step={2}>
                <Text>Ingredients step body</Text>
            </Wizard.Step>
            <Wizard.Step step={3}>
                <Text>Instructions step body</Text>
            </Wizard.Step>
            <Wizard.Step step={4}>
                <Text>Photos step body</Text>
            </Wizard.Step>
            <Wizard.Controls />
        </Wizard>
    );
};

/** Open the header's overflow ("More actions") menu, disclosing the Save Draft / Cancel items. */
const openActionsMenu = (): void => {
    fireEvent.click(screen.getByLabelText('More actions'));
};

describe('Wizard (native) — Wizard.Step gating', () => {
    it('renders only the active step body', () => {
        render(<Harness initialStep={1} />);

        expect(screen.getByLabelText('Title')).toBeTruthy();
        expect(screen.queryByText('Ingredients step body')).toBeFalsy();
        expect(screen.queryByText('Photos step body')).toBeFalsy();
    });

    it('switches which step body renders when the step changes', () => {
        render(<Harness initialStep={3} />);

        expect(screen.queryByLabelText('Title')).toBeFalsy();
        expect(screen.getByText('Instructions step body')).toBeTruthy();
    });
});

describe('Wizard (native) — Next gating + rail invalidity', () => {
    it('Next does not advance while the current step is invalid, and flags that step in the rail', () => {
        render(<Harness initialValues={defaultRecipeFormValues()} initialStep={1} />);

        fireEvent.click(screen.getByLabelText(/Next: Ingredients/));

        expect(screen.getByLabelText('Title')).toBeTruthy();
        expect(screen.queryByText('Ingredients step body')).toBeFalsy();
        expect(screen.getByLabelText(/Basic: needs attention/)).toBeTruthy();
    });

    it('Next advances to the following step when the current step is valid', () => {
        render(<Harness initialValues={validValues()} initialStep={1} />);

        fireEvent.click(screen.getByLabelText(/Next: Ingredients/));

        expect(screen.getByText('Ingredients step body')).toBeTruthy();
    });

    it('does not flag an unattempted step invalid merely because it currently has errors', () => {
        render(<Harness initialValues={defaultRecipeFormValues()} initialStep={1} />);

        expect(screen.getByLabelText(/Ingredients: not yet started/)).toBeTruthy();
    });

    it('the rail shows a completed step behind the current one', () => {
        render(<Harness initialValues={validValues()} initialStep={1} />);

        fireEvent.click(screen.getByLabelText(/Next: Ingredients/));

        expect(screen.getByLabelText(/Basic: completed/)).toBeTruthy();
        expect(screen.getByLabelText(/Ingredients: current step/)).toBeTruthy();
    });
});

describe('Wizard (native) — footer is the ONE contextual primary (U6)', () => {
    it('shows Next — and NO Publish, NO Prev — on step 1', () => {
        render(<Harness initialValues={validValues()} initialStep={1} />);

        expect(screen.getByLabelText(/Next: Ingredients/)).toBeTruthy();
        expect(screen.queryByLabelText('Publish')).toBeFalsy();
        expect(screen.queryByLabelText(/Prev:/)).toBeFalsy();
    });

    it('shows Next — and NO Publish — on step 3, plus a Prev', () => {
        render(<Harness initialValues={validValues()} initialStep={3} />);

        expect(screen.getByLabelText(/Next: Photos/)).toBeTruthy();
        expect(screen.getByLabelText(/Prev: Ingredients/)).toBeTruthy();
        expect(screen.queryByLabelText('Publish')).toBeFalsy();
    });

    it('swaps the footer primary to Publish — and NO Next — on step 4', () => {
        render(<Harness initialValues={validValues()} initialStep={4} />);

        expect(screen.getByLabelText('Publish')).toBeTruthy();
        expect(screen.queryByLabelText(/Next:/)).toBeFalsy();
    });

    it('Publish in the footer calls publish', () => {
        const onPublish = vi.fn();
        render(<Harness initialValues={validValues()} initialStep={4} onPublish={onPublish} />);

        fireEvent.click(screen.getByLabelText('Publish'));

        expect(onPublish).toHaveBeenCalledTimes(1);
    });
});

describe('Wizard (native) — header overflow menu (U6: Save Draft + Cancel demoted)', () => {
    it('does not pack four buttons in the header — only Preview + the overflow trigger', () => {
        render(<Harness />);

        const toolbar = screen.getByLabelText('Recipe wizard actions');
        expect(within(toolbar).getAllByRole('button')).toHaveLength(2);
        expect(within(toolbar).queryByLabelText('Publish')).toBeFalsy();
        // Save Draft + Cancel stay hidden until the overflow menu opens.
        expect(screen.queryByLabelText('Save Draft')).toBeFalsy();
        expect(screen.queryByLabelText('Cancel')).toBeFalsy();
    });

    it('discloses Save Draft + Cancel from the overflow menu, and Save Draft calls the given action', () => {
        const onSaveDraft = vi.fn();
        render(<Harness onSaveDraft={onSaveDraft} />);

        openActionsMenu();

        expect(screen.getByLabelText('Save Draft')).toBeTruthy();
        expect(screen.getByLabelText('Cancel')).toBeTruthy();

        fireEvent.click(screen.getByLabelText('Save Draft'));

        expect(onSaveDraft).toHaveBeenCalledTimes(1);
        // Choosing an item closes the menu.
        expect(screen.queryByLabelText('Save Draft')).toBeFalsy();
    });
});

describe('Wizard (native) — top-bar actions & submitting', () => {
    it('Publish calls the given action and carries the "Publish" accessible name in create mode (w3/e7)', () => {
        const onPublish = vi.fn();
        render(<Harness mode="create" initialValues={validValues()} initialStep={4} onPublish={onPublish} />);

        fireEvent.click(screen.getByLabelText('Publish'));

        expect(onPublish).toHaveBeenCalledTimes(1);
    });

    it('Publish carries the SAME "Publish" accessible name in edit mode (w3/e7: label matches behavior, not mode)', () => {
        render(<Harness mode="edit" initialValues={validValues()} initialStep={4} />);

        expect(screen.getByLabelText('Publish')).toBeTruthy();
    });

    it('Publish while another step is invalid flags that OTHER step in the rail (no navigation occurs)', () => {
        const onPublish = vi.fn();
        const partial: RecipeFormValues = { ...defaultRecipeFormValues(), title: 'Herb Risotto', servings: 4 };
        render(<Harness initialValues={partial} initialStep={4} onPublish={onPublish} />);

        fireEvent.click(screen.getByLabelText('Publish'));

        expect(onPublish).toHaveBeenCalledTimes(1);
        expect(screen.getByLabelText(/Ingredients: needs attention/)).toBeTruthy();
        expect(screen.getByLabelText(/Instructions: needs attention/)).toBeTruthy();
        expect(screen.getByText('Photos step body')).toBeTruthy();
    });

    it('busies the footer Publish primary so it cannot be double-fired while a save is in flight', () => {
        const onPublish = vi.fn();
        render(<Harness initialValues={validValues()} initialStep={4} submitting onPublish={onPublish} />);

        fireEvent.click(screen.getByLabelText('Publish'));

        expect(onPublish).not.toHaveBeenCalled();
    });

    it('busies the overflow Save Draft item so it cannot be double-fired while a save is in flight', () => {
        const onSaveDraft = vi.fn();
        render(<Harness submitting onSaveDraft={onSaveDraft} />);

        openActionsMenu();
        fireEvent.click(screen.getByLabelText('Save Draft'));

        expect(onSaveDraft).not.toHaveBeenCalled();
    });
});

describe('Wizard (native) — discard guard (Cancel now lives in the overflow menu)', () => {
    it('Cancel with no unsaved edits calls onCancel immediately (no dialog)', () => {
        const onCancel = vi.fn();
        render(<Harness isDirty={false} onCancel={onCancel} />);

        openActionsMenu();
        fireEvent.click(screen.getByLabelText('Cancel'));

        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(screen.queryByLabelText('Discard unsaved changes?')).toBeFalsy();
    });

    it('Cancel with unsaved edits shows the discard dialog; confirming discards (calls onCancel)', () => {
        const onCancel = vi.fn();
        render(<Harness isDirty onCancel={onCancel} />);

        openActionsMenu();
        fireEvent.click(screen.getByLabelText('Cancel'));

        expect(onCancel).not.toHaveBeenCalled();
        expect(screen.getByLabelText('Discard unsaved changes?')).toBeTruthy();

        fireEvent.click(screen.getByLabelText('Discard changes'));

        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('Cancel with unsaved edits: choosing "Keep editing" dismisses the dialog without discarding', () => {
        const onCancel = vi.fn();
        render(<Harness isDirty onCancel={onCancel} />);

        openActionsMenu();
        fireEvent.click(screen.getByLabelText('Cancel'));
        fireEvent.click(screen.getByLabelText('Keep editing'));

        expect(onCancel).not.toHaveBeenCalled();
        expect(screen.queryByLabelText('Discard unsaved changes?')).toBeFalsy();
    });

    it('backward rail navigation with unsaved edits is guarded too', () => {
        render(<Harness initialValues={validValues()} initialStep={3} isDirty />);

        fireEvent.click(screen.getByLabelText(/Basic:/));

        expect(screen.getByLabelText('Discard unsaved changes?')).toBeTruthy();
        expect(screen.getByText('Instructions step body')).toBeTruthy();

        fireEvent.click(screen.getByLabelText('Discard changes'));
        expect(screen.getByLabelText('Title')).toBeTruthy();
    });
});

describe('Wizard (native) — chrome landmark labels (a11y, localized, not shared)', () => {
    it('gives the rail region and the top-bar their OWN distinct localized accessible labels', () => {
        render(<Harness />);

        expect(screen.getByLabelText('Recipe wizard steps')).toBeTruthy();
        expect(screen.getByLabelText('Recipe wizard actions')).toBeTruthy();
    });

    it('names the overflow trigger with a localized label (not a raw literal)', () => {
        render(<Harness />);

        expect(screen.getByLabelText('More actions')).toBeTruthy();
    });

    it('gives the footer step-navigation region a localized accessible label (not a raw literal)', () => {
        render(<Harness />);

        expect(screen.getByLabelText('Wizard step navigation')).toBeTruthy();
    });
});

describe('Wizard (native) — Preview', () => {
    it('shows the current draft values and can be closed', () => {
        render(<Harness initialValues={validValues()} />);

        fireEvent.click(screen.getByRole('button', { name: 'Preview' }));

        // The panel's own accessible label collides with the top-bar button's ("Preview"), and bare numeric
        // values collide with the rail's step-number badges — so scope the servings assertion to its own
        // label/value row rather than querying the page for a bare "4".
        expect(screen.getByLabelText('Close preview')).toBeTruthy();
        expect(screen.getByText('Herb Risotto')).toBeTruthy();
        const servingsRow = screen.getByText('Servings').parentElement;
        expect(within(servingsRow as HTMLElement).getByText('4')).toBeTruthy();

        fireEvent.click(screen.getByLabelText('Close preview'));
        expect(screen.queryByLabelText('Close preview')).toBeFalsy();
    });
});
