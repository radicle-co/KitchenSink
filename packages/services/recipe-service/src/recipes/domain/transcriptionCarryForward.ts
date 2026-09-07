/**
 * THE TRANSCRIPTION CARRY-FORWARD RULE (plan U11/U14, widened by U7) — when an updated ingredient line keeps
 * what it was transcribed from, and when that transcription has gone stale.
 *
 * ⚠️ It carries THREE facts, and the module was renamed from `sourceLineCarryForward.ts` when the second
 * arrived: the raw source line (migration 0024), the measure the source PRINTED before a historical unit
 * was restated (migration 0027), and the ingredient PHRASE the parse lifted out of the line — the memo
 * tier's key grain (migration 0041, owner ruling 2026-08-31). A name that enumerated only one of them was
 * an invitation to add the next carry-forward somewhere else instead of here.
 *
 * DESIGN PATTERN: **Specification / Policy module**, the sibling of `provenancePolicy.ts` and
 * `visibilityPolicy.ts` and shaped like them: pure, total, no I/O, no Drizzle, no Nest, and exhaustible as a
 * truth table. It decides ONE thing — "does the transcription we hold still describe the line in front of
 * me?" — and returns an answer per incoming line. The caller does the assigning.
 *
 * ## ⛔ Why this exists: a create-only wire field is NOT the same thing as a create-only FACT
 *
 * `sourceLine` rides `createRecipeIngredientInputSchema` and deliberately never the base, because
 * `updateRecipeRequestSchema` derives from that base and ADR-0023 records what happens when a create-time
 * fact becomes assertable on `PATCH`. That shape is right and stays.
 *
 * What was WRONG was the consequence claimed for it. The first version of that decision reasoned: "a
 * metadata-only `PATCH` supplies no `ingredients`, so it preserves the source lines." That sentence is FALSE
 * against both shipped clients. `toUpdateRecipeInput` (`@commise/features-recipes`'s `form/model.ts`)
 * destructures `visibility` out of `toCreateRecipeInput(values, status)` and spreads the rest — and
 * `toCreateRecipeInput` ALWAYS emits `ingredients`. Web and mobile both go through it. **There is no
 * metadata-only PATCH from any shipped client**, so `RecipeIngredientsDal.replaceForRecipe` runs on every
 * save, and correcting a typo in an imported recipe's TITLE would silently destroy every source line on it.
 * After that the verification gate reads `skip: 'no-source-text'` for that recipe forever, and the correction
 * surface loses the evidence it was built to check against.
 *
 * ⛔ THE OBVIOUS REPAIRS ARE BOTH WORSE. Widening the wire so `PATCH` may carry a source line is precisely
 * the trap; matching stored to incoming lines BY POSITION would move one author's words onto a different
 * line the moment a line is inserted or reordered, which is silent corruption of the exact evidence a gate
 * verdict is about. So the transcription is carried by IDENTITY, and dropped when the identity moves.
 *
 * ## The tuple is derived, not chosen
 *
 * It is `verificationKeyPreimage`'s digest membership (`@kitchensink/recipe-core/resolution/verification-key`)
 * MINUS the line itself: `[ingredientId, quantity (both bounds), unit]`. Those are exactly the facts a verdict
 * is ABOUT, which makes the rule a statement rather than a heuristic:
 *
 *  - unchanged ⇒ a verdict on the old line would be a verdict on the new one ⇒ the transcription still
 *    describes it ⇒ carry it;
 *  - changed ⇒ the judgement is a DIFFERENT judgement ⇒ the transcription is stale, and carrying it would
 *    have the gate check our parse of `3 cups` against a source that said `2 cups` and correctly disagree
 *    with an edit the author made on purpose.
 *
 * ⚠️ `name` and `notes` are deliberately OUT of the tuple. `name` is OUR rendering, and plan U3 has
 * food-service's canonical name overwrite it the moment a food resolves — including it would drop every
 * transcription in the installation on the first background resolution. `notes` is a display override the
 * author chose and asserts nothing about what the source said.
 *
 * ⚠️ `foodId` is out too, even though the verification key contains it: it is not a column of
 * `recipe_ingredients` but of the shared `ingredients` row this line points at, and it can be filled in
 * asynchronously long after the line was written. Keying on `ingredientId` is the same fact one indirection
 * earlier, and it does not move when a background resolution attaches a food.
 */
import { quantitiesEqual, type IngredientQuantity, type StatedMeasure } from '@kitchensink/recipe-core';

/**
 * Everything one line inherits from the version of itself already stored.
 *
 * ⛔ A BUNDLE, not two policies. Both members are create-only wire fields, both are swapped away by
 * `replaceForRecipe` on every save, and both are stale under EXACTLY the same condition — the tuple a verdict
 * is keyed on moved. Carrying them separately would be two homes for one rule, and the drift would be silent:
 * a line could keep the gill it was restated from while losing the transcription that printed it, and the gate
 * would then be asked about a pair no source ever contained.
 */
export interface CarriedTranscription {
    /** The raw source line inherited, or `undefined`. */
    readonly sourceLine: string | undefined;
    /** The measure the source PRINTED, inherited, or `undefined` when the line was never restated. */
    readonly statedMeasure: StatedMeasure | undefined;
    /**
     * The ingredient PHRASE the parse lifted out of the line — the memo tier's key grain (migration 0041,
     * owner ruling 2026-08-31) — inherited, or `undefined` when the line predates the field or was authored.
     */
    readonly sourcePhrase: string | undefined;
}

/** One PERSISTED line, reduced to the facts a verdict about it would be keyed on, plus what it transcribed. */
export interface StoredTranscription {
    /** The catalog ingredient this line points at. */
    readonly ingredientId: string;
    /** What the line stated — one value, two bounds, or nothing. */
    readonly quantity: IngredientQuantity;
    /** The line's unit; `''` for a unitless line, matching the column's own representation. */
    readonly unit: string;
    /** The raw source line held for it, or `undefined` when the stored line was authored rather than transcribed. */
    readonly sourceLine: string | undefined;
    /**
     * What the source PRINTED, when {@link quantity}/{@link unit} are a RESTATEMENT of it (migration 0027).
     *
     * ⚠️ It is in the verification KEY but deliberately NOT in the match tuple below, and that is not an
     * inconsistency. The tuple is what an INCOMING line can assert; a create-only fact cannot be matched on,
     * only carried. `sourceLine` sits in exactly the same position, which is why this module derives the tuple
     * as "digest membership MINUS the line itself" rather than as the whole digest.
     */
    readonly statedMeasure: StatedMeasure | undefined;
    /** The parsed phrase held for it, or `undefined`. In the bundle, not the tuple, like its two siblings. */
    readonly sourcePhrase: string | undefined;
}

/** One INCOMING line, reduced to the same facts. Deliberately a subset of `ResolvedIngredientLine`. */
export interface IncomingLineIdentity {
    readonly ingredientId: string;
    readonly quantity: IngredientQuantity;
    readonly unit: string;
}

/**
 * Whether a stored line and an incoming line are the same judgement. Pure.
 *
 * ⛔ `quantitiesEqual`, never `===`: `IngredientQuantity` is a VALUE OBJECT, so reference equality would make
 * every line a mismatch and drop every transcription on every save — the same reason `ingredientsChanged`
 * reaches for it rather than comparing references.
 *
 * @param stored - The persisted line's identity facts.
 * @param incoming - The incoming line's identity facts.
 * @returns `true` when a verdict about one would be a verdict about the other.
 */
function sameJudgement(stored: StoredTranscription, incoming: IncomingLineIdentity): boolean {
    return (
        stored.ingredientId === incoming.ingredientId &&
        stored.unit === incoming.unit &&
        quantitiesEqual(stored.quantity, incoming.quantity)
    );
}

/**
 * Decide what, if anything, each incoming ingredient line inherits from the version of itself already stored.
 *
 * TOTAL: returns exactly one entry per incoming line, in the caller's order, so the caller indexes it
 * positionally and cannot silently receive a short array.
 *
 * ⛔ A MULTISET, consumed in stored order — not a `Map` keyed on the tuple. Two lines of one recipe may
 * legitimately share an identity, quantity and unit ("2 cups flour" for the sponge and again for the dough),
 * and a map would hand BOTH incoming lines the same stored transcription — duplicating one author's words
 * onto a line they never wrote, which is the corruption this policy exists to prevent, arriving by a
 * different door.
 *
 * @param stored - The recipe's currently persisted lines, in any order.
 * @param incoming - The lines the update will persist, in their final order.
 * @returns What each incoming line inherits — both members `undefined` when it inherits nothing. Pure;
 *   neither argument is mutated.
 */
export function carryForwardTranscription(
    stored: readonly StoredTranscription[],
    incoming: readonly IncomingLineIdentity[],
): readonly CarriedTranscription[] {
    // A local claim ledger rather than a mutated input: purity is the property this module is bought for.
    const claimed = new Array<boolean>(stored.length).fill(false);

    return incoming.map((line) => {
        const match = stored.findIndex(
            (candidate, index) =>
                !claimed[index] && candidate.sourceLine !== undefined && sameJudgement(candidate, line),
        );

        if (match === -1) {
            return { sourceLine: undefined, statedMeasure: undefined, sourcePhrase: undefined };
        }

        claimed[match] = true;

        // ⛔ ALL members from the SAME matched line, or none. A stated measure kept beside an amount the
        // author has since edited would claim the source printed a gill for a quantity it never printed —
        // a restatement whose two halves describe different lines, which is worse than no restatement. The
        // phrase rides the same rule: a memo key detached from the line it was lifted from is the cross-user
        // poisoning shape the create-only wire exists to prevent.
        return {
            sourceLine: stored[match]?.sourceLine,
            statedMeasure: stored[match]?.statedMeasure,
            sourcePhrase: stored[match]?.sourcePhrase,
        };
    });
}
