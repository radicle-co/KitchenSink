/**
 * The shapes of a read-view line that place its quantity differently (`docs/design/readSurfacesEvaluation.md` D1), for
 * the web and native suites to run one table over: the quantity leads the name, or the stand-in that takes the name's
 * place, in the line's one text block. A stand-in's quantity is its own line above the chip
 * (`designAnswers.md` #144 item 12), so it leads the chip without flowing into it.
 */
import { FoodResolutionStatus, type RecipeIngredientView } from '@kitchensink/recipe-core';

import { makeIngredientView } from '../../__fixtures__/index.js';
import { recipeMessages } from '../../messages.js';
import { BRISKET_FLAT_HALF_SPOKEN, makeRootBoundLine, makeVariantBoundLine } from './variantLines.js';

/** One shape: the line, the text its quantity and its name show, and its checkbox's accessible name. */
export interface QuantityLineShape {
    readonly what: string;
    readonly line: RecipeIngredientView;
    /** The quantity as shown; `''` for a line that states no amount. */
    readonly quantity: string;
    /** The name as shown, or the stand-in in its place. */
    readonly name: string;
    readonly checkbox: string;
    /** The quantity is a line of its own above the name: a stand-in's chip (`designAnswers.md` #144 item 12). */
    readonly ownLine?: true;
}

const PRIVATE_FOOD = recipeMessages.en.ingredientLineName.privateFood;

export const QUANTITY_LINE_SHAPES: readonly QuantityLineShape[] = [
    {
        what: 'a root-bound line',
        line: makeRootBoundLine(),
        quantity: '1 lb',
        name: 'beef brisket',
        checkbox: '1 lb beef brisket',
    },
    {
        what: 'a variant-bound line',
        line: makeVariantBoundLine(),
        quantity: '2 lb',
        name: 'beef brisket',
        checkbox: `2 lb beef brisket, ${BRISKET_FLAT_HALF_SPOKEN}`,
    },
    {
        what: 'a line whose stand-in takes the name’s place',
        line: makeIngredientView({
            ingredientId: '00000000-0000-4000-8000-0000000000b9',
            name: undefined,
            quantity: { kind: 'exact', value: 2 },
            unit: 'tbsp',
            resolutionStatus: FoodResolutionStatus.RESOLVED_UNAVAILABLE,
        }),
        quantity: '2 tbsp',
        name: PRIVATE_FOOD,
        checkbox: `2 tbsp ${PRIVATE_FOOD}`,
        ownLine: true,
    },
    {
        what: 'a line that states no amount',
        line: makeRootBoundLine({ quantity: { kind: 'absent' }, unit: undefined }),
        quantity: '',
        name: 'beef brisket',
        checkbox: 'beef brisket',
    },
    {
        what: 'a line with a range',
        line: makeRootBoundLine({ quantity: { kind: 'range', low: 2, high: 3 }, unit: 'cups' }),
        quantity: '2–3 cups',
        name: 'beef brisket',
        // The checkbox is named by its visible text, dash included (WCAG 2.5.3, option C).
        checkbox: '2–3 cups beef brisket',
    },
];
