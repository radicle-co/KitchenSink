import { describe, it } from 'vitest';
import { makeRecipeDetail } from '/home/brandon/Development/KitchenSink/packages/apps/commise/features/recipes/src/__fixtures__/index.js';
import {
    validateRecipeForm,
    toRecipeFormValues,
} from '/home/brandon/Development/KitchenSink/packages/apps/commise/features/recipes/src/form/model.js';

describe('probe', () => {
    it('shows the errors', () => {
        const values = toRecipeFormValues(makeRecipeDetail());
        // eslint-disable-next-line no-console
        console.log('VALUES', JSON.stringify(values, null, 2));
        console.log('ERRORS', JSON.stringify(validateRecipeForm(values)));
    });
});
