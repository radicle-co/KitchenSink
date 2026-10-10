/**
 * Unit tests for what a refused publish says at the top of the Steps list, and which step fields it marks.
 */
import { describe, expect, it } from 'vitest';

import { editorMessages } from '../../editor/messages.js';
import { stepsMessage } from '../stepsMessage.js';
import { makeRecipeFormValues } from '../../__fixtures__/index.js';

const e = editorMessages.en;

describe('stepsMessage', () => {
    it('says nothing when publish was not refused for the steps', () => {
        expect(stepsMessage(makeRecipeFormValues({ steps: [] }), {}, e)).toBeUndefined();
        expect(stepsMessage(makeRecipeFormValues({ steps: [] }), undefined, e)).toBeUndefined();
    });

    it('asks for a step when there are none, and marks no field', () => {
        expect(stepsMessage(makeRecipeFormValues({ steps: [] }), { steps: 'stepsRequired' }, e)).toEqual({
            text: e.steps.required,
            blank: [],
        });
    });

    it('asks to fill or remove the empty step, and marks only the empty ones', () => {
        const values = makeRecipeFormValues({
            steps: [{ instruction: 'Boil.' }, { instruction: '  ' }, { instruction: 'Drain.' }, { instruction: '' }],
        });

        expect(stepsMessage(values, { steps: 'stepsRequired' }, e)).toEqual({
            text: e.index.reason.stepBlank,
            blank: [1, 3],
        });
    });
});
