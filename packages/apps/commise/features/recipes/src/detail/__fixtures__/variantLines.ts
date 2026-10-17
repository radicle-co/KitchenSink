/**
 * Recipe lines bound to `beef brisket`, a device-test root of the curated seed (curated plan KTD-16), for the read
 * surfaces' variant tests (U15). The variant's parts are AE1's, in contract order (KTD-7).
 */
import type { IngredientVariantPart, RecipeIngredientView } from '@kitchensink/recipe-core';

import { makeIngredientView } from '../../__fixtures__/index.js';

/** AE1: the brisket variant a cook picks in the details dialog. */
export const BRISKET_FLAT_HALF_PARTS: readonly [IngredientVariantPart, ...IngredientVariantPart[]] = [
    { attribute: 'cut', text: 'flat half' },
    { attribute: 'fat', text: 'separable lean and fat' },
    { attribute: 'trim', text: '1/8-inch trim' },
    { attribute: 'grade', text: 'select' },
    { attribute: 'cookingMethod', text: 'braised' },
];

/** AE1's parts as a screen reader hears them, and as no surface may show them. */
export const BRISKET_FLAT_HALF_SPOKEN = 'flat half, separable lean and fat, 1/8-inch trim, select, braised';

/**
 * A line bound to a brisket VARIANT: the root's name and id, and the variant with its parts.
 *
 * @param over - Fields to override.
 * @returns The line.
 */
export const makeVariantBoundLine = (over: Partial<RecipeIngredientView> = {}): RecipeIngredientView =>
    makeIngredientView({
        ingredientId: '00000000-0000-4000-8000-0000000000b2',
        name: 'beef brisket',
        foodId: 'food_beef_brisket',
        variant: { id: 'fdc:169432', parts: [...BRISKET_FLAT_HALF_PARTS] },
        quantity: { kind: 'exact', value: 2 },
        unit: 'lb',
        ...over,
    });

/**
 * A line bound to the brisket ROOT: the name, no variant, and a root that has variants to pick.
 *
 * @param over - Fields to override.
 * @returns The line.
 */
export const makeRootBoundLine = (over: Partial<RecipeIngredientView> = {}): RecipeIngredientView =>
    makeIngredientView({
        ingredientId: '00000000-0000-4000-8000-0000000000b1',
        name: 'beef brisket',
        foodId: 'food_beef_brisket',
        hasVariants: true,
        quantity: { kind: 'exact', value: 1 },
        unit: 'lb',
        ...over,
    });
