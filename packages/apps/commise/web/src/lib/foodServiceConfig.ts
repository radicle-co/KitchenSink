/**
 * Base origin for `@kitchensink/food-service-client` (plan 002 S5), resolved from the validated configuration in
 * `@/config/env`, never hardcoded and never defaulted, as `recipeServiceConfig.ts` resolves the recipe origin.
 */
import { env } from '@/config/env';

export const FOOD_SERVICE_BASE_URL = env.NEXT_PUBLIC_FOOD_API_URL;
