/**
 * THE CANONICAL FORM OF A SHARED FOOD/INGREDIENT NAME — one place, used by every writer, in every service.
 *
 * TWO tables in this system are ownerless, shared by every user, and display a name whoever typed it first
 * chose for everyone: food-service's `food` (globally unique-named, `normalized_name` behind a `UNIQUE`
 * index) and recipe-service's `ingredients` (no `owner_id`, searched by every user's typeahead). A caller's
 * raw string entering either of them is a piece of shared state, and an unnormalized one gives an attacker
 * two distinct weapons:
 *
 *  - **Identity split.** `Broccoli` and `Bro<ZWSP>ccoli` render identically and key differently, so the dedup
 *    grain is bypassed by an invisible character. Every distinct key is a fresh row and a fresh source fetch
 *    against a scarce budget.
 *  - **Display forgery.** A bidirectional override reorders what a reader sees against what is stored, so the
 *    name shown in the picker is not the name any query matches.
 *
 * The rule is therefore: **NFKC, drop the invisible, separate on control, collapse, trim**.
 *
 * ⚠️ THE RULE LIVES HERE, NOT IN EITHER SERVICE. It began as food-service's `foods/foodName.ts`, which
 * recipe-service could not import (a service never reaches into another service's `src`), so recipe-service
 * persisted `name.trim()` and the two catalogs disagreed about which characters count. `@kitchensink/recipe-core`
 * is the one package BOTH services already depend on, and it is a zod-only leaf. Do not copy it back into a
 * service.
 *
 * ⛔ **Reachable ONLY as `@kitchensink/recipe-core/food-name`, deliberately — like `./database-name`, and NOT
 * re-exported from the barrel.** `contract-gen`'s composed-sources fingerprint hashes the full text of every
 * recipe-core module a `*.schema.ts` demands, and `src/index.ts` is one of them — so a single added line in
 * the barrel moves the recipe service's `CONTRACT_HASH` and lights up skew warnings on every pinned client
 * for a change with no wire projection. The fingerprint "must move for wire reasons and only wire reasons"
 * (`composedSources.ts`), and Unicode hygiene is not a wire reason: the deferred UTS #39 confusables work
 * below would otherwise break clients that are not affected by it. This is also why the canonical form is
 * applied in a CONTROLLER rather than inside an authored request schema.
 *
 * ⚠️ This is Unicode *hygiene*, not confusable folding. `Broccoli` spelled with a Cyrillic `о` still keys
 * distinctly; that needs a confusables table (UTS #39) and is recorded as deferred work (finding `23.S-11`).
 */

/**
 * Format characters (`Cf`) — zero-width space, the BOM, soft hyphen, and the bidi overrides. They are
 * REMOVED rather than replaced: they carry no width, so `Bro<ZWSP>ccoli` is the single word `Broccoli`, and
 * substituting a separator would preserve exactly the split this exists to close.
 */
const INVISIBLE = /\p{Cf}/gu;

/**
 * Control characters (`Cc`) — newline, tab, NUL and friends. They DO separate, so they become a space; the
 * collapse below then folds runs of them. Dropping them outright would silently join the words either side.
 */
const CONTROL = /\p{Cc}/gu;

/** Any run of whitespace, including the exotic spaces NFKC leaves as-is (`\s` is Unicode-aware under `u`). */
const WHITESPACE_RUN = /\s+/gu;

/**
 * Reduce a caller-supplied name to the form a shared catalog stores and displays.
 *
 * Idempotent, and safe on names that need nothing: accents, apostrophes, commas and parentheses all survive
 * unchanged, because NFKC is the *compatibility* composition — it folds fullwidth and ligature spellings onto
 * their ordinary ones without touching ordinary text.
 *
 * @param raw - The caller's string, already length-bounded by the wire contract.
 * @returns The canonical display form, or `''` when the input carried no visible content at all.
 */
export function sanitizeFoodName(raw: string): string {
    return raw.normalize('NFKC').replace(INVISIBLE, '').replace(CONTROL, ' ').replace(WHITESPACE_RUN, ' ').trim();
}
