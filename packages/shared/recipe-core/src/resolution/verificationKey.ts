/**
 * THE CONTENT KEY a line verdict is stored under (plan U11).
 *
 * DESIGN PATTERN: **content-addressed idempotency key**, with the digest injected as a Port so this module
 * stays pure and free of a Node dependency. `recipe-core` is imported by the web and mobile bundles through
 * its barrel; pulling `node:crypto` into it for one server-side module would be a dependency the whole
 * package pays for. What must NOT drift is the CANONICAL SERIALIZATION — what goes into the digest and in
 * what order — and that is exactly what lives here.
 *
 * ## ⛔ WHY NOT `recipe_ingredients.id`
 *
 * `RecipeIngredientsDal.replaceForRecipe` deletes every row of a recipe's ingredients and re-inserts them with
 * fresh `defaultRandom()` ids on EVERY recipe update. A verdict keyed on that id would:
 *
 *  - be written against a row that no longer exists whenever a message is in flight across an edit; and
 *  - discard every verdict for the whole recipe on any edit, re-verifying — and re-PAYING for — every line
 *    because one word changed in a step.
 *
 * Keying on the content of the judgement removes both: the write is idempotent by primary key, verdicts
 * survive edits, and a line appearing in two of the corpus's 448 recipes is verified once. It also means the
 * verdict table stores no user text — the key is a digest.
 *
 * ## ⚠️ THE VERSION PREFIX IS LOAD-BEARING
 *
 * Changing what goes into the preimage re-partitions the table. Without a version, old rows silently become
 * unreachable while new rows collide with nothing — the system appears to work while every stored verdict
 * quietly stops applying. The prefix turns that into a visible, additive event: bump it, and the old
 * generation is inert and enumerable rather than invisible.
 *
 * ⛔ Reachable ONLY as `@kitchensink/recipe-core/resolution/verification-key`, never from the barrel.
 */

/**
 * The generation of the derivation below.
 *
 * ⛔ BUMP THIS whenever {@link verificationKeyPreimage} changes what it serializes, in what order, or how it
 * normalizes. Not bumping it is the silent re-partition described above.
 */
export const VERIFICATION_KEY_VERSION = 'v1';

/** Everything a verdict is ABOUT — change any of it and the judgement is a different one. */
export interface VerifiedLineIdentity {
    /** The line the cook's source actually said. */
    readonly sourceLine: string;
    /** The opaque food-service id the cascade resolved to. */
    readonly foodId: string;
    /** The parsed amount, or the low end of a range. `null` when the parse found none. */
    readonly quantityLow: number | null;
    /** The high end of a range. `null` for an exact quantity — DISTINCT from `0`. */
    readonly quantityHigh: number | null;
    /** The parsed unit. `null` when there was none — DISTINCT from `''`. */
    readonly unit: string | null;
}

/**
 * Normalize a source line so one line has one key.
 *
 * NFC because the same text typed with a precomposed `é` and with `e` + combining acute is the same line to a
 * cook and to a model; two keys for it would double the spend and halve the hit rate, invisibly. Whitespace is
 * collapsed and trimmed because indentation is not part of the judgement.
 *
 * ⛔ Case is NOT folded, and that is the deliberate opposite of `normalizedIngredientKey`. That one destroys
 * case because it is an equivalence-class key for MATCHING two cooks' phrases. This one identifies a
 * JUDGEMENT about a specific line, and a model may legitimately read a capitalised proper noun differently.
 *
 * @param line - The raw source line.
 * @returns The normalized line. Pure.
 */
function normalizeLine(line: string): string {
    return line.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

/**
 * The exact string the digest is taken over.
 *
 * A JSON array, not a concatenation. ⛔ With a naive `a + b` join, `unit: 'cup'` + `foodId: 'X'` and
 * `unit: 'cupX'` + `foodId: ''` produce the same string, so two different judgements would share a verdict —
 * the worst possible cache hit, because it looks like a saving. JSON's own escaping makes that
 * unrepresentable, and it distinguishes `null` from `''` and from `0` for free.
 *
 * Exported so a test can assert what is hashed rather than only that hashing happened.
 *
 * @param identity - The judgement's subject.
 * @returns The canonical preimage. Pure.
 */
export function verificationKeyPreimage(identity: VerifiedLineIdentity): string {
    return JSON.stringify([
        VERIFICATION_KEY_VERSION,
        normalizeLine(identity.sourceLine),
        identity.foodId,
        identity.quantityLow,
        identity.quantityHigh,
        identity.unit,
    ]);
}

/** A hex digest function. `createHash('sha256').update(x).digest('hex')` at the worker. */
export type HexDigest = (input: string) => string;

/**
 * The key a verdict for this judgement is stored under.
 *
 * @param identity - The judgement's subject.
 * @param digest - The hash. Injected so this module carries no crypto dependency.
 * @returns `{version}:{digest}`. Pure, given a pure digest.
 */
export function verificationKey(identity: VerifiedLineIdentity, digest: HexDigest): string {
    return `${VERIFICATION_KEY_VERSION}:${digest(verificationKeyPreimage(identity))}`;
}
