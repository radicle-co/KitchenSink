/**
 * `NormalizedIngredientKey` — the PERSISTED match grain of the ingredient-resolution knowledge base
 * (plan U10 / R14, R19, R20).
 *
 * DESIGN PATTERN: **Value Object + smart constructor**, the sibling of `CanonicalIngredientName` in shape and
 * the deliberate OPPOSITE of it in purpose. The two are easy to confuse and must never be interchanged:
 *
 *  - `CanonicalIngredientName` is a DISPLAY name for the shared catalog. It preserves case and is
 *    deliberately lossless, because a user reads it.
 *  - `NormalizedIngredientKey` is an EQUIVALENCE-CLASS key. It destroys case, because two users spelling the
 *    same thing differently must COLLIDE on it — that collision is the entire mechanism by which one cook's
 *    correction resolves another cook's line (R19) and by which two independent corrections corroborate each
 *    other (R20). Its output is never shown to anyone.
 *
 * Storing a display name where a key belongs silently halves the hit rate and quietly breaks corroboration,
 * with no error anywhere; the brand turns that into a compile failure at the write site.
 *
 * ## ⛔ WHY IT LIVES HERE, IN `recipe-core`, AND NOT IN THE RECIPE SERVICE
 *
 * The same reason `sanitizeFoodName` does, one table further along. TWO processes write this key: the recipe
 * service (a user's correction, and the tier-1 read) and — from plan U11 — the verification gate running in
 * `recipe-workers`, which CANNOT import recipe-service's `src`: that service's Drizzle models live inside its
 * own `src` and are not a shared package, so the worker holds a schema-less handle and issues raw SQL
 * (`recipe-workers/src/common/db.ts` owns that reasoning). ⚠️ An earlier revision made the point by
 * enumerating the worker's three dependencies; the list has since grown past a dozen, so the reason is cited
 * rather than counted. A second copy of a PERSISTED key derivation is the worst drift
 * available in this system: a one-character divergence partitions the tables into two key-spaces that never
 * intersect, and **nothing fails** — no error, no failing test, just a knowledge base that stops hitting.
 *
 * ⛔ **Reachable ONLY as `@kitchensink/recipe-core/resolution/normalized-key`, and NOT re-exported from the
 * barrel** — the rule `./food-name` and `./database-name` already follow. `contract-gen`'s composed-sources
 * fingerprint hashes the full text of every recipe-core module a `*.schema.ts` demands, and `src/index.ts` is
 * one of them, so a single added line in the barrel moves the recipe service's `CONTRACT_HASH` and lights up
 * skew warnings on every pinned client for a change with no wire projection. For the same reason: **never
 * import this from a `*.schema.ts`.**
 *
 * ## The derivation is a ONE-WAY DOOR, and the mitigation is stored beside the key
 *
 * Because the key is the indexed column, changing this function re-partitions both tables. That is made
 * recoverable rather than fatal by persisting the raw `source_phrase` alongside every `normalized_key`, so a
 * derivation change is a backfill (`UPDATE … SET normalized_key = f(source_phrase)`) instead of data loss —
 * and by pinning the derivation with the golden `(raw → key)` table in this module's unit test, so any change
 * appears as a visible diff rather than a silent re-partition.
 *
 * ⚠️ RELATED TO, BUT NOT THE SAME AS, food-service's `normalizeName`. Both compose {@link sanitizeFoodName}
 * and lowercase it, and today they are the same expression. They are separate because they key different
 * things for different reasons: food's is the `UNIQUE` dedup grain of a golden record's NAME, this is the
 * match grain of a cook's typed PHRASE — and this is the one that will grow phrase-specific folding (plurals,
 * trailing qualifiers) as the corpus teaches us what to fold, at which point they diverge for good.
 *
 * ⚠️ The constructor is TOTAL and returns `undefined` rather than throwing, for the reason
 * `canonicalIngredientName` gives: a phrase with no visible content is a caller sending zero-width characters
 * — an ordinary `400` — and it is ALSO the answer for an unattended import meeting an empty line, which is a
 * "record it unresolved" outcome rather than a failure. Both callers must BRANCH on it, and an exception is
 * the wrong shape for a branch.
 */
import { z } from 'zod';

import { sanitizeFoodName } from '../foodName.js';

const normalizedIngredientKeySchema = z.string().min(1).brand<'NormalizedIngredientKey'>();

/**
 * The lookup key a curated mapping, a resolution memo and a cascade query all agree on.
 *
 * Structurally a `string` at runtime (it serializes, logs, and binds as a query parameter as one); a distinct
 * type at compile time, so it cannot be produced by anything but {@link normalizedIngredientKey}.
 */
export type NormalizedIngredientKey = z.infer<typeof normalizedIngredientKeySchema>;

/**
 * Smart constructor — reduce a cook's raw ingredient text to the form the knowledge base keys on, and brand
 * it.
 *
 * Idempotent, because `sanitizeFoodName` is and `toLowerCase` is: re-parsing an already-normalized key at a
 * write point costs correctness nothing.
 *
 * @param phrase - Any candidate phrase: a request body's ingredient text, or an importer's parsed line.
 * @returns The branded key, or `undefined` when the phrase carried no visible content at all.
 */
export function normalizedIngredientKey(phrase: string): NormalizedIngredientKey | undefined {
    const parsed = normalizedIngredientKeySchema.safeParse(sanitizeFoodName(phrase).toLowerCase());

    return parsed.success ? parsed.data : undefined;
}
