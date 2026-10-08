/**
 * Whether a recipe write records a `recipe_versions` row (ADR-0058, which amends ADR-0034).
 *
 * A save of a recipe that has never been published overwrites it in place and records no version; versions start
 * at the first publish. The editor saves a draft on a cadence, and a version per save would push the cook's real
 * history out of the ten-version window.
 *
 * ⛔ KEYED ON `firstPublishedAt`, NEVER ON `status`. A published recipe may be set back to draft, and its saves must
 * keep versioning, or a demotion would let its published history be overwritten in place.
 *
 * ⛔ AND IT IS JUDGED ON THE ROW THE WRITE RETURNED, inside the write's transaction. It is not a caller's choice:
 * ADR-0034 deleted the caller opt-out, and this does not bring it back. The database sets `first_published_at` on
 * the first publish and never clears it (`recipes_first_published_at_ratchet`, migration 0053), so the row a write
 * returns is the authority.
 *
 * @pattern Specification — one pure predicate over the persisted row
 */
import type { RecipeRow } from '../../database/schema/index.js';

/**
 * Whether a write that produced this row records a version.
 *
 * @param recipe - The recipe row the write returned.
 * @returns `true` once the recipe has ever been published. Pure.
 */
export function recordsVersion(recipe: Pick<RecipeRow, 'firstPublishedAt'>): boolean {
    return recipe.firstPublishedAt !== null;
}
