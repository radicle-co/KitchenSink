/**
 * ⛔ ADR-0024 LAYER 0 AS A TRUTH TABLE — "the cheapest control in the stack is the message that is never
 * sent". Written BEFORE {@link buildVerificationRequests} (TDD red → green).
 *
 * Every case here is a line that costs money if the rule is too eager, or a line that silently goes
 * unverified if it is too shy. The four properties this file exists to pin:
 *
 *  1. **A line with no source text is never sent.** `decideVerification` returns `skip: 'no-source-text'` for
 *     it, and an authored line has no source for our parse to disagree with. This is the dominant filter:
 *     every hand-entered recipe in the system is made entirely of these.
 *  2. **A line with no `foodId` is never sent.** A user-entered ingredient carries its own nutrition and has
 *     no catalog identity to check. The message's `foodId` is `min(1)`, so such a message could not even
 *     validate — it would be poison, and poison drains to a DLQ holding a cook's recipe text.
 *  3. **An over-cap line is REJECTED, never truncated** (ADR-0024 §2). A truncated line asks the model to
 *     judge text the user did not write, and that verdict gates whether nutrition publishes.
 *  4. **A judgement already on record is not re-requested.** `RecipeIngredientsDal.replaceForRecipe` deletes
 *     and re-inserts EVERY line on EVERY save, so without this a one-word title edit re-pays for the whole
 *     recipe. The comparison uses `verificationKeyPreimage` — the SAME canonical serialization the verdict
 *     table is keyed on — so "unchanged" here and "already stored" there cannot drift into two answers.
 *
 * ⚠️ And the mutation lens on the quantity projection: `quantityHigh` must be `null` for an EXACT quantity
 * rather than a repeat of the value. `verificationKey` distinguishes the two, so getting it wrong both
 * re-partitions the verdict table and asks the model about a range the line never stated.
 */
import { describe, expect, it } from 'vitest';

import { ABSENT_QUANTITY, statedQuantity, type IngredientQuantity } from '@kitchensink/recipe-core';
import { PROVISIONAL_VERIFICATION_THRESHOLDS } from '@kitchensink/recipe-core/resolution/verification-gate-policy';
import {
    verifyIngredientLineMessageSchema,
    type VerifyIngredientLineMessage,
} from '@kitchensink/recipe-core/resolution/verification-message';

import { buildVerificationRequests, type VerifiableLine } from '../verificationRequests.js';

const RECIPE_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const REQUESTED_AT = '2026-08-22T10:00:00.000Z';

/** A stated amount, or a loud fixture failure — `statedQuantity` returns `null` for a non-amount. */
function amount(low: number, high?: number): IngredientQuantity {
    const quantity = statedQuantity(low, high ?? null);

    if (quantity === null) {
        throw new Error(`fixture bug: (${low}, ${String(high)}) is not a stated amount`);
    }

    return quantity;
}

const makeLine = (overrides: Partial<VerifiableLine> = {}): VerifiableLine => ({
    sourceLine: '2 cups all-purpose flour, sifted',
    foodId: '01JFOOD000000000000000000',
    candidateFoodName: 'Flour, wheat, all-purpose',
    quantity: amount(2),
    unit: 'cup',
    ...overrides,
});

/** The recipe's owner, carried onto every request so a remembered phrase stays erasable (0026). */
const OWNER_ID = '01JQ8N2X4RBV6WK3ZT5Y7A9C0P';

const plan = (
    lines: readonly VerifiableLine[],
    alreadyRequested: readonly VerifiableLine[] = [],
): ReturnType<typeof buildVerificationRequests> =>
    buildVerificationRequests({
        recipeId: RECIPE_ID,
        ownerId: OWNER_ID,
        lines,
        alreadyRequested,
        thresholds: PROVISIONAL_VERIFICATION_THRESHOLDS,
        requestedAt: REQUESTED_AT,
    });

/** Just the messages, for the many cases that are only about what reaches the queue. */
const build = (
    lines: readonly VerifiableLine[],
    alreadyRequested: readonly VerifiableLine[] = [],
): readonly VerifyIngredientLineMessage[] => plan(lines, alreadyRequested).requests;

describe('buildVerificationRequests — what reaches the queue at all (ADR-0024 layer 0)', () => {
    it('emits one message for a transcribed, catalog-backed line', () => {
        const requests = build([makeLine()]);

        expect(requests).toHaveLength(1);
        expect(requests[0]?.recipeId).toBe(RECIPE_ID);
        expect(requests[0]?.foodId).toBe('01JFOOD000000000000000000');
        expect(requests[0]?.candidateFoodName).toBe('Flour, wheat, all-purpose');
        expect(requests[0]?.sourceLine).toBe('2 cups all-purpose flour, sifted');
        expect(requests[0]?.requestedAt).toBe(REQUESTED_AT);
    });

    it('emits a message the CONSUMER can actually parse', () => {
        // ⛔ Producer and worker are in different packages and deploy separately. A message that does not
        // satisfy the consumer's schema is poison: it drains to a DLQ that holds a cook's recipe text for
        // three days and verifies nothing. This asserts the real schema, not a shape we hope matches it.
        const [request] = build([makeLine()]);

        expect(() => verifyIngredientLineMessageSchema.parse(request)).not.toThrow();
    });

    it('declares UNATTRIBUTED evidence and an empty shortlist — the only honest claim it can make', () => {
        // Nothing persists which cascade tier resolved the catalog row, so the producer cannot name one. It
        // must never claim `curated-exact`, which would suppress the identity check.
        const [request] = build([makeLine()]);

        expect(request?.evidenceKind).toBe('unattributed');
        expect(request?.shortlist).toEqual([]);
    });

    it('sends NOTHING for a line the cook authored rather than transcribed', () => {
        // The dominant case, and what keeps the bill at KTD-4's ~8,000 calls/month rather than one call per
        // ingredient line in the system.
        expect(build([makeLine({ sourceLine: undefined })])).toEqual([]);
    });

    it('sends NOTHING for a source line that is blank once invisible characters are discounted', () => {
        expect(build([makeLine({ sourceLine: '  ‍ ' })])).toEqual([]);
    });

    it('sends NOTHING for a user-entered ingredient, which has no catalog identity to check', () => {
        // ⛔ A message with no `foodId` cannot satisfy `min(1)`, so emitting one would be manufacturing
        // poison. The gate has nothing to say about a line whose nutrition the cook supplied themselves.
        expect(build([makeLine({ foodId: undefined })])).toEqual([]);
    });

    it('REJECTS an over-cap line rather than truncating it, and REPORTS the rejection', () => {
        const over = 'x'.repeat(PROVISIONAL_VERIFICATION_THRESHOLDS.maxSourceLineChars + 1);
        const outcome = plan([makeLine({ sourceLine: over })]);

        // ⛔ ADR-0024 §2. Not "sends a shortened line" — sends nothing.
        expect(outcome.requests).toEqual([]);
        // ⛔ AND NOT SILENTLY. `recipeRequestBounds.ts` says an over-cap line should be "surfaced for
        // correction"; the gate ships observe-only so there is no `unresolved` state to write yet, but
        // collapsing it into the authored case would make a line the system permanently gave up on invisible
        // in every log there is. It is reachable for a real cookbook line: the wire admits 1000 characters
        // and this cap is 400.
        expect(outcome.unasked).toEqual([
            { reason: 'over-cap', observedChars: PROVISIONAL_VERIFICATION_THRESHOLDS.maxSourceLineChars + 1 },
        ]);
    });

    it('tells an AUTHORED line apart from a USER-ENTERED one apart from a BLANK one', () => {
        // Three different facts about why nothing was asked, and the caller logs them differently. Collapsing
        // them into one "skipped" count is how the interesting one stops being noticeable.
        const outcome = plan([
            makeLine({ sourceLine: undefined }),
            makeLine({ foodId: undefined }),
            makeLine({ sourceLine: '  \u200d ' }),
        ]);

        expect(outcome.requests).toEqual([]);
        expect(outcome.unasked.map((entry) => entry.reason)).toEqual([
            'authored',
            'no-catalog-identity',
            'blank-source',
        ]);
    });

    it('sends a line sitting exactly ON the cap', () => {
        const at = 'x'.repeat(PROVISIONAL_VERIFICATION_THRESHOLDS.maxSourceLineChars);

        expect(build([makeLine({ sourceLine: at })])).toHaveLength(1);
    });

    it('keeps every distinct line of a multi-line recipe, in order', () => {
        const requests = build([
            makeLine(),
            makeLine({
                sourceLine: '1 tsp salt',
                foodId: '01JFOOD000000000000000001',
                candidateFoodName: 'Salt, table',
                quantity: amount(1),
                unit: 'tsp',
            }),
        ]);

        expect(requests.map((request) => request.sourceLine)).toEqual([
            '2 cups all-purpose flour, sifted',
            '1 tsp salt',
        ]);
    });

    it('returns nothing for a recipe with no ingredient lines', () => {
        expect(build([])).toEqual([]);
    });
});

describe('buildVerificationRequests — the quantity and unit projection', () => {
    it('reports an EXACT quantity as a low bound with a null high', () => {
        // ⛔ `null`, never a repeat of the value. `verificationKey` distinguishes them, so a repeat both
        // re-partitions the verdict table and asks the model about a range the line never stated.
        const [request] = build([makeLine({ quantity: amount(2) })]);

        expect(request?.quantityLow).toBe(2);
        expect(request?.quantityHigh).toBeNull();
    });

    it('reports a RANGE as both of its bounds', () => {
        const [request] = build([makeLine({ quantity: amount(2, 3) })]);

        expect(request?.quantityLow).toBe(2);
        expect(request?.quantityHigh).toBe(3);
    });

    it('reports an ABSENT quantity as null, never zero', () => {
        // R40: "butter the size of an egg" states no number — not none of something. `0` is a value the
        // parser found, and the question the model is asked depends on telling the two apart.
        const [request] = build([makeLine({ quantity: ABSENT_QUANTITY })]);

        expect(request?.quantityLow).toBeNull();
        expect(request?.quantityHigh).toBeNull();
    });

    it('reports an empty unit as null, never as an empty string', () => {
        // The DAL stores `''` for "no unit" because the column is not null; the wire contract says `null`
        // means "the parser found none", and `''` would be a unit whose name is the empty string.
        const [request] = build([makeLine({ unit: '' })]);

        expect(request?.unit).toBeNull();
    });

    it('reports a stated unit unchanged', () => {
        expect(build([makeLine({ unit: 'cup' })])[0]?.unit).toBe('cup');
    });
});

describe('buildVerificationRequests — a judgement already on record is not re-requested', () => {
    it('sends nothing when the line is identical to one already requested', () => {
        // ⛔ THE COST DEFECT THIS GUARDS. `replaceForRecipe` deletes and re-inserts EVERY ingredient row on
        // EVERY save, so a one-word title edit would otherwise re-pay for every line in the recipe.
        expect(build([makeLine()], [makeLine()])).toEqual([]);
    });

    it('sends the line again when its QUANTITY changed', () => {
        expect(build([makeLine({ quantity: amount(3) })], [makeLine({ quantity: amount(2) })])).toHaveLength(1);
    });

    it('sends the line again when its UNIT changed', () => {
        expect(build([makeLine({ unit: 'tbsp' })], [makeLine({ unit: 'cup' })])).toHaveLength(1);
    });

    it('sends the line again when it was re-pointed at a different food', () => {
        expect(build([makeLine({ foodId: 'FOOD-B' })], [makeLine({ foodId: 'FOOD-A' })])).toHaveLength(1);
    });

    it('sends the line again when the source text changed', () => {
        expect(
            build([makeLine({ sourceLine: '3 cups flour' })], [makeLine({ sourceLine: '2 cups flour' })]),
        ).toHaveLength(1);
    });

    it('treats a whitespace-only difference in the source line as the SAME judgement', () => {
        // `verificationKeyPreimage` collapses whitespace and normalizes to NFC, so re-indenting a line is not
        // a new question. Deferring to that function rather than comparing locally is what keeps this true.
        expect(build([makeLine({ sourceLine: '2  cups   all-purpose flour, sifted' })], [makeLine()])).toEqual([]);
    });

    it('sends only ONE message when a recipe repeats the same line twice', () => {
        // Two identical lines are one question. Sending both pays twice for a verdict keyed on content, which
        // would collide on write anyway.
        expect(build([makeLine(), makeLine()])).toHaveLength(1);
    });

    it('ignores an already-requested line that is absent from the new set', () => {
        const removed = makeLine({ sourceLine: '1 tsp salt', foodId: 'FOOD-SALT' });

        expect(build([makeLine()], [removed])).toHaveLength(1);
    });

    it('does not let an unverifiable already-requested line suppress a real one', () => {
        // An authored line and a transcribed line are different judgements; a `null` source line must not
        // collapse into a key that matches something.
        expect(build([makeLine()], [makeLine({ sourceLine: undefined })])).toHaveLength(1);
    });
});

/**
 * ⛔ THE ONLY REASON `ownerId` EXISTS ON THIS MESSAGE (migration 0026, owner ruling 2026-08-23).
 *
 * The worker remembers an agreed phrase in `ingredient_resolution_memos`, and that phrase is text a user
 * typed. This producer is the only participant that knows whose recipe the line came from, so a request built
 * without the owner produces a memo account erasure cannot reach. The field is REQUIRED on this input for
 * exactly that reason, even though it is optional on the wire — the wire's optionality is for messages
 * already sitting in the queue, not for new ones.
 */
describe('buildVerificationRequests — the owner travels with every request (0026)', () => {
    it('stamps the owner on each request it builds', () => {
        const { requests } = plan([
            makeLine(),
            makeLine({ sourceLine: '1 tsp salt', foodId: '01JFOOD000000000000000002' }),
        ]);

        expect(requests.length).toBeGreaterThan(0);

        for (const request of requests) {
            expect(request.ownerId).toBe(OWNER_ID);
        }
    });
});
