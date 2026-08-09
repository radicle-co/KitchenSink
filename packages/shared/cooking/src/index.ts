/**
 * `@kitchensink/cooking-core` — platform-free session and domain logic for Cooking Mode (feature 008).
 *
 * Contains no UI and no platform SDK. Recipe-shaped types come from `@kitchensink/recipe-core`.
 */

export { ALLOWED_SCALE_FACTORS } from './types.js';
export type { CookingSession, CookingTimer, ScaleFactor } from './types.js';

export {
    InvalidQuantityError,
    UnknownIngredientError,
    UnsupportedScaleFactorError,
    isInvalidQuantityError,
    isUnknownIngredientError,
    isUnsupportedScaleFactorError,
} from './errors.js';

export { isChecked, reconcile, toggleIngredient } from './controllers/IngredientCheckoffState.js';
export { scaleQuantity, setScaleFactor, shouldShowNotScaledAdvisory } from './controllers/YieldScalingState.js';
