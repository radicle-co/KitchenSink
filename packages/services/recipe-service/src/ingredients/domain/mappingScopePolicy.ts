/**
 * The pure curated-mapping write policy (plan U10 / R19, R20).
 *
 * DESIGN PATTERN: **Specification / Policy module**, deliberately the sibling of `evaluateProvenance`
 * (`recipes/domain/provenancePolicy.ts`) and shaped like it on purpose. It answers ONE question — "how far
 * does this caller's correction reach, and what does it displace?" — from its inputs alone: no DB, no
 * `Principal` object, no I/O. Grants arrive as a primitive `readonly string[]` for exactly the reason
 * `evaluateProvenance` takes one: a policy that can reach a request cannot be exhausted as a truth table, and
 * this policy's whole defensibility is that it CAN be.
 *
 * ⛔ **THE RULE ITSELF NOW LIVES IN `correctionScopePolicy.ts`; this module is its MAPPING specialization**
 * (plan U21 / KTD-15). U21 found the identical question being asked of a second subject — a line's PARSE
 * rather than a phrase's meaning — and KTD-15 rules that "one business rule, one representation" makes the
 * subject a parameter rather than a second rule. What stayed here is everything that is genuinely about
 * MAPPINGS: the vocabulary (`foodId`), the grant (`CURATOR_MAPPING_SCOPE`), and the reasoning below, which
 * was written about this subject and is not the parse tier's. ⚠️ This module's public API is UNCHANGED across
 * that extraction, and its truth-table suite was not touched — that is the evidence the behaviour did not
 * move with the code.
 *
 * ⚠️ ONE DIVERGENCE FROM THE SIBLING, STATED SO IT IS NOT READ AS PARITY: `evaluateProvenance` is pure AND
 * stateless. This one is pure but NOT stateless — its decision genuinely depends on what the knowledge base
 * already holds, so the caller reads those facts and passes them in. Purity is preserved (same inputs, same
 * decision, every time); statelessness is not available, because "may this displace what is in force?" has
 * no answer without knowing what is in force.
 *
 * ## What a curated mapping is, and why its reach is an authorization question
 *
 * A mapping says "the ingredient phrase `plain flour` means food X", and R19 makes it outrank every other
 * resolution tier. At `global` scope that sentence is asserted for EVERY user of the installation, on every
 * future occurrence of the phrase, with no further review. The reach of a correction is therefore not a
 * preference — it is a privilege, and the thing authorized is a FIELD VALUE (`scope`), not a route.
 *
 * ## ⛔ Why this is NOT a route Guard
 *
 * The same reasoning ADR-0023 records for `evaluateProvenance`, and not by coincidence: this is the second
 * instance of the same authorization SHAPE. `identity`'s `ScopesGuard` + `@RequireScopes` is **route**-level,
 * and the correction route must stay open to every authenticated user — a cook fixing their own recipe line
 * is the ordinary case and the entire point of the learning loop. Gating the route would gate the wrong
 * thing; gating the field value keeps the whole decision inside one pure, total, table-testable function
 * instead of splitting it across two layers.
 *
 * ## ⛔ Scope is an OUTPUT, not a declarable input — and that is a deliberate narrowing
 *
 * An earlier draft of this policy took a `declaredScope: 'global' | undefined` and DENIED it without the
 * grant, to mirror `evaluateProvenance`'s allow/deny union exactly. It was cut, for three reasons:
 *
 *  1. **Nothing can send it.** U10 shipped no route (U14 owns the correction surface and the `CONTRACT_HASH`
 *     move that comes with publishing one), and the route U14 DID ship
 *     (`POST /api/v1/ingredients/corrections`) carries no scope control either — its body is
 *     `{ phrase, foodId, surfacing }`. A wire field, a persisted value and a deny branch for an input nothing
 *     produces is YAGNI in Fowler's strict sense.
 *  2. **It is the wrong axis.** The authorization decision that actually exists is
 *     `grants × what the knowledge base already holds` — a correction on a phrase already carrying a live
 *     global mapping is a materially different question from one on a virgin phrase, and it fires with no
 *     wire field at all. That is the truth table, and it is far richer than the two rows a declaration bought.
 *  3. **It would have ADDED attack surface to defend.** Without a declarable scope, a caller cannot even ask
 *     for global reach; the grant purely elevates. Inventing a hazard so the policy can guard it is the
 *     pattern implemented wrong, and the name would then advertise a gate over an input no attacker can send.
 *
 * Adding it later is additive (an optional request field, and a new union member is a compile error at every
 * exhaustive `switch`). ⚠️ Accepted consequence, stated because it is a real product loss: a grant holder
 * cannot write an author-scoped mapping — every curator correction binds globally. That matches the owner
 * ruling verbatim; the day a curator needs to correct a phrase for their own recipe without binding everyone,
 * the field to add is `declaredScope: 'author'`, an opt-DOWN needing no grant. Note the direction is opposite
 * to the one that was cut.
 *
 * ## The two escalation paths, and why BOTH are closed here
 *
 * R20 says "a later correction supersedes" an earlier mapping. Read without a scope gate that hands any
 * authenticated caller a one-step path to overwrite a curator's global mapping through the EDIT path. The
 * plan closes that one. ⛔ But its own remedy opens a second: it permits supersession "by a grant holder **or
 * by a fresh independent-corroboration pair**" — and two accounts held by one person clear a distinct-author
 * check, so sock puppets would displace a curator by the corroboration path instead. This policy therefore
 * NARROWS the plan: a `corroboration`-origin global mapping may be displaced by a fresh pair, a
 * `curator`-origin one may not. ⚠️ **That narrowing is flagged for the owner, not assumed** — without it the
 * grant is decorative, but it is a change to the plan's text and deserves a ruling.
 *
 * ## Collusion is answered by ENUMERABILITY, not by prevention
 *
 * A promotion is written as its own row citing BOTH corroborating mappings (`origin = 'corroboration'`,
 * `corroborated_a/b`), so every promotion is enumerable by `SELECT`, durably. ADR-0023 records the same limit
 * for its grant and the same answer: promotions are reviewable after the fact. This policy does not claim to
 * prevent collusion and must not be read as if it did.
 */
import { CURATOR_MAPPING_SCOPE } from '../ingredients.schema.js';
import {
    CORRECTION_ORIGINS,
    CORRECTION_SCOPES,
    evaluateCorrectionScope,
    type CorrectionOrigin,
    type CorrectionScope,
    type CorrectionScopeDecision,
    type CorroboratingCorrection,
} from './correctionScopePolicy.js';

/*
 * ✅ MOVED, as this module's earlier note required. `CURATOR_MAPPING_SCOPE` was sited here only because U10
 * shipped no contract change; U14 publishes `POST /api/v1/ingredients/corrections`, so the constant now lives
 * on the wire contract (`../ingredients.schema.ts`) and is IMPORTED above. It is re-exported so this module's
 * existing importers — and its truth-table suite — keep addressing it where the policy is, while exactly ONE
 * declaration of it exists anywhere: a second copy of an authorization identifier fails OPEN.
 */
export { CURATOR_MAPPING_SCOPE };

/**
 * The two reaches a mapping can hold. `global` binds every user; `author` binds only its writer.
 *
 * An ALIAS of the subject-neutral {@link CORRECTION_SCOPES}, not a second declaration: the reaches are the
 * same two whatever is being corrected, and a copy would let this table's CHECK and the parse table's drift
 * apart while both still compiled.
 */
export const MAPPING_SCOPES = CORRECTION_SCOPES;

/** How far a curated mapping reaches. */
export type MappingScope = CorrectionScope;

/**
 * On whose authority a mapping holds.
 *
 * Separate from {@link MappingScope} because `curator` and `corroboration` are the SAME reach arrived at by
 * DIFFERENT authority, and the supersession rule turns on which one it was: a pair may displace a pair, but
 * not a curator.
 */
export const MAPPING_ORIGINS = CORRECTION_ORIGINS;

/** On whose authority a mapping holds. */
export type MappingOrigin = CorrectionOrigin;

/** The global mapping currently in force for the phrase being corrected. */
export interface LiveGlobalMapping {
    /** Its row id — carried so a supersession decision can name exactly what it retires. */
    readonly id: string;
    /** The food it names. */
    readonly foodId: string;
    /** Whether a grant holder wrote it or two authors' agreement produced it. Never `author`. */
    readonly origin: Exclude<MappingOrigin, 'author'>;
}

/** One other author's live mapping from the same phrase to the same food. */
export type CorroboratingMapping = CorroboratingCorrection;

/** The complete input to a mapping-write decision. */
export interface MappingWriteInput {
    /** The food this correction points the phrase at. */
    readonly correctedFoodId: string;
    /**
     * Every grant the caller holds.
     *
     * The service passes `scopes` ∪ `permissions`, mirroring `identity`'s `ScopesGuard` rule that a scope is
     * satisfied by EITHER list. Both are read from the token's SIGNED `public_metadata`; a top-level claim is
     * never a grant.
     */
    readonly grantedScopes: readonly string[];
    /** The global mapping in force for this phrase, or `undefined` when there is none. */
    readonly liveGlobal: LiveGlobalMapping | undefined;
    /** The caller's OWN live mapping for this phrase, or `undefined`. Only its own author may displace it. */
    readonly liveOwn: { readonly id: string; readonly foodId: string } | undefined;
    /**
     * The OTHER authors who already hold a live author-scoped mapping from this phrase to
     * {@link MappingWriteInput.correctedFoodId}, ordered `created_at, id`.
     *
     * ⛔ The caller's own mapping is EXCLUDED by the reader that builds this (`author_id <> :caller`), which
     * is what makes "the same author correcting twice does not promote" a property of the SET rather than a
     * rule this policy has to remember. Distinctness is guaranteed upstream by the partial unique index on
     * `(normalized_key, author_id)` over live author rows — the reason corroboration is a row count and never
     * a read-modify-write counter. The ORDER is the reader's, not re-derived here.
     */
    readonly corroboratorsForSameFood: readonly CorroboratingMapping[];
}

/**
 * The outcome of a mapping-write decision — an ALIAS of {@link CorrectionScopeDecision}.
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
export type MappingWriteDecision = CorrectionScopeDecision;

/**
 * Evaluate how far a caller's correction reaches and what it displaces. Pure — inputs only.
 *
 * A thin ADAPTER over {@link evaluateCorrectionScope}: it names the mapping subject's answer (`food_id`) and
 * the mapping subject's grant, and contributes no rule of its own. Every branch this function's behaviour
 * depends on lives there, which is why this module's own truth-table suite — unchanged across that
 * extraction — is the evidence the extraction preserved the behaviour.
 *
 * @param input - The corrected food, the caller's grants, and what the knowledge base already holds for the
 *   phrase (the live global mapping, the caller's own, and the other authors who already agree).
 * @returns The write the service will perform, or `write: 'none'` when the correction changes nothing.
 */
export function evaluateMappingWrite(input: MappingWriteInput): MappingWriteDecision {
    return evaluateCorrectionScope({
        correctedAnswer: input.correctedFoodId,
        // ⛔ The mapping subject's OWN grant, supplied here rather than baked into the shared rule. A grant
        // shared between subjects would silently widen whichever one got reused.
        requiredGrant: CURATOR_MAPPING_SCOPE,
        grantedScopes: input.grantedScopes,
        liveGlobal:
            input.liveGlobal === undefined
                ? undefined
                : { id: input.liveGlobal.id, answer: input.liveGlobal.foodId, origin: input.liveGlobal.origin },
        liveOwn: input.liveOwn === undefined ? undefined : { id: input.liveOwn.id, answer: input.liveOwn.foodId },
        corroboratorsForSameAnswer: input.corroboratorsForSameFood,
    });
}
