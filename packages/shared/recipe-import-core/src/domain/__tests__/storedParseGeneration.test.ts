/**
 * ⛔ THE STORED PAYLOAD'S SHAPE AND THE CACHE GENERATION MOVE TOGETHER, OR NOT AT ALL.
 *
 * `PARSE_KEY_VERSION`'s own ruling (`recipe-core`'s `parseKey.ts`) is unconditional: bump it "WHENEVER THE
 * STORED PAYLOAD'S SHAPE CHANGES … Add a fact to that contract without bumping here and every stored row
 * silently becomes a MISS — both engines re-invoked for every line, and the only symptom is a bill."
 *
 * ## Why a guard, when the rule is written down
 *
 * A written rule does not stop an edit that misses it. A member added to {@link storedParseSchema} stops this
 * file compiling, which sends the editor to the rule.
 *
 * ⛔ And the harm is worse than the ruling's general case. `parsePorts.ts` writes the cache
 * `ON CONFLICT (parse_key) DO NOTHING`, so a stale-generation row is not a one-time miss that repairs
 * itself: the re-parse computes the same key, the fresh payload is DISCARDED, and both engines are paid
 * again on the next submission, indefinitely. Nothing errors, nothing logs, and the symptom is a bill.
 *
 * ## Why this pins a list by hand, when a hand-kept roster is normally the defect
 *
 * ⚠️ The distinction is whether the list must be maintained to stay TRUE, or fails loudly when it stops
 * being true. A roster of files or consumers rots silently as the world moves around it — that is the shape
 * this repo has been bitten by (a NAT consumer list, a flow-selector list). This list is a **tripwire**: it
 * cannot drift, because the moment `StoredParse` gains or loses a member the type assertion below stops
 * compiling. It is not describing the world; it is refusing to let the world change unnoticed.
 *
 * ⛔ So the required action when this test fails is NOT to update the list. It is to decide whether the
 * cache generation must move — and it almost always must — and then update both together.
 */
import { describe, expect, it } from 'vitest';

import { PARSE_KEY_VERSION } from '@kitchensink/recipe-core/parsing/parse-key';

import { storedParseSchema, type StoredParse } from '../storedParseFacts.js';

/** True only when `A` and `B` are the same type — invariant, so a wider or narrower member fails. */
type Exact<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/**
 * Every member of the stored payload, as of {@link PARSE_KEY_VERSION}.
 *
 * ⛔ Changing this list without changing the generation below is the defect this file exists to stop.
 */
type PinnedMembers = 'statedMeasure' | 'quantity' | 'unit' | 'foods' | 'reviewReasons';

/** The generation the list above belongs to. Moves with it, in the same edit. */
const PINNED_GENERATION = 'v2';

describe('the stored parse payload and the cache generation', () => {
    /**
     * ⛔ A COMPILE-TIME assertion, deliberately. A runtime key read would need a cast — `storedParseSchema`
     * is annotated `z.ZodType<StoredParse>`, which hides `.shape` — and a cast is exactly the escape hatch
     * that lets a shape change through. The type is the authority here.
     */
    it('⛔ pins every member of StoredParse, so a new fact cannot be added silently', () => {
        const membersAreUnchanged: Exact<keyof StoredParse, PinnedMembers> = true;

        expect(membersAreUnchanged).toBe(true);
    });

    /**
     * Ties the list to the generation it was written for: moving `PARSE_KEY_VERSION` fails here until this file
     * is revisited. ⚠️ It cannot catch the list being updated WITHOUT a bump. That direction rests on the first
     * test sending the editor here, and on this file's header.
     */
    it('⛔ refuses a payload change that did not move the cache generation', () => {
        expect(PARSE_KEY_VERSION).toBe(PINNED_GENERATION);
    });

    /**
     * ⚠️ The positive control. Without it the two assertions above could both pass against a schema that
     * rejects everything, and the file would prove nothing. A payload carrying every pinned member parses;
     * one carrying an extra key is REFUSED, which is the `strictObject` behaviour the generation rule
     * depends on — a permissive read would serve an incomplete parse as a complete one.
     */
    it('parses a complete payload and refuses an extra key', () => {
        const complete = {
            statedMeasure: '2 cups',
            quantity: { kind: 'exact', value: 2 },
            unit: 'cup',
            foods: [{ name: 'flour', prep: null }],
            reviewReasons: [],
        };

        expect(storedParseSchema.safeParse(complete).success).toBe(true);
        expect(storedParseSchema.safeParse({ ...complete, raw: '2 cups flour' }).success).toBe(false);
    });
});
