/**
 * The PARSE specialization of the correction-scope rule (plan U21 / KTD-14, KTD-15).
 *
 * DESIGN PATTERN: **Adapter over a Specification module.** It binds `correctionScopePolicy.ts`'s subject
 * parameters to this subject — the answer's identity, and the grant that buys global reach — and contributes
 * no rule of its own. The sibling on the other side of that rule is `mappingScopePolicy.ts`.
 *
 * ## What a parse correction is, and why its reach is an authorization question
 *
 * A correction says "the line `2 cups plain flour, sifted` parses to THESE facts", and it is the parse
 * pipeline's TOP tier — consulted ahead of the parse cache and ahead of both engines, because a correction
 * that lost to a cached machine parse would be a correction that does nothing. At `global` scope that
 * sentence is asserted for EVERY user of the installation, on every future occurrence of the line, with no
 * further review. Reach is therefore a privilege rather than a preference, and the thing authorized is a
 * FIELD VALUE (`scope`) rather than a route — so it is decided here and NOT in a route Guard (ADR-0023),
 * which would gate a surface that must stay open to every authenticated cook.
 *
 * ## ⛔ WHY THIS GRANT IS ITS OWN, AND NOT `CURATOR_MAPPING_SCOPE`
 *
 * The scope RULE is shared knowledge; the AUTHORITY is not. `recipes:mappings:global` was published to
 * authorize a curated ingredient mapping. Admitting it here would silently widen it, so that everyone holding
 * it also owned how every cook's line READS across the installation — a privilege escalation delivered by a
 * refactor, with nothing failing. A separate identifier makes the two decisions separate, and
 * `__tests__/parseCorrectionPolicy.test.ts` asserts the mapping grant does NOT reach this subject.
 *
 * ## ⛔ WHY THE GRANT IS DECLARED HERE AND NOT ON THE WIRE CONTRACT
 *
 * `CURATOR_MAPPING_SCOPE` lives on `ingredients.schema.ts` **because U14 published a route carrying it**,
 * and that module's own note records that it was sited in the policy until then. U21 publishes no route — the
 * parse-correction surface is a later unit — and moving a constant into a `*.schema.ts` moves the service's
 * `CONTRACT_HASH`, lighting up skew warnings on every pinned client for a change with no wire projection. So
 * it starts here, exactly as the mapping grant did, and MOVES to the contract the day a route carries it.
 *
 * ## ⛔ THE ANSWER IS POSTGRES' CANONICAL `jsonb` RENDERING, supplied by the caller
 *
 * A parse's identity is the corrected facts, and comparing two of them needs a canonical form. That form is
 * NOT derived in TypeScript: `parseCorrections.dal.ts` projects `corrected_facts::text` for the stored rows
 * AND for the proposal in the same statement, so both come from the database's own canonicalizer. This module
 * therefore sees two opaque strings, and a second derivation — free to disagree with the unique indexes that
 * actually enforce identity, silently — never exists.
 */
import {
    evaluateCorrectionScope,
    type CorrectionScopeDecision,
    type CorrectionScopeInput,
} from './correctionScopePolicy.js';

/**
 * The grant that binds a parse correction GLOBALLY on first correction.
 *
 * ⛔ Deliberately NOT `CURATOR_MAPPING_SCOPE` — see the module docstring. Two subjects, two authorities.
 */
export const CURATOR_PARSE_SCOPE = 'recipes:parses:global';

/** The facts a parse-correction write decision is made from — the shared input minus the grant. */
export type ParseCorrectionWriteInput = Omit<CorrectionScopeInput, 'requiredGrant'>;

/**
 * Evaluate how far a cook's parse correction reaches and what it displaces. Pure — inputs only.
 *
 * @param input - The asserted parse (as PostgreSQL's canonical `jsonb` rendering), the caller's grants, and
 *   what the correction tier already holds for this line: the live global correction, the caller's own, and
 *   the other cooks who already assert the same parse.
 * @returns The write the caller will perform, or `write: 'none'` when the correction changes nothing.
 */
export function evaluateParseCorrectionWrite(input: ParseCorrectionWriteInput): CorrectionScopeDecision {
    return evaluateCorrectionScope({ ...input, requiredGrant: CURATOR_PARSE_SCOPE });
}
