/**
 * Native recipe editor fields — what VoiceOver and TalkBack receive (`docs/design/uiOverhaul/cuisineField.md` §3.3
 * follow-up).
 *
 * React Native has no `aria-describedby` and no `aria-invalid`, and `aria-labelledby` is Android-only. react-native-web
 * maps all three to the DOM, so the sibling suites pass while a device does nothing. So this suite stands in for the
 * platform's text input and reads the props each field is handed, keyed by its `nativeID`: a field's error leads its
 * `accessibilityHint`, and its visible label is its `accessibilityLabel`.
 */
import { cleanup, render } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TextInput as TextInputAdapter } from '@commise/ui/text-input';

import { editorMessages } from '../../editor/messages.js';
import { fillTemplate } from '../../format/fillTemplate.js';
import { descriptionFieldId, stepFieldId, titleFieldId } from '../fieldIds.js';
import { RecipeBasicsFields } from '../RecipeBasicsFields.native.js';
import { RecipeInstructionsFields } from '../RecipeInstructionsFields.native.js';
import { recipeFormMessages } from '../messages.js';
import type { RecipeFormErrors } from '../validate.js';
import { defaultRecipeFormValues, type RecipeFormValues } from '../values.js';

const fields = vi.hoisted(() => new Map<string, ComponentProps<typeof TextInputAdapter>>());

const stepper = vi.hoisted(() => ({ props: undefined as { readonly error?: string } | undefined }));

// The Stepper is not a text input: wrap it to read the props the host hands it (its own leaf is covered in `@commise/ui`).
vi.mock('@commise/ui/input', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@commise/ui/input')>();
    const { createElement } = await import('react');

    return {
        ...actual,
        Stepper: (props: ComponentProps<typeof actual.Stepper>) => {
            stepper.props = props;

            return createElement(actual.Stepper, props);
        },
    };
});

vi.mock('@commise/ui/text-input', () => ({
    TextInput: (props: ComponentProps<typeof TextInputAdapter>) => {
        // A duration box has no `nativeID`; its accessibility label is its name.
        const key = props.nativeID ?? props.accessibilityLabel;

        if (key !== undefined) {
            fields.set(key, props);
        }

        return null;
    },
    hasFocusedField: () => false,
}));

afterEach(() => {
    cleanup();
    fields.clear();
    stepper.props = undefined;
});

const m = recipeFormMessages.en;
const e = editorMessages.en;

const filled = (over: Partial<RecipeFormValues> = {}): RecipeFormValues => ({
    ...defaultRecipeFormValues(),
    title: 'Herb risotto',
    description: 'Creamy and quick.',
    cuisine: 'Italian',
    ...over,
});

const renderBasics = (values: RecipeFormValues, errors?: RecipeFormErrors) =>
    render(<RecipeBasicsFields values={values} onChange={vi.fn()} {...(errors === undefined ? {} : { errors })} />);

const field = (id: string): ComponentProps<typeof TextInputAdapter> => {
    const found = fields.get(id);

    if (found === undefined) {
        throw new Error(`No field with the id ${id} was rendered.`);
    }

    return found;
};

describe('RecipeBasicsFields (native) — title and description reach the screen reader', () => {
    it('names the title and the description by their visible labels, which iOS reads', () => {
        renderBasics(filled());

        expect(field(titleFieldId).accessibilityLabel).toBe(m.titleLabel);
        expect(field(descriptionFieldId).accessibilityLabel).toBe(m.descriptionLabel);
    });

    it('says nothing for either field while it has no error', () => {
        renderBasics(filled());

        expect(field(titleFieldId).accessibilityHint).toBeUndefined();
        expect(field(descriptionFieldId).accessibilityHint).toBeUndefined();
    });

    it('hands a refused title’s message to the title field as its hint', () => {
        renderBasics(filled({ title: '' }), { title: 'titleRequired' });

        expect(field(titleFieldId).accessibilityHint).toBe(m.errors.titleRequired);
        expect(field(descriptionFieldId).accessibilityHint).toBeUndefined();
    });

    it('hands the title’s limit, said before any refusal, to the title field as its hint', () => {
        renderBasics(filled({ title: 'a'.repeat(201) }));

        expect(field(titleFieldId).accessibilityHint).toBe(e.details.titleLimit);
    });

    it('hands a refused description’s message to the description field as its hint', () => {
        renderBasics(filled({ description: 'a'.repeat(300) }), { description: 'descriptionTooLong' });

        expect(field(descriptionFieldId).accessibilityHint).toBe(m.errors.descriptionTooLong);
    });
});

describe('RecipeBasicsFields (native) — servings and times reach the screen reader', () => {
    it('hands a refused servings count to the stepper as its error', () => {
        renderBasics(filled({ servings: 0 }), { servings: 'servingsPositive' });

        expect(stepper.props?.error).toBe(m.errors.servingsPositive);
    });

    it('says nothing on the stepper while servings are fine', () => {
        renderBasics(filled());

        expect(stepper.props?.error).toBeUndefined();
    });

    it('hands a refused time to BOTH time fields, in both of their boxes, as the accessibility hint', () => {
        renderBasics(filled(), { times: 'timesNonNegative' });

        for (const label of [m.prepTimeLabel, m.cookTimeLabel]) {
            expect(field(fillTemplate(m.durationHoursLabel, { field: label })).accessibilityHint).toBe(
                m.errors.timesNonNegative,
            );
            expect(field(fillTemplate(m.durationMinutesLabel, { field: label })).accessibilityHint).toBe(
                m.errors.timesNonNegative,
            );
        }
    });

    it('says nothing on the time boxes while the times are fine', () => {
        renderBasics(filled());

        expect(field(fillTemplate(m.durationHoursLabel, { field: m.prepTimeLabel })).accessibilityHint).toBeUndefined();
    });
});

describe('RecipeInstructionsFields (native) — a blank step reaches the screen reader', () => {
    const steps = (...instructions: string[]) =>
        filled({ steps: instructions.map((instruction) => ({ instruction })) });
    const renderSteps = (values: RecipeFormValues, errors?: RecipeFormErrors) =>
        render(
            <RecipeInstructionsFields
                values={values}
                onChange={vi.fn()}
                {...(errors === undefined ? {} : { errors })}
            />,
        );

    it('names each step field by its visible label', () => {
        renderSteps(steps('Stir.', 'Serve.'));

        expect(field(stepFieldId(0)).accessibilityLabel).toBe('Step 1');
        expect(field(stepFieldId(1)).accessibilityLabel).toBe('Step 2');
    });

    it('hands the refusal to the blank step only', () => {
        renderSteps(steps('Stir.', ''), { steps: 'stepsRequired' });

        expect(field(stepFieldId(1)).accessibilityHint).toBe(e.index.reason.stepBlank);
        expect(field(stepFieldId(0)).accessibilityHint).toBeUndefined();
    });
});
