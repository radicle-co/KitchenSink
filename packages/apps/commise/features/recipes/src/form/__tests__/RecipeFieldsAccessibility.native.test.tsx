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
import { descriptionFieldId, stepFieldId, titleFieldId } from '../fieldIds.js';
import { RecipeBasicsFields } from '../RecipeBasicsFields.native.js';
import { RecipeInstructionsFields } from '../RecipeInstructionsFields.native.js';
import { recipeFormMessages } from '../messages.js';
import type { RecipeFormErrors } from '../validate.js';
import { defaultRecipeFormValues, type RecipeFormValues } from '../values.js';

const fields = vi.hoisted(() => new Map<string, ComponentProps<typeof TextInputAdapter>>());

vi.mock('@commise/ui/text-input', () => ({
    TextInput: (props: ComponentProps<typeof TextInputAdapter>) => {
        if (props.nativeID !== undefined) {
            fields.set(props.nativeID, props);
        }

        return null;
    },
    hasFocusedField: () => false,
}));

afterEach(() => {
    cleanup();
    fields.clear();
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
