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
 * ⚠️ IT HAS BEEN BUMPED ONCE, to `v2`, and the reason is worth keeping: migration 0027 added the pair the
 * SOURCE printed (`one gill`) beside the pair we restated it to (`0.5 cup`), and the gate now asks about the
 * stated one. A line judged before that change and the same line judged after it share every OTHER member of
 * the tuple, so at `v1` the corrected line would have looked up the pre-correction verdict — and because
 * absence of a verdict is what publishes, U14 would have withheld nutrition from a correctly-parsed line
 * forever. Every `v1` row is now inert; that is the intended cost, and it is cheapest before the corpus is
 * verified in production.
 *
 * ⛔ Reachable ONLY as `@kitchensink/recipe-core/resolution/verification-key`, never from the barrel.
 */

/**
 * The generation of the derivation below.
 *
 * ⛔ BUMP THIS whenever {@link verificationKeyPreimage} changes what it serializes, in what order, or how it
 * normalizes. Not bumping it is the silent re-partition described above.
 */
export const VERIFICATION_KEY_VERSION = 'v2';

/**
 * What the SOURCE printed, when this line's measure was RESTATED before it was persisted (migration 0027).
 *
 * The importer converts a historical unit at parse time — `one gill of milk` becomes `0.5 cup`, because the
 * USDA household-portion table has never heard of a gill — and it is the STATED pair the gate asks the model
 * about, since that is what the source's own words support.
 *
 * ⛔ Neither member is nullable except the upper bound, and that is not defensive typing. A restatement of an
 * `absent` quantity is not a thing (`convertHistoricalUnit` refuses one outright), and a restatement FROM no
 * unit is not a thing either — so a stated measure with a missing half is a state no producer can reach.
 * "This line was not restated" is spelled by the whole member being `null`.
 */
export interface StatedMeasureIdentity {
    /** The amount the source printed, or the low end of a printed range. */
    readonly quantityLow: number;
    /** The high end of a printed range. `null` when the source printed one value. */
    readonly quantityHigh: number | null;
    /** The unit the source printed. */
    readonly unit: string;
}

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
    /**
     * What the source PRINTED, when the five members above are a RESTATEMENT of it. `null` when they are
     * what the source itself said — which is every authored line and every line stating a modern unit.
     *
     * ⛔ IT IS PART OF THE JUDGEMENT, not context beside it, and leaving it out would have been the exact
     * failure this module's own docstring names. A restated line and an un-restated one can share all five
     * other members — the corpus imported before migration 0027 and re-imported after it produce precisely
     * that pair — while the model is shown DIFFERENT numbers and reaches a DIFFERENT verdict. Sharing a key
     * across them is "the worst possible cache hit, because it looks like a saving", and here it would serve
     * the pre-0027 false DISAGREE to the corrected line forever, since absence of a verdict is the only thing
     * that publishes.
     *
     * ⚠️ `candidateFoodName` is prompt content that is deliberately NOT here, and is not a counter-example:
     * it is a function of `foodId`, so it is not an independent axis. This is one, and it is caller-supplied.
     *
     * ⚠️ REQUIRED KEY with a `null` value, never optional. Every construction site — `verifiedLineIdentity`,
     * the queue producer, the worker, the parity test — becomes a compile error rather than silently keying
     * the old way.
     */
    readonly statedMeasure: StatedMeasureIdentity | null;
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
        // ONE nested member, not three flat ones: "this line was not restated" then has exactly one spelling
        // rather than three coordinated nulls that a future edit could let disagree. The nesting also keeps a
        // stated unit from running into the bound beside it, which is the same boundary property the outer
        // JSON array buys.
        identity.statedMeasure === null
            ? null
            : [identity.statedMeasure.quantityLow, identity.statedMeasure.quantityHigh, identity.statedMeasure.unit],
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
