/**
 * What food-service told this service about one food reference, in the recipe domain's own terms.
 *
 * The food refs gateway (`ingredients/foodRefs.gateway.ts`) is the anti-corruption layer that produces it from
 * food's wire answer: it parses the name into a {@link CanonicalIngredientName}, keeps food's lifecycle status,
 * and turns every transport failure into `unreachable`. The policies read only this type, so none of them
 * depends on food's wire shape.
 *
 * ⛔ Three outcomes, kept apart (plan 002 R2): `absent` is food's definite answer that the caller may not read
 * the food or that it does not exist (the two are indistinguishable on purpose); `unreachable` means food could
 * not be asked. Collapsing them turns an outage into a permanent-looking fact about a cook's recipe.
 */
import type { FoodStatus } from '@kitchensink/food-service-client';

import type { CanonicalIngredientName } from './ingredientName.js';

/** Food's answer about one reference. */
export type FoodRefAnswer =
    | {
          readonly outcome: 'found';
          /** The food's name in canonical form, or `undefined` when food published no usable name. */
          readonly name: CanonicalIngredientName | undefined;
          /** Food's own lifecycle status on this read. */
          readonly status: FoodStatus;
          /** Whether the food is the CALLER's private authored food; food shows a private food to its author only. */
          readonly isPrivate: boolean;
      }
    | { readonly outcome: 'absent' }
    | { readonly outcome: 'unreachable' };
