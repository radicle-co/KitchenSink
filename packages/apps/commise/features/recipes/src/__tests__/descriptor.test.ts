/**
 * The recipe feature's Home registration. Both apps register the feature through `addRecipeFeature` (it was a copy in
 * each app's `homeContainer`), so what a registered container resolves is the contract.
 */
import { describe, expect, it } from 'vitest';

import { resolveHomeWidgets } from '@commise/features-core';
import { createHomeContainer } from '@commise/features-core/home';

import { addRecipeFeature, recipeHomeWidgetDescriptor } from '../descriptor.js';

const noReporter = (): void => undefined;

describe('addRecipeFeature', () => {
    it('contributes exactly the recipe widget descriptor to the Home container', () => {
        const container = createHomeContainer({ features: [addRecipeFeature], errorReporter: noReporter });

        expect(resolveHomeWidgets(container)).toEqual([recipeHomeWidgetDescriptor]);
    });

    it('adds nothing for a container it was not applied to', () => {
        expect(resolveHomeWidgets(createHomeContainer({ features: [], errorReporter: noReporter }))).toEqual([]);
    });
});
