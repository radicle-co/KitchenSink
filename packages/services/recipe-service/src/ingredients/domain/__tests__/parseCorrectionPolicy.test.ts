/**
 * The PARSE subject of the correction-scope rule (plan U21 / KTD-15).
 *
 * ## What this suite is for, and what it deliberately does NOT re-test
 *
 * KTD-15 rules that "how far does a correction reach, and what does it displace" is ONE piece of
 * knowledge with ONE representation, and that a parse differs from a phrase→`food_id` mapping only in
 * its SUBJECT. That rule's truth table already has an exhaustive suite —
 * `mappingScopePolicy.test.ts` — which now exercises the same `evaluateCorrectionScope` through the
 * mapping specialization. Restating those rows here would be a second copy of the knowledge, free to
 * drift and free to disagree.
 *
 * What this suite pins is everything the SUBSTITUTION could get wrong, which the shared suite cannot
 * see:
 *
 *  1. ⛔ **Grants are NOT interchangeable.** `recipes:mappings:global` buys global reach over a curated
 *     ingredient mapping. It must NOT buy global reach over a parse — that would silently widen a
 *     published grant's meaning, handing every mapping curator authority over how every cook's line
 *     reads. This is the single most valuable assertion in the file, because it is the failure the DRY
 *     move invites, and nothing else in the tree would catch it.
 *  2. **The specialization is wired to the shared rule at all** — a grant holder writes globally, an
 *     ungranted caller stays author-scoped, and a second independent cook promotes.
 *  3. **The answer is compared as an opaque string**, so the caller may hand it PostgreSQL's canonical
 *     `jsonb` rendering rather than a shape this module would have to know how to compare.
 */
import { describe, expect, it } from 'vitest';

import { CURATOR_MAPPING_SCOPE } from '../mappingScopePolicy.js';
import { CURATOR_PARSE_SCOPE, evaluateParseCorrectionWrite } from '../parseCorrectionPolicy.js';
import type { CorrectionScopeInput } from '../correctionScopePolicy.js';

/** The canonical rendering of the parse the caller is asserting. */
const CORRECTED = '{"foods": [{"name": "plain flour"}], "unit": "cup"}';

/** A different canonical rendering — a parse that disagrees. */
const OTHER = '{"foods": [{"name": "self-raising flour"}], "unit": "cup"}';

/** A live row id, used where the decision must name what it displaces. */
const OWN_ID = 'own-correction-row';

/** The subject-agnostic half of an input; every case overrides only what it is about. */
function input(
    overrides: Partial<Omit<CorrectionScopeInput, 'requiredGrant'>> = {},
): Omit<CorrectionScopeInput, 'requiredGrant'> {
    return {
        correctedAnswer: CORRECTED,
        grantedScopes: [],
        liveGlobal: undefined,
        liveOwn: undefined,
        corroboratorsForSameAnswer: [],
        ...overrides,
    };
}

describe('evaluateParseCorrectionWrite — grants are subject-specific', () => {
    it('⛔ the MAPPING grant does NOT buy global reach over a PARSE', () => {
        const decision = evaluateParseCorrectionWrite(input({ grantedScopes: [CURATOR_MAPPING_SCOPE] }));

        // `recipes:mappings:global` authorizes a curated ingredient mapping and nothing else. Accepting it
        // here would let every mapping curator rewrite how every cook's line PARSES, installation-wide,
        // on a grant nobody issued for that purpose.
        expect(decision.write).toBe('author');
    });

    it('the PARSE grant does not buy global reach over anything by accident either — the two differ', () => {
        // A single constant reused for both subjects would make the assertion above vacuous.
        expect(CURATOR_PARSE_SCOPE).not.toBe(CURATOR_MAPPING_SCOPE);
    });

    it('a holder of the parse grant writes GLOBALLY on first correction', () => {
        const decision = evaluateParseCorrectionWrite(input({ grantedScopes: [CURATOR_PARSE_SCOPE] }));

        expect(decision).toMatchObject({ write: 'global', scope: 'global', origin: 'curator' });
    });

    it('accepts the grant from either list — a `permissions` entry counts, mirroring ScopesGuard', () => {
        const decision = evaluateParseCorrectionWrite(input({ grantedScopes: ['unrelated', CURATOR_PARSE_SCOPE] }));

        expect(decision.write).toBe('global');
    });
});

describe('evaluateParseCorrectionWrite — an ungranted cook stays author-scoped until corroborated', () => {
    it('writes author-scoped with no promotion when nobody else agrees', () => {
        const decision = evaluateParseCorrectionWrite(input());

        expect(decision).toMatchObject({ write: 'author', scope: 'author', origin: 'author' });
        expect(decision.write === 'author' ? decision.promotion : 'unreachable').toBeUndefined();
    });

    it('earns a promotion citing the one other cook who already asserted this same parse', () => {
        const decision = evaluateParseCorrectionWrite(
            input({ corroboratorsForSameAnswer: [{ id: 'row-them', authorId: 'cook-b' }] }),
        );

        expect(decision.write === 'author' ? decision.promotion?.citesExisting : undefined).toBe('row-them');
    });

    it('retires only the cook’s OWN earlier correction, never anybody else’s', () => {
        const decision = evaluateParseCorrectionWrite(input({ liveOwn: { id: OWN_ID, answer: OTHER } }));

        expect(decision.write === 'author' ? decision.supersedes : undefined).toBe(OWN_ID);
    });
});

describe('evaluateParseCorrectionWrite — the answer is an opaque string', () => {
    it('treats an identical canonical rendering as already in force, and writes nothing', () => {
        // The caller hands this module PostgreSQL's `jsonb` rendering rather than an object, so "is this
        // the same parse?" is answered by the database's canonical form — not by a comparison this module
        // would have to own, and therefore could derive differently from the one the index enforces.
        const decision = evaluateParseCorrectionWrite(input({ liveOwn: { id: OWN_ID, answer: CORRECTED } }));

        expect(decision.write).toBe('none');
    });

    it('treats a different rendering as a real correction', () => {
        const decision = evaluateParseCorrectionWrite(input({ liveOwn: { id: OWN_ID, answer: OTHER } }));

        expect(decision.write).toBe('author');
    });
});
