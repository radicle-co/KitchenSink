/**
 * The `./cook` surface as the NATIVE app resolves it. `IngredientCheckRow` has a `.native.tsx` leaf, and the native lane
 * resolves each name through `preferNativeLeaves`, so a name that exists only for the web would be missing here while the
 * web test passes. The list is the same one `cookSurface.test.ts` pins.
 */
import { describe, expect, it } from 'vitest';

import * as cook from '../index.js';

describe('@commise/features-recipes/cook (native resolution)', () => {
    it('exports exactly the runtime symbols cooking mode uses', () => {
        expect(Object.keys(cook).sort()).toEqual([
            'IngredientCheckRow',
            'ServingScaleControl',
            'formatAmount',
            'useCookMarks',
            'useServingScale',
        ]);
    });

    it('draws the native ingredient row, not the web one', async () => {
        const native = await import('../../detail/IngredientCheckRow.native.js');

        expect(cook.IngredientCheckRow).toBe(native.IngredientCheckRow);
    });
});
