/**
 * Unit tests for the pure curated-mapping scope policy (plan U10 / R19, R20 — ADR-0023's authorization shape).
 *
 * TRUTH-TABLE SHAPED, as the plan's verification line requires. The axes are **grants × what the knowledge
 * base already holds** — NOT grants × a declared scope, because nothing on the wire can declare one (U10
 * ships no route; see the module docstring). Every cell of
 * `{holder, non-holder} × {no global, global agrees, global disagrees-curator, global disagrees-corroboration}
 *  × {own mapping absent, agrees, disagrees} × {corroborator absent, present}` is reachable from the rows
 * below, and the four that carry the security argument are asserted individually:
 *
 *  1. **An ungranted caller NEVER supersedes a live global mapping alone.** Without this, R20's "a later
 *     correction supersedes an earlier mapping" hands any authenticated user a one-step path to overwrite a
 *     curator's mapping through the EDIT path — the exact escalation the grant exists to prevent, reached by
 *     editing rather than by writing.
 *  2. **A corroboration pair may NOT supersede a CURATOR's global mapping.** Two accounts held by one person
 *     clear a distinct-user check, so without this rule the grant is decorative: sock puppets override a
 *     curator by the corroboration path instead of the edit path. ⚠️ This NARROWS the plan's sentence "a
 *     global mapping may be superseded by a grant holder **or by a fresh independent-corroboration pair**",
 *     and the narrowing is flagged for the owner rather than assumed.
 *  3. **Promotion requires a SECOND, DISTINCT author.** `corroboratorsForSameFood` is the set of OTHER
 *     authors, so a mutant counting the caller's own row would make one account a curator.
 *  4. **A repeat correction that changes nothing writes nothing.** Otherwise every re-open of a corrected
 *     line mints a churn row, and the corroboration count it feeds becomes a count of visits.
 */
import { describe, expect, it } from 'vitest';

import {
    CURATOR_MAPPING_SCOPE,
    evaluateMappingWrite,
    type MappingWriteDecision,
    type MappingWriteInput,
} from '../mappingScopePolicy.js';

const CORRECTED_FOOD = '01JU10FOOD0000000000000FLOUR';
const OTHER_FOOD = '01JU10FOOD00000000000CAROB';
const GLOBAL_ID = '11111111-1111-4111-8111-111111111111';
const OWN_ID = '22222222-2222-4222-8222-222222222222';
const CORROBORATOR_ID = '33333333-3333-4333-8333-333333333333';
const AUTHOR_B = '01JU10AUTHOR000000000000BB';

/** Build a policy input with the no-history, no-grant defaults every row overrides one axis of. */
function input(overrides: Partial<MappingWriteInput> = {}): MappingWriteInput {
    return {
        correctedFoodId: CORRECTED_FOOD,
        grantedScopes: [],
        liveGlobal: undefined,
        liveOwn: undefined,
        corroboratorsForSameFood: [],
        ...overrides,
    };
}

/** A live global mapping in force, written by a grant holder. */
function curatorGlobal(foodId: string): MappingWriteInput['liveGlobal'] {
    return { id: GLOBAL_ID, foodId, origin: 'curator' };
}

/** A live global mapping in force, produced by two authors agreeing. */
function corroboratedGlobal(foodId: string): MappingWriteInput['liveGlobal'] {
    return { id: GLOBAL_ID, foodId, origin: 'corroboration' };
}

/** One other author already mapping this phrase to the same food. */
const ONE_CORROBORATOR = [{ id: CORROBORATOR_ID, userId: AUTHOR_B }] as const;

/**
 * Assert a decision's `write` AND that it carries a non-empty reason.
 *
 * The reason check kills the `reason -> ''` mutant: it is what a reviewer reads on a promotion audit line and
 * what a caller surfaces when nothing was written.
 */
function expectWrite(decision: MappingWriteDecision, write: MappingWriteDecision['write']): void {
    expect(decision.write).toBe(write);
    expect(decision.reason.length).toBeGreaterThan(0);
}

describe('evaluateMappingWrite — a grant holder writes GLOBALLY on first correction (owner ruling)', () => {
    it('writes a curator-origin global mapping with no history at all', () => {
        const decision = evaluateMappingWrite(input({ grantedScopes: [CURATOR_MAPPING_SCOPE] }));

        expectWrite(decision, 'global');
        expect(decision.write === 'global' && decision.origin).toBe('curator');
        expect(decision.write === 'global' && decision.supersedes).toBeUndefined();
    });

    it('SUPERSEDES a live global mapping that names a different food, whatever its origin', () => {
        for (const liveGlobal of [curatorGlobal(OTHER_FOOD), corroboratedGlobal(OTHER_FOOD)]) {
            const decision = evaluateMappingWrite(input({ grantedScopes: [CURATOR_MAPPING_SCOPE], liveGlobal }));

            expectWrite(decision, 'global');
            expect(decision.write === 'global' && decision.supersedes).toBe(GLOBAL_ID);
        }
    });

    it('writes NOTHING when the live global mapping already names the corrected food', () => {
        const decision = evaluateMappingWrite(
            input({ grantedScopes: [CURATOR_MAPPING_SCOPE], liveGlobal: curatorGlobal(CORRECTED_FOOD) }),
        );

        expectWrite(decision, 'none');
    });

    it('satisfies the grant from `permissions` as readily as from `scopes` (they arrive unioned)', () => {
        expectWrite(evaluateMappingWrite(input({ grantedScopes: ['unrelated', CURATOR_MAPPING_SCOPE] })), 'global');
    });

    it('is NOT satisfied by some other grant', () => {
        const decision = evaluateMappingWrite(input({ grantedScopes: ['admin:users', 'recipes:import:public'] }));

        expectWrite(decision, 'author');
    });
});

describe('evaluateMappingWrite — an ungranted caller stays AUTHOR-SCOPED until corroborated', () => {
    it('writes an author-scoped mapping on a first, uncorroborated correction', () => {
        const decision = evaluateMappingWrite(input());

        expectWrite(decision, 'author');
        expect(decision.write === 'author' && decision.origin).toBe('author');
        expect(decision.write === 'author' && decision.promotion).toBeUndefined();
    });

    it('SUPERSEDES the caller’s OWN earlier mapping when it named a different food (R20)', () => {
        const decision = evaluateMappingWrite(input({ liveOwn: { id: OWN_ID, foodId: OTHER_FOOD } }));

        expectWrite(decision, 'author');
        expect(decision.write === 'author' && decision.supersedes).toBe(OWN_ID);
    });

    it('writes NOTHING when the caller re-asserts their own live mapping unchanged', () => {
        // Without this, every re-open of a corrected line mints a churn row — and the corroboration count it
        // feeds would become a count of visits rather than a count of authors.
        expectWrite(evaluateMappingWrite(input({ liveOwn: { id: OWN_ID, foodId: CORRECTED_FOOD } })), 'none');
    });

    it('writes NOTHING when the live GLOBAL mapping already says what the caller is asserting', () => {
        expectWrite(evaluateMappingWrite(input({ liveGlobal: curatorGlobal(CORRECTED_FOOD) })), 'none');
    });

    it('PROMOTES once one other distinct author already agrees, citing that author’s mapping', () => {
        const decision = evaluateMappingWrite(input({ corroboratorsForSameFood: ONE_CORROBORATOR }));

        expectWrite(decision, 'author');
        expect(decision.write === 'author' && decision.promotion?.citesExisting).toBe(CORROBORATOR_ID);
        expect(decision.write === 'author' && decision.promotion?.supersedesGlobal).toBeUndefined();
    });

    it('does NOT promote when nobody else agrees — one author correcting twice cannot promote itself', () => {
        // The caller's own row is excluded upstream (`user_id <> :caller`), so "the same author corrected
        // twice" reaches the policy as an EMPTY set. A mutant counting the caller's own row makes one account
        // a curator.
        const decision = evaluateMappingWrite(input({ liveOwn: { id: OWN_ID, foodId: OTHER_FOOD } }));

        expect(decision.write === 'author' && decision.promotion).toBeUndefined();
    });

    it('cites the EARLIEST corroborator when several agree, so the binding is deterministic', () => {
        const decision = evaluateMappingWrite(
            input({
                corroboratorsForSameFood: [
                    { id: CORROBORATOR_ID, userId: AUTHOR_B },
                    { id: OWN_ID, userId: '01JU10AUTHOR000000000000CC' },
                ],
            }),
        );

        // The caller supplies them ordered `created_at, id`; the policy takes the head rather than re-sorting,
        // because ordering rows is the reader's job and re-deriving it here would be a second representation.
        expect(decision.write === 'author' && decision.promotion?.citesExisting).toBe(CORROBORATOR_ID);
    });
});

describe('evaluateMappingWrite — supersession is SCOPE-GATED (the two escalation paths)', () => {
    it('lets a corroboration pair supersede a global mapping that CAME FROM corroboration', () => {
        const decision = evaluateMappingWrite(
            input({ corroboratorsForSameFood: ONE_CORROBORATOR, liveGlobal: corroboratedGlobal(OTHER_FOOD) }),
        );

        expectWrite(decision, 'author');
        expect(decision.write === 'author' && decision.promotion?.supersedesGlobal).toBe(GLOBAL_ID);
    });

    it('⛔ does NOT let a corroboration pair supersede a CURATOR’s global mapping', () => {
        // Two accounts held by one person clear a distinct-user check. If corroboration could displace a
        // curator's deliberate ruling, the grant would be decorative — the escalation would simply move from
        // the edit path (already closed) to the corroboration path.
        const decision = evaluateMappingWrite(
            input({ corroboratorsForSameFood: ONE_CORROBORATOR, liveGlobal: curatorGlobal(OTHER_FOOD) }),
        );

        expectWrite(decision, 'author');
        expect(decision.write === 'author' && decision.promotion).toBeUndefined();
    });

    it('gives an ungranted caller NO path to displace a curator, across the whole ungranted half of the table', () => {
        for (const corroboratorsForSameFood of [[], ONE_CORROBORATOR]) {
            for (const liveOwn of [undefined, { id: OWN_ID, foodId: OTHER_FOOD }]) {
                const decision = evaluateMappingWrite(
                    input({ corroboratorsForSameFood, liveOwn, liveGlobal: curatorGlobal(OTHER_FOOD) }),
                );

                expect(decision.write).toBe('author');
                expect(decision.write === 'author' && decision.promotion).toBeUndefined();
            }
        }
    });

    it('never returns a `global` write for a caller without the grant, on ANY input', () => {
        // The security property, asserted over the product of every axis rather than one row apiece.
        for (const liveGlobal of [
            undefined,
            curatorGlobal(OTHER_FOOD),
            curatorGlobal(CORRECTED_FOOD),
            corroboratedGlobal(OTHER_FOOD),
            corroboratedGlobal(CORRECTED_FOOD),
        ]) {
            for (const liveOwn of [
                undefined,
                { id: OWN_ID, foodId: OTHER_FOOD },
                { id: OWN_ID, foodId: CORRECTED_FOOD },
            ]) {
                for (const corroboratorsForSameFood of [[], ONE_CORROBORATOR]) {
                    const decision = evaluateMappingWrite(input({ liveGlobal, liveOwn, corroboratorsForSameFood }));

                    // A promotion is still a global ROW, but it is written with `origin: 'corroboration'` and
                    // never as the caller's own `global` write — the distinction the audit trail rests on.
                    expect(decision.write).not.toBe('global');
                }
            }
        }
    });
});
