/**
 * Typed `make*` fixture factory for catalog `Ingredient` records, used by the ingredient-picker and
 * recipe create/edit container tests. `makeIngredient` is the shared, invariant-deriving Object Mother
 * from `@kitchensink/recipe-core/testing` (T1) — re-exported here so consuming tests keep importing from
 * this local module.
 */
import { makeIngredient } from '@kitchensink/recipe-core/testing';

export { makeIngredient };
