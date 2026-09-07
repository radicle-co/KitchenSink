/**
 * THE `food` TABLE'S DEDUP KEY — food-service's own half of the shared-name rule.
 *
 * ⚠️ The canonical DISPLAY form used to live here and now lives in `@kitchensink/recipe-core`
 * (`sanitizeFoodName`), because recipe-service's `ingredients` table is the SECOND ownerless, shared,
 * name-displaying catalog in this system and could not import a rule that sat inside another service — so it
 * persisted `name.trim()` and the two catalogs disagreed about which characters count (plan U3). Read that
 * module for the identity-split and display-forgery reasoning; what stays here is the part that is genuinely
 * food's alone: the key its `UNIQUE` index is built on.
 */
import { sanitizeFoodName } from '@kitchensink/recipe-core/food-name';

/**
 * The dedup grain the survivor count groups on and `food.normalized_name` keys on (FR-005/FR-MRG-5) —
 * {@link sanitizeFoodName} lowercased, so a name and its key can never disagree about which characters count.
 *
 * @param name - The raw display name.
 * @returns The normalized dedup key, or `''` when the name carried no visible content.
 */
export function normalizeName(name: string): string {
    return sanitizeFoodName(name).toLowerCase();
}
