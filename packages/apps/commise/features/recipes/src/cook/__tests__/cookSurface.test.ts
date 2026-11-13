/**
 * The `./cook` subpath is the exact surface cooking mode takes from the recipe page. A symbol added here is a symbol
 * cooking mode can depend on, so the list is pinned: it grows by a decision, not by a stray re-export.
 */
import { describe, expect, it } from 'vitest';

import * as cook from '../index.js';

describe('@commise/features-recipes/cook', () => {
    it('exports exactly the runtime symbols cooking mode uses', () => {
        expect(Object.keys(cook).sort()).toEqual([
            'IngredientCheckRow',
            'ServingScaleControl',
            'formatQuantity',
            'useCookMarks',
            'useServingScale',
        ]);
    });
});
