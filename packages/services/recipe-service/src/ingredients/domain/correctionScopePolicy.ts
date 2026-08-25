/**
 * The pure CORRECTION-SCOPE rule — how far a user's correction reaches, and what it displaces (KTD-15).
 *
 * DESIGN PATTERN: **Specification / Policy module**, with the SUBJECT as a parameter. It answers ONE
 * question from its inputs alone — no DB, no `Principal`, no I/O — and it answers it identically whether the
 * thing being corrected is an ingredient phrase's meaning or an ingredient line's parse. Two thin
 * specializations bind it to their subject: `mappingScopePolicy.ts` (a phrase → `food_id` mapping, plan U10)
 * and `parseCorrectionPolicy.ts` (a line's parse, plan U21).
 *
 * ## ⛔ WHY THIS MODULE EXISTS — and why it is NOT a premature generalisation
 *
 * KTD-15 states the finding this file is the shape of: *"The scope question is identical knowledge: a held
 * grant writes globally on first correction; every other correction stays author-scoped until a second
 * independent user corroborates it. That is one business rule, so it has one representation. What differs is
 * the SUBJECT — a parse rather than a phrase→`food_id` mapping — which is a parameter, not a second rule."*
 *
 * It is generalised from TWO REAL CALLERS, not from an anticipated one. That is the distinction Fowler draws
 * around YAGNI: this is not capability built for a presumptive feature, it is the removal of a duplicate of a
 * rule two subjects already need. The generalisation is also exactly two axes wide — the ANSWER's identity
 * and the GRANT that buys global reach — because those are the only two things that actually differed. It
 * takes no options, no flags, and no strategy object.
 *
 * ## ⛔ THE GRANT IS A PARAMETER, and that is a security property rather than a convenience
 *
 * The two subjects must NOT share a grant identifier. `recipes:mappings:global` authorizes a curated
 * ingredient mapping; admitting it here for a parse would silently widen a published grant so that every
 * mapping curator also owned how every cook's line READS, installation-wide, on an authority nobody issued
 * for that purpose. Passing the grant in is what keeps that a per-subject decision made at the specialization
 * — and it is asserted directly, in `parseCorrectionPolicy.test.ts`.
 *
 * ## ⛔ THE ANSWER IS AN OPAQUE STRING
 *
 * {@link CorrectionScopeInput.correctedAnswer} is whatever identity the subject uses for "the same answer":
 * a `food_id` for a mapping, PostgreSQL's canonical `jsonb` rendering of the corrected facts for a parse.
 * This module compares it with `===` and never interprets it. That is deliberate — a policy that knew how to
 * compare a parse would hold a SECOND derivation of an equality the database's unique indexes already
 * enforce, and the two would be free to disagree with nothing failing.
 *
 * ## ONE DIVERGENCE FROM ITS SIBLING POLICIES, STATED SO IT IS NOT READ AS PARITY
 *
 * `evaluateProvenance` (`recipes/domain/provenancePolicy.ts`) is pure AND stateless. This one is pure but NOT
 * stateless: its decision genuinely depends on what the knowledge base already holds, so the caller reads
 * those facts under a lock and passes them in. Purity is preserved (same inputs, same decision, every time);
 * statelessness is not available, because "may this displace what is in force?" has no answer without knowing
 * what is in force.
 *
 * ## ⛔ Why this is NOT a route Guard
 *
 * The reasoning ADR-0023 records for `evaluateProvenance`, now for the third time in this codebase. A
 * correction route must stay open to every authenticated user — a cook fixing their own line is the ordinary
 * case and the entire point of the learning loop. What is authorized is a FIELD VALUE (`scope`), not a route,
 * so gating the route would gate the wrong thing, and splitting the decision across two layers would put half
 * of it somewhere no truth table can reach.
 *
 * ## Collusion is answered by ENUMERABILITY, not by prevention
 *
 * A promotion is written as its own row citing BOTH corroborating rows, so every promotion is enumerable by
 * `SELECT`, durably. ADR-0023 records the same limit for its grant and the same answer: promotions are
 * reviewable after the fact. This policy does not claim to prevent collusion and must not be read as if it
 * did.
 */

/** The two reaches a correction can hold. `global` binds every user; `author` binds only its writer. */
export const CORRECTION_SCOPES = ['author', 'global'] as const;

/** How far a correction reaches. */
export type CorrectionScope = (typeof CORRECTION_SCOPES)[number];

/**
 * On whose authority a correction holds.
 *
 * Separate from {@link CorrectionScope} because `curator` and `corroboration` are the SAME reach arrived at
 * by DIFFERENT authority, and the supersession rule turns on which one it was: a pair may displace a pair,
 * but not a curator.
 */
export const CORRECTION_ORIGINS = ['author', 'curator', 'corroboration'] as const;

/** On whose authority a correction holds. */
export type CorrectionOrigin = (typeof CORRECTION_ORIGINS)[number];

/** The global correction currently in force for the subject being corrected. */
export interface LiveGlobalCorrection {
    /** Its row id — carried so a supersession decision can name exactly what it retires. */
    readonly id: string;
    /** The answer it asserts, in the subject's own identity form. */
    readonly answer: string;
    /** Whether a grant holder wrote it or two authors' agreement produced it. Never `author`. */
    readonly origin: Exclude<CorrectionOrigin, 'author'>;
}

/** One other author's live correction asserting the same answer. */
export interface CorroboratingCorrection {
    /** Its row id — cited by the promotion, which is what makes the promotion auditable. */
    readonly id: string;
    /** The author who wrote it. Never the caller: the reader excludes the caller by predicate. */
    readonly authorId: string;
}

/** The complete input to a correction-write decision. */
export interface CorrectionScopeInput {
    /**
     * The answer this correction asserts, in whatever identity form the subject uses.
     *
     * Compared with `===` and never interpreted — see the module docstring.
     */
    readonly correctedAnswer: string;
    /**
     * The grant that buys GLOBAL reach over THIS subject.
     *
     * ⛔ A parameter rather than a constant, because grants are not interchangeable across subjects. Each
     * specialization supplies its own; a shared one would widen whichever grant got reused.
     */
    readonly requiredGrant: string;
    /**
     * Every grant the caller holds.
     *
     * The service passes `scopes` ∪ `permissions`, mirroring `identity`'s `ScopesGuard` rule that a scope is
     * satisfied by EITHER list. Both are read from the token's SIGNED `public_metadata`; a top-level claim is
     * never a grant.
     */
    readonly grantedScopes: readonly string[];
    /** The global correction in force for this subject, or `undefined` when there is none. */
    readonly liveGlobal: LiveGlobalCorrection | undefined;
    /** The caller's OWN live correction, or `undefined`. Only its own author may displace it. */
    readonly liveOwn: { readonly id: string; readonly answer: string } | undefined;
    /**
     * The OTHER authors who already hold a live author-scoped correction asserting
     * {@link CorrectionScopeInput.correctedAnswer}, ordered `created_at, id`.
     *
     * ⛔ The caller's own row is EXCLUDED by the reader that builds this (`author_id <> :caller`), which is
     * what makes "the same author correcting twice does not promote" a property of the SET rather than a rule
     * this policy has to remember. Distinctness is guaranteed upstream by the partial unique index over live
     * author rows — the reason corroboration is a row count and never a read-modify-write counter. The ORDER
     * is the reader's, not re-derived here.
     */
    readonly corroboratorsForSameAnswer: readonly CorroboratingCorrection[];
}

/**
 * The outcome of a correction-write decision.
 *
 * A DISCRIMINATED UNION over `write` rather than `{ allowed, scope?, promotion? }`, for the reason
 * `ProvenanceDecision` gives: a member has no field it does not need, and an optional field would let a
 * caller read `undefined` as a default on the wrong path. There is no `allowed: false` member because there
 * is nothing a caller can ASK for and be refused — see the module docstring.
 *
 * `write: 'none'` is the idempotent case and is not a failure: the correction already matches the binding
 * that applies to this caller, so writing would mint a churn row and inflate the corroboration count that
 * feeds promotion.
 */
export type CorrectionScopeDecision =
    | {
          readonly write: 'none';
          readonly reason: string;
      }
    | {
          /** A grant holder's own global ruling. */
          readonly write: 'global';
          readonly scope: 'global';
          readonly origin: 'curator';
          /** The live global correction this write retires, or `undefined` when there was none. */
          readonly supersedes: string | undefined;
          readonly reason: string;
      }
    | {
          /** An ordinary caller's own correction. */
          readonly write: 'author';
          readonly scope: 'author';
          readonly origin: 'author';
          /** The caller's OWN earlier correction this write retires, or `undefined`. Never anybody else's. */
          readonly supersedes: string | undefined;
          /**
           * The additional corroboration binding this write earns, or `undefined` when it earns none.
           *
           * A promotion is a SEPARATE global row citing both agreeing corrections — never a flip of an
           * existing one. Flipping would rewrite the meaning of a record its author authored: the row would
           * claim global authority attributed to an author who never asserted it, carrying a `surfacing` that
           * is not what caused the promotion, and it would destroy that author's own personal correction.
           */
          readonly promotion:
              | {
                    /** The corroborating correction cited alongside the one this write creates. */
                    readonly citesExisting: string;
                    /** The live global correction the promotion retires, or `undefined`. */
                    readonly supersedesGlobal: string | undefined;
                }
              | undefined;
          readonly reason: string;
      };

/**
 * Evaluate how far a caller's correction reaches and what it displaces. Pure — inputs only.
 *
 * @param input - The asserted answer, the grant that would elevate it, the caller's grants, and what the
 *   knowledge base already holds (the live global correction, the caller's own, and the other authors who
 *   already agree).
 * @returns The write the caller will perform, or `write: 'none'` when the correction changes nothing.
 */
export function evaluateCorrectionScope(input: CorrectionScopeInput): CorrectionScopeDecision {
    const { correctedAnswer, requiredGrant, grantedScopes, liveGlobal, liveOwn, corroboratorsForSameAnswer } = input;

    // Idempotence FIRST, and before the grant check, because "nothing to do" is true regardless of authority.
    // A caller re-asserting the binding already in force for them writes nothing: otherwise every re-open of
    // a corrected line mints a churn row, and the corroboration count it feeds becomes a count of visits.
    if (liveOwn?.answer === correctedAnswer) {
        return { write: 'none', reason: 'The caller already asserts exactly this.' };
    }

    if (liveGlobal?.answer === correctedAnswer && liveOwn === undefined) {
        return { write: 'none', reason: 'The global correction already in force says exactly this.' };
    }

    if (grantedScopes.includes(requiredGrant)) {
        return {
            write: 'global',
            scope: 'global',
            origin: 'curator',
            // Retire whatever global correction was in force, whoever produced it: a grant holder outranks
            // both a previous curator and a corroboration pair.
            supersedes: liveGlobal?.id,
            reason: 'The caller holds the curator grant, which binds this globally on first correction.',
        };
    }

    return {
        write: 'author',
        scope: 'author',
        origin: 'author',
        // ⛔ Only the caller's OWN row. Nothing here can name another author's, which is what makes "an
        // author-scoped correction is superseded only by its own author" a property of the decision's SHAPE
        // rather than a rule the DAL has to be trusted to apply.
        supersedes: liveOwn?.id,
        promotion: decidePromotion(liveGlobal, corroboratorsForSameAnswer),
        reason: 'An ungranted correction binds only its own author until a second independent author agrees.',
    };
}

/**
 * Decide whether this correction earns a corroboration binding, and what that binding displaces. Pure.
 *
 * ⛔ The `curator` guard closes the SECOND escalation path. Two accounts held by one person clear a
 * distinct-author check, so allowing a fresh pair to displace a curator's deliberate ruling would make the
 * grant decorative: the escalation would simply move from the edit path to the corroboration path.
 *
 * @param liveGlobal - The global correction in force, if any.
 * @param corroborators - Other authors already asserting this same answer, ordered `created_at, id`.
 * @returns The promotion this write earns, or `undefined`.
 */
function decidePromotion(
    liveGlobal: LiveGlobalCorrection | undefined,
    corroborators: readonly CorroboratingCorrection[],
): { readonly citesExisting: string; readonly supersedesGlobal: string | undefined } | undefined {
    const earliest = corroborators[0];

    if (earliest === undefined) {
        return undefined;
    }

    if (liveGlobal !== undefined && liveGlobal.origin === 'curator') {
        return undefined;
    }

    return { citesExisting: earliest.id, supersedesGlobal: liveGlobal?.id };
}
