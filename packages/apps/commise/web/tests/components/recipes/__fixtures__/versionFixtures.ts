/**
 * Typed `make*` fixture factory for the web recipe version-history container tests (T069). `makeRecipeVersion`
 * is the shared, invariant-deriving Object Mother from `@kitchensink/recipe-core/testing` (T1) — re-exported
 * here so consuming tests keep importing from this local module.
 */
import { makeRecipeVersion } from '@kitchensink/recipe-core/testing';

export { makeRecipeVersion };
