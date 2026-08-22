/**
 * READ-SIDE UPGRADE for version snapshots written before U8 widened the quantity model.
 *
 * DESIGN PATTERN: Adapter at the persistence boundary — the sibling of `recipes/dal/quantityColumns.ts`,
 * which does the same job for the two `numeric` columns. Both exist so that exactly one shape of quantity
 * ever leaves this service, whatever shape the storage happens to hold.
 *
 * ## Why a snapshot needs this and a row does not
 *
 * `recipe_ingredients` is live data: migration 0020 changed its columns and every read goes through the
 * new mapping. `recipe_versions.snapshot` is a JSONB document frozen at the moment its version was cut,
 * and a version is IMMUTABLE by design — there is no migration that could rewrite one without destroying
 * the property the table exists to provide. So the OLD spelling (`"quantity": 2`) is permanent, and the
 * reader is what has to speak both.
 *
 * This is ADR-0022's expand-first rule applied to a document rather than a column: the code that reads the
 * new shape ships first, and tolerates the old one for as long as the old data exists — which here is
 * forever.
 *
 * ## ⛔ It NORMALIZES; it does not VALIDATE, and that is deliberate
 *
 * The call sites it serves were `row.snapshot as RecipeSnapshot` and `JSON.parse(...) as RecipeVersion` —
 * unchecked casts, i.e. "trust the blob". Escalating them to a full `recipeSnapshotSchema.parse` would
 * turn every stored document that does not match TODAY's schema into a `500` on an ordinary GET, for data
 * nobody is able to repair. This function therefore changes exactly the ONE field whose stored
 * representation U8 knowingly changed and carries everything else through, including shapes it does not
 * recognise. Refusing a malformed snapshot stays the wire schema's job, in one place.
 */
import type { IngredientQuantity, RecipeSnapshot } from '@kitchensink/recipe-core';

/** A snapshot as it comes out of storage — a JSONB document or an S3 object, of unproven shape. */
type StoredSnapshot = { readonly ingredients?: unknown } & Record<string, unknown>;

/**
 * Upgrade one line's stored quantity to the canonical value object. Pure.
 *
 * ⛔ Only a POSITIVE number is upgraded. `0` was never a legal stored quantity — `CHECK (quantity > 0)` has
 * refused it since the first migration — so there is no case in which this function has to decide whether
 * a zero meant "none of it" or "the source said nothing", the exact ambiguity U8 exists to remove. Anything
 * that is not a positive number is carried through for the wire schema to judge.
 */
function upgradeQuantity(quantity: unknown): unknown {
    return typeof quantity === 'number' && Number.isFinite(quantity) && quantity > 0
        ? ({ kind: 'exact', value: quantity } satisfies IngredientQuantity)
        : quantity;
}

/**
 * Upgrade a stored version snapshot so its ingredient quantities are in the shape the wire publishes. Pure
 * — the stored document is copied, never mutated.
 *
 * @param stored - The snapshot as it came out of `recipe_versions.snapshot` or the S3 archive object.
 * @returns The same document with every PRE-U8 bare-number quantity replaced by its `exact` value object.
 *   A document this function does not recognise is returned unchanged; see the module note on why it does
 *   not throw.
 */
export function upgradeStoredSnapshot(stored: unknown): RecipeSnapshot {
    if (typeof stored !== 'object' || stored === null) {
        return stored as RecipeSnapshot;
    }

    const snapshot = stored as StoredSnapshot;

    if (!Array.isArray(snapshot.ingredients)) {
        return stored as RecipeSnapshot;
    }

    return {
        ...snapshot,
        ingredients: snapshot.ingredients.map((line: unknown) =>
            typeof line === 'object' && line !== null
                ? { ...line, quantity: upgradeQuantity((line as { quantity?: unknown }).quantity) }
                : line,
        ),
    } as unknown as RecipeSnapshot;
}
