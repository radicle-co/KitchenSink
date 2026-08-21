/**
 * `CanonicalIngredientName` — the value object that makes "an `ingredients` row is named in canonical form"
 * a fact the COMPILER checks, rather than a convention every future write path must remember.
 *
 * DESIGN PATTERN: **Value Object + smart constructor**, the same shape (and for the same reason) as
 * `@kitchensink/recipe-core`'s branded ids. `ingredients` is an ownerless catalog with no `owner_id`: whoever
 * adds a food names it for every user who later searches. So the display name is shared global state, and a
 * raw `string` reaching a write is indistinguishable from a parsed one — which is exactly how plan U3's defect
 * arose, with three separate write paths each applying their own weaker `.trim()`.
 *
 * The brand closes that by construction. {@link IngredientsDal}'s inputs are typed to it, so a new write path
 * that has not parsed its name is a COMPILE error rather than a row of recipe prose in everybody's typeahead.
 *
 * ⚠️ The constructor is TOTAL and returns `undefined` rather than throwing, unlike `recipeId`/`userId`. A name
 * with no visible content is not a programmer error here: it is a caller sending zero-width characters, and an
 * ordinary `400` — and a golden record legitimately carrying an unusable name, which is a "keep what we have"
 * outcome, not a failure. Both callers need to BRANCH on it, and an exception is the wrong shape for a branch.
 */
import { z } from 'zod';
import { sanitizeFoodName } from '@kitchensink/recipe-core/food-name';

const canonicalIngredientNameSchema = z.string().min(1).brand<'CanonicalIngredientName'>();

/**
 * A shared-catalog ingredient display name, guaranteed to be in canonical form and non-empty.
 *
 * Structurally a `string` at runtime (it serializes, logs and compares as one); a distinct type at compile
 * time, so it cannot be produced by anything but {@link canonicalIngredientName}.
 */
export type CanonicalIngredientName = z.infer<typeof canonicalIngredientNameSchema>;

/**
 * Smart constructor — reduce a raw name to the shared catalog's canonical form and brand it.
 *
 * Idempotent, because {@link sanitizeFoodName} is: passing an already-canonical name back through changes
 * nothing, so belt-and-braces re-parsing at a write point costs correctness nothing.
 *
 * @param raw - Any candidate name: a caller's request body, or another service's published display name.
 * @returns The branded canonical name, or `undefined` when the input carried no visible content at all.
 */
export function canonicalIngredientName(raw: string): CanonicalIngredientName | undefined {
    const parsed = canonicalIngredientNameSchema.safeParse(sanitizeFoodName(raw));

    return parsed.success ? parsed.data : undefined;
}
