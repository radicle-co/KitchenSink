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
 *  1. **Nothing can send it.** U10 ships no route (U14 owns the correction surface and the `CONTRACT_HASH`
 *     move that comes with publishing one), and U14's specified content is a needs-review line state plus a
 *     food picker — no scope control. A wire field, a persisted value and a deny branch for an input nothing
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

/**
 * The scope a principal must hold in its token's SIGNED `public_metadata` to bind an ingredient phrase for
 * every user.
 *
 * ⚠️ Sited here rather than on the wire contract ONLY because U10 ships no contract change. When U14
 * publishes the correction route it MUST move this constant to `ingredients.schema.ts`, where
 * `CURATOR_IMPORT_SCOPE` sits on `recipes.schema.ts` and for the same reason: the tooling that grants it must
 * READ the value rather than restate it, since a second copy of an authorization identifier fails OPEN.
 * Nothing may re-declare it.
 *
 * The GRANT itself is administered out of band, in Clerk, on the signing key's authority (ADR-0023).
 */
export const CURATOR_MAPPING_SCOPE = 'recipes:mappings:global';

/** The two reaches a mapping can hold. `global` binds every user; `author` binds only its writer. */
export const MAPPING_SCOPES = ['author', 'global'] as const;

/** How far a curated mapping reaches. */
export type MappingScope = (typeof MAPPING_SCOPES)[number];

/**
 * On whose authority a mapping holds.
 *
 * Separate from {@link MappingScope} because `curator` and `corroboration` are the SAME reach arrived at by
 * DIFFERENT authority, and the supersession rule turns on which one it was: a pair may displace a pair, but
 * not a curator.
 */
export const MAPPING_ORIGINS = ['author', 'curator', 'corroboration'] as const;

/** On whose authority a mapping holds. */
export type MappingOrigin = (typeof MAPPING_ORIGINS)[number];

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
export interface CorroboratingMapping {
    /** Its row id — cited by the promotion, which is what makes the promotion auditable. */
    readonly id: string;
    /** The author who wrote it. Never the caller: the reader excludes the caller by predicate. */
    readonly authorId: string;
}

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
     * {@link correctedFoodId}, ordered `created_at, id`.
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
 * The outcome of a mapping-write decision.
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
export type MappingWriteDecision =
    | {
          readonly write: 'none';
          readonly reason: string;
      }
    | {
          /** A grant holder's own global ruling. */
          readonly write: 'global';
          readonly scope: 'global';
          readonly origin: 'curator';
          /** The live global mapping this write retires, or `undefined` when there was none to retire. */
          readonly supersedes: string | undefined;
          readonly reason: string;
      }
    | {
          /** An ordinary caller's own correction. */
          readonly write: 'author';
          readonly scope: 'author';
          readonly origin: 'author';
          /** The caller's OWN earlier mapping this write retires, or `undefined`. Never anybody else's. */
          readonly supersedes: string | undefined;
          /**
           * The additional corroboration binding this write earns, or `undefined` when it earns none.
           *
           * A promotion is a SEPARATE global row citing both agreeing mappings — never a flip of an existing
           * one. Flipping would rewrite the meaning of a record its author authored: the row would claim
           * global authority attributed to an author who never asserted it, carrying a `surfacing` that is
           * not what caused the promotion, and it would destroy that author's own personal mapping.
           */
          readonly promotion:
              | {
                    /** The corroborating mapping cited alongside the one this write creates. */
                    readonly citesExisting: string;
                    /** The live global mapping the promotion retires, or `undefined`. */
                    readonly supersedesGlobal: string | undefined;
                }
              | undefined;
          readonly reason: string;
      };

/**
 * Evaluate how far a caller's correction reaches and what it displaces. Pure — inputs only.
 *
 * @param input - The corrected food, the caller's grants, and what the knowledge base already holds for the
 *   phrase (the live global mapping, the caller's own, and the other authors who already agree).
 * @returns The write the service will perform, or `write: 'none'` when the correction changes nothing.
 */
export function evaluateMappingWrite(input: MappingWriteInput): MappingWriteDecision {
    const { correctedFoodId, grantedScopes, liveGlobal, liveOwn, corroboratorsForSameFood } = input;

    // Idempotence FIRST, and before the grant check, because "nothing to do" is true regardless of authority.
    // A caller re-asserting the binding already in force for them writes nothing: otherwise every re-open of
    // a corrected line mints a churn row, and the corroboration count it feeds becomes a count of visits.
    if (liveOwn?.foodId === correctedFoodId) {
        return { write: 'none', reason: 'The caller already holds this exact mapping.' };
    }

    if (liveGlobal?.foodId === correctedFoodId && liveOwn === undefined) {
        return { write: 'none', reason: 'The global mapping already in force says exactly this.' };
    }

    if (grantedScopes.includes(CURATOR_MAPPING_SCOPE)) {
        return {
            write: 'global',
            scope: 'global',
            origin: 'curator',
            // Retire whatever global mapping was in force, whoever produced it: a grant holder outranks both
            // a previous curator and a corroboration pair.
            supersedes: liveGlobal?.id,
            reason: 'The caller holds the curator grant, which binds the phrase globally on first correction.',
        };
    }

    return {
        write: 'author',
        scope: 'author',
        origin: 'author',
        // ⛔ Only the caller's OWN mapping. Nothing here can name another author's row, which is what makes
        // "an author-scoped mapping is superseded only by its own author" a property of the decision's SHAPE
        // rather than a rule the DAL has to be trusted to apply.
        supersedes: liveOwn?.id,
        promotion: decidePromotion(liveGlobal, corroboratorsForSameFood),
        reason: 'An ungranted correction binds only its own author until a second independent author agrees.',
    };
}

/**
 * Decide whether this correction earns a corroboration binding, and what that binding displaces. Pure.
 *
 * ⛔ The `curator` guard is the second escalation path being closed, and it NARROWS the plan — see the module
 * docstring. Two accounts held by one person clear a distinct-author check, so allowing a fresh pair to
 * displace a curator's deliberate ruling would make the grant decorative: the escalation would simply move
 * from the edit path to the corroboration path.
 *
 * @param liveGlobal - The global mapping in force, if any.
 * @param corroborators - Other authors already mapping this phrase to this food, ordered `created_at, id`.
 * @returns The promotion this write earns, or `undefined`.
 */
function decidePromotion(
    liveGlobal: LiveGlobalMapping | undefined,
    corroborators: readonly CorroboratingMapping[],
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
