/**
 * THE CATALOG NAME'S CANONICAL FORM — one place, used by every writer.
 *
 * The `food` table is **ownerless, globally unique-named and shared by every user**: whoever types a name
 * first owns it for everyone, `normalized_name` is the identity key behind a `UNIQUE` index, and the display
 * name is served in every user's typeahead. That makes a caller's raw string a piece of shared state, and an
 * unnormalized one gives an attacker two distinct weapons:
 *
 *  - **Identity split.** `Broccoli` and `Bro<ZWSP>ccoli` render identically and key differently, so the dedup
 *    grain — the whole point of `normalized_name` — is bypassed by an invisible character. Every distinct key
 *    is a fresh row and a fresh source fetch against a scarce budget.
 *  - **Display forgery.** A bidirectional override reorders what a reader sees against what is stored, so the
 *    name shown in the picker is not the name any query matches.
 *
 * The rule is therefore: **NFKC, drop the invisible, separate on control, collapse, trim** — and the dedup key
 * is the sanitized display name lowercased, so the two can never describe different strings.
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
 * Reduce a caller-supplied name to the form the catalog stores and displays.
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
