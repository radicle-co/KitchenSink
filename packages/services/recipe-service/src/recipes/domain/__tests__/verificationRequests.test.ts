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

import { ABSENT_QUANTITY, statedQuantity, type IngredientQuantity, type StatedAmount } from '@kitchensink/recipe-core';
import { PROVISIONAL_VERIFICATION_THRESHOLDS } from '@kitchensink/recipe-core/resolution/verification-gate-policy';
import {
    verifyIngredientLineMessageSchema,
    type VerifyIngredientLineMessage,
} from '@kitchensink/recipe-core/resolution/verification-message';

import { bandKeyText } from '@kitchensink/recipe-core/resolution/band-authority-store';

import {
    buildVerificationRequests,
    type VerifiableLine,
    type VerificationRequestInput,
} from '../verificationRequests.js';

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

/** The same fixture, narrowed to the union a stated measure admits — it can never be `absent`. */
function statedAmount(low: number, high?: number): StatedAmount {
    const quantity = amount(low, high);

    if (quantity.kind === 'absent') {
        throw new Error('fixture bug: a stated amount is never absent');
    }

    return quantity;
}

const makeLine = (overrides: Partial<VerifiableLine> = {}): VerifiableLine => ({
    sourceLine: '2 cups all-purpose flour, sifted',
    foodId: '01JFOOD000000000000000000',
    candidateFoodName: 'Flour, wheat, all-purpose',
    quantity: amount(2),
    unit: 'cup',
    statedMeasure: undefined,
    resolution: undefined,
    ...overrides,
});

/** A latest-resolution event for a tier, ranked fields defaulted off. */
const resolutionOf = (
    tier: 'curated' | 'lexical' | 'memo' | 'llm',
    overrides: Partial<NonNullable<VerifiableLine['resolution']>> = {},
): NonNullable<VerifiableLine['resolution']> => ({
    tier,
    rung: null,
    margin: null,
    shortlist: null,
    queryShape: null,
    rankerVersion: null,
    bandEpoch: null,
    ...overrides,
});

/** A lexical event whose stored shortlist satisfies the wire schema, wide margin, agreeing nutrients. */
const RANKED_SHORTLIST = [
    // All four macros on every candidate: an absent macro reads as UNKNOWN agreement, which (correctly)
    // keeps D4a's second conjunct unsatisfied — these fixtures probe the AUTHORITY conjunct.
    {
        foodId: '01JFOOD000000000000000000',
        score: 0.9,
        energyKcalPer100g: 364,
        proteinGPer100g: 10,
        fatGPer100g: 1,
        carbohydrateGPer100g: 76,
    },
    {
        foodId: '01JFOOD000000000000000001',
        score: 0.2,
        energyKcalPer100g: 364,
        proteinGPer100g: 10,
        fatGPer100g: 1,
        carbohydrateGPer100g: 76,
    },
];
const lexicalResolution = (overrides: Partial<NonNullable<VerifiableLine['resolution']>> = {}) =>
    resolutionOf('lexical', {
        rung: 'head',
        margin: 0.7,
        shortlist: RANKED_SHORTLIST,
        queryShape: 'single-token',
        rankerVersion: 'ladder-v2-comma-head',
        bandEpoch: null,
        ...overrides,
    });

describe('resolution provenance reaches the gate as evidence (plan U2)', () => {
    // ⛔ Before U2 every line enqueued `unattributedEvidence()` — the cascade kept only the foodId and no
    // column recorded which tier answered, so a curated hit paid for an identity check its tier had already
    // established. The producer now maps the persisted resolution tier onto the evidence the policy reads.
    it('a curated resolution sends curated-exact evidence, and the identity aspect is excused', () => {
        const { requests } = plan([makeLine({ resolution: resolutionOf('curated') })]);

        expect(requests).toHaveLength(1);
        expect(requests[0]?.evidenceKind).toBe('curated-exact');
    });

    it('a memo resolution sends remembered evidence, which establishes nothing on its own', () => {
        const { requests } = plan([makeLine({ resolution: resolutionOf('memo') })]);

        expect(requests[0]?.evidenceKind).toBe('remembered');
    });

    it('a line with no recorded resolution stays unattributed — absence is not evidence', () => {
        const { requests } = plan([makeLine({ resolution: undefined })]);

        expect(requests[0]?.evidenceKind).toBe('unattributed');
    });

    it('a lexical resolution with a VALID stored shortlist sends ranked evidence — and the shortlist', () => {
        // ⚠️ REWRITTEN in U4 (this was "stays unattributed UNTIL the tier ships shortlists" — the tier now
        // ships them). The stored jsonb is zod-validated at this boundary; only a shape the wire schema
        // accepts may claim `ranked`.
        const { requests } = plan([makeLine({ resolution: lexicalResolution() })]);

        expect(requests[0]?.evidenceKind).toBe('ranked');
        expect(requests[0]?.shortlist).toEqual(RANKED_SHORTLIST);
    });

    it('⛔ a lexical resolution whose stored shortlist does not parse stays unattributed', () => {
        const { requests } = plan([makeLine({ resolution: lexicalResolution({ shortlist: [{ mangled: true }] }) })]);

        expect(requests[0]?.evidenceKind).toBe('unattributed');
        expect(requests[0]?.shortlist).toEqual([]);
    });
});

const plan = (
    lines: readonly VerifiableLine[],
    alreadyRequested: readonly VerifiableLine[] = [],
    bands: VerificationRequestInput['bands'] = new Map(),
): ReturnType<typeof buildVerificationRequests> =>
    buildVerificationRequests({
        recipeId: RECIPE_ID,
        lines,
        alreadyRequested,
        thresholds: PROVISIONAL_VERIFICATION_THRESHOLDS,
        requestedAt: REQUESTED_AT,
        bands,
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
    it('⛔ puts NO person on the wire — a request carries a recipe id and nothing that names a user', () => {
        // ⚠️ REWRITTEN for the 2026-08-25 owner ruling (ADR-0027). This asserted `request.ownerId ===
        // OWNER_ID`; that field existed solely so a phrase the worker remembered could later be erased, and
        // migration 0033 removed both the memo's person column and the sweep, leaving it with no consumer.
        // The INVERSE is now the property worth pinning, and it is the stronger one: this producer's messages
        // sit in a DLQ carrying a cook's recipe text, so every field that names a person is one the DLQ then
        // holds. Re-adding one must fail here rather than pass unnoticed.
        const { requests } = plan([
            makeLine(),
            makeLine({ sourceLine: '1 tsp salt', foodId: '01JFOOD000000000000000002' }),
        ]);

        expect(requests.length).toBeGreaterThan(0);

        for (const request of requests) {
            expect(Object.keys(request)).not.toContain('ownerId');
            expect(Object.keys(request)).not.toContain('userId');
            expect(Object.keys(request)).not.toContain('authorId');
        }
    });
});

/**
 * U7/U11 — the pair the SOURCE printed travels with the request, so the model is asked the right question.
 *
 * ⛔ THE DEFECT THESE ASSERTIONS PIN. The importer restates a historical measure at parse time, so
 * `one gill of milk` persists as `quantity 0.5, unit 'cup'` — and this producer builds the message's
 * `quantityLow`/`unit` from the PERSISTED row. The model was therefore shown `one gill of milk` beside
 * `0.5 cup` and asked whether they agree. They do not, and it is RIGHT to say so about a line we parsed
 * correctly. U11 ranks a wrong DISAGREE as the unacceptable direction, because it withholds nutrition from a
 * correct line while a wrong AGREE only passes data that would have shipped anyway.
 */
describe('buildVerificationRequests — what the SOURCE printed travels with the request', () => {
    const GILL = { quantity: statedAmount(1), unit: 'gill' } as const;

    /** A line the importer restated: the source printed `one gill`, we persisted `0.5 cup`. */
    const restatedLine = (overrides: Partial<VerifiableLine> = {}): VerifiableLine =>
        makeLine({
            sourceLine: 'one gill of milk',
            candidateFoodName: 'Milk, whole',
            quantity: amount(0.5),
            unit: 'cup',
            statedMeasure: GILL,
            ...overrides,
        });

    it('carries the stated measure onto the message', () => {
        const { requests } = plan([restatedLine()]);

        expect(requests[0]?.statedMeasure).toEqual({ quantityLow: 1, quantityHigh: null, unit: 'gill' });
    });

    // ⛔ BESIDE the restated pair, never instead of it. The restated pair is what nutrition is computed from
    // and what U14's reader holds in hand, so it must keep keying the row; the stated pair is what the model
    // is asked about. Dropping either half breaks a different half of the system.
    it('still carries the RESTATED pair, which is what the row is keyed on', () => {
        const { requests } = plan([restatedLine()]);

        expect(requests[0]).toMatchObject({ quantityLow: 0.5, quantityHigh: null, unit: 'cup' });
    });

    it('carries both stated bounds when the source printed a range', () => {
        const { requests } = plan([
            restatedLine({
                sourceLine: 'one to two gills of milk',
                quantity: { kind: 'range', low: 0.5, high: 1 },
                statedMeasure: { quantity: statedAmount(1, 2), unit: 'gill' },
            }),
        ]);

        expect(requests[0]?.statedMeasure).toEqual({ quantityLow: 1, quantityHigh: 2, unit: 'gill' });
    });

    // The dominant case: nothing was restated, so nothing is claimed. Its ABSENCE is the disclosure, exactly
    // as `RecipeNutrition.rangeDerivedBound`'s is — there is no "not applicable" value.
    it('omits the member entirely for a line that was never restated', () => {
        const { requests } = plan([makeLine()]);

        expect(requests[0]?.statedMeasure).toBeUndefined();
    });

    /**
     * ⛔ THE DEDUP KEY MOVES WITH IT, and this is the assertion that makes the `v2` key bump real.
     *
     * A restated line and an un-restated one can agree on every other member of the judgement — the corpus
     * imported before migration 0027 and re-imported after it produce exactly that pair. They are shown
     * DIFFERENT numbers and reach DIFFERENT verdicts, so if they shared an identity the second would be
     * suppressed as "already requested" and would inherit the first's answer: the pre-0027 false DISAGREE,
     * served to the corrected line forever, because absence of a verdict is the only thing that publishes.
     */
    it('does NOT suppress a restated line as a duplicate of its un-restated self', () => {
        const { requests } = plan([restatedLine()], [restatedLine({ statedMeasure: undefined })]);

        expect(requests).toHaveLength(1);
        expect(requests[0]?.statedMeasure).toEqual({ quantityLow: 1, quantityHigh: null, unit: 'gill' });
    });

    it('DOES suppress a genuinely identical restated line', () => {
        const { requests } = plan([restatedLine()], [restatedLine()]);

        expect(requests).toHaveLength(0);
    });

    // Two lines of one recipe restated from DIFFERENT source measures are different judgements, so both are
    // asked about — the within-save dedup must not collapse them onto the restated pair alone.
    it('asks about two lines that share a restated pair but not a stated one', () => {
        const { requests } = plan([
            restatedLine(),
            restatedLine({ statedMeasure: { quantity: statedAmount(1), unit: 'wineglass' } }),
        ]);

        expect(requests).toHaveLength(2);
    });
});

describe('band consultation — earned autonomy at the producer (plan U4b, KTD-A)', () => {
    const KEY = bandKeyText({
        rung: 'head',
        marginBand: '0.15+',
        queryShape: 'single-token',
        rankerVersion: 'ladder-v2-comma-head',
    });
    const authorized = { authority: { state: 'authorized', epoch: 2 } as const, shadow: false };

    it('day one — no consultation entries — every ranked line asks identity and nothing is skipped', () => {
        const { requests, bandSkips } = plan([makeLine({ resolution: lexicalResolution() })]);

        expect(requests).toHaveLength(1);
        expect(requests[0]?.shadowSample).toBeUndefined();
        expect(bandSkips).toEqual([]);
    });

    it('an AUTHORIZED band with the floors met records a skip carrying the READY message and its epoch', () => {
        const { requests, bandSkips } = plan(
            [makeLine({ resolution: lexicalResolution() })],
            [],
            new Map([[KEY, authorized]]),
        );

        // The message is STILL SENT — quantity is never skippable; the skip row is the audit that identity
        // settlement was granted, and the drain re-sends this exact message if the band is ever revoked.
        expect(requests).toHaveLength(1);
        expect(bandSkips).toHaveLength(1);
        expect(bandSkips[0]?.epoch).toBe(2);
        expect(bandSkips[0]?.message).toEqual(requests[0]);
    });

    it('a SHADOW-sampled line asks identity anyway, is flagged on the wire, and records NO skip', () => {
        const { requests, bandSkips } = plan(
            [makeLine({ resolution: lexicalResolution() })],
            [],
            new Map([[KEY, { ...authorized, shadow: true }]]),
        );

        expect(requests[0]?.shadowSample).toBe(true);
        expect(bandSkips).toEqual([]);
    });

    it('⛔ an authorized band whose line fails the FLOORS records no skip — authority is not a bypass', () => {
        // A singleton shortlist: no margin, so D4a's first conjunct fails whatever the band says.
        const singleton = lexicalResolution({ shortlist: [RANKED_SHORTLIST[0]], margin: null });
        const { bandSkips } = plan([makeLine({ resolution: singleton })], [], new Map([[KEY, authorized]]));

        expect(bandSkips).toEqual([]);
    });
});
