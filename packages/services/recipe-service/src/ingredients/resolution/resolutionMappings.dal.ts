/**
 * `ResolutionMappingsDal` — every statement over the ingredient-resolution knowledge base (plan U10).
 *
 * DESIGN PATTERN: **Repository**, with the authorization pushed INTO the statements. It EXECUTES a
 * {@link MappingWriteDecision}; it never makes one. The rules live in `domain/mappingScopePolicy.ts`, which
 * is pure and exhaustible; what lives here is the SQL that carries a decision out atomically.
 *
 * ## ⛔ Three `WHERE` clauses ARE the authorization, and none of them is a branch
 *
 * 1. **`user_id = :caller` inside the supersede `UPDATE`.** "An author-scoped mapping is superseded only by
 *    the user who wrote it" is not enforced by a check the caller could be trusted to run first — it is
 *    enforced by the statement matching nothing. **Zero rows returned IS the denial**, atomically, with no id
 *    a caller can pass that reaches somebody else's row. (An index cannot do this: an index constrains
 *    uniqueness, and superseding a row RELIEVES uniqueness rather than violating it — so a design that
 *    enforced supersession with indexes alone would leave the edit path wide open, which is the escalation
 *    the plan's ⛔ names.)
 * 2. **`ON CONFLICT … DO NOTHING` on the promotion insert.** The concurrent-promotion race then has a LOSER,
 *    not an ERROR: the loser reads zero rows as "somebody else already promoted this", emits no audit signal,
 *    and does not fail the user's correction. An `UPDATE` that flipped an existing row into the global slot
 *    could not do this — it would raise `23505` and abort the whole transaction.
 * 3. **`(scope = 'global' OR (:caller IS NOT NULL AND user_id = :caller))`.** An unattended import (R22)
 *    has no user, and must see global mappings and NOBODY's personal ones. Written with the explicit
 *    `IS NOT NULL` rather than relying on `user_id = NULL` evaluating to NULL, because the latter is
 *    correct and is a reviewer trap.
 *
 * ⚠️ DELIBERATE — `user_id` is a COUNTER and an AUTHORIZATION predicate, and it is deliberately NOT erasable.
 * It was spelled `author_id` until migration 0033; read
 * `docs/architecture/decisions/0027-ingredient-phrase-is-not-personal-data.md` before "cleaning it up", and
 * note that clauses 1 and 3 above are two of the three reasons the column exists at all.
 *
 * ## The Unit of Work is the CALLER's
 *
 * `findWriteFacts` → decide → `applyWrite` must be one transaction, or two concurrent correctors read the
 * same facts and both act on them. `findWriteFacts` therefore takes a row lock on every live mapping for the
 * phrase (`FOR UPDATE`), which serialises correctors of the SAME phrase and leaves correctors of different
 * phrases untouched. The one case the lock cannot cover is a phrase with no live rows to lock — two
 * first-writers — and that is exactly what the `ON CONFLICT DO NOTHING` clauses handle, with nothing retired
 * to leave dangling.
 *
 * ⛔ `food_id` MAY DANGLE. U12's reseed mints fresh food ULIDs and there is no foreign key to catch it, so a
 * mapping can name a food that no longer exists. That is a READER's problem, handled by the tier treating an
 * unresolvable mapping as a miss — never this DAL's, which would otherwise need to call another service to
 * answer a query.
 */
import { sql } from 'drizzle-orm';
import type { NormalizedIngredientKey } from '@kitchensink/recipe-core/resolution/normalized-key';

import type { RecipeDrizzle } from '../../database/database.module.js';
import type { RecipeTx, Writer } from '../../database/unitOfWork.js';
import { withTransaction } from '../../database/unitOfWork.js';
import type {
    CorroboratingMapping,
    LiveGlobalMapping,
    MappingOrigin,
    MappingScope,
    MappingWriteDecision,
} from '../domain/mappingScopePolicy.js';

/**
 * The similarity floor a near-twin memo must clear.
 *
 * ⛔ NOT AN OPTIMISATION — the whole difference between "resolves a near-twin" and "resolves anything at
 * all". A k-NN search ALWAYS returns a row when the table is non-empty, so an unbounded nearest-neighbour
 * tier confidently maps `bay leaves` onto whatever happens to be closest. 0.5 is the midpoint of the trigram
 * scale and is set here rather than through `pg_trgm.similarity_threshold`, which is a per-SESSION GUC: on a
 * pooled connection that is shared, mutable state one query can change for the next.
 */
export const MEMO_SIMILARITY_FLOOR = 0.5;

/** The mapping in force for a phrase, for a given caller. */
export interface MappingInForce {
    readonly id: string;
    readonly foodId: string;
    readonly scope: MappingScope;
    readonly origin: MappingOrigin;
}

/** The facts `evaluateMappingWrite` needs, read under the lock that makes acting on them safe. */
export interface MappingWriteFacts {
    readonly liveGlobal: LiveGlobalMapping | undefined;
    readonly liveOwn: { readonly id: string; readonly foodId: string } | undefined;
    readonly corroboratorsForSameFood: readonly CorroboratingMapping[];
    /** U11/R20: whether the corrected food is someone's PRIVATE authored one (`food_owner_id` set). */
    readonly correctedFoodIsPrivate: boolean;
}

/** Everything a write needs beyond the decision itself. */
export interface MappingWriteRequest {
    /** The decision to execute. Produced by the policy; this DAL never derives one. */
    readonly decision: MappingWriteDecision;
    readonly normalizedKey: NormalizedIngredientKey;
    /** The raw phrase, persisted so a key-derivation change is a backfill rather than data loss. */
    readonly sourcePhrase: string;
    readonly foodId: string;
    /** The correcting user — the row's counting key, and the predicate that authorizes its supersession. */
    readonly userId: string;
    /** Which affordance produced the correction (R20). */
    readonly surfacing: string;
}

/** A promotion that actually happened — the audit payload, carrying what the durable row records. */
export interface PromotionRecord {
    /** The corroboration binding's row id. */
    readonly mappingId: string;
    /** The pre-existing corroborating mapping it cites. */
    readonly citesExisting: string;
    /** The mapping this write created, cited alongside it. */
    readonly citesNew: string;
}

/**
 * Why a write decision produced no row.
 *
 * ⛔ A CLOSED SET beside the prose `reason`, added by U14 when the outcome first had to cross the wire. The
 * prose is written for a reviewer reading the module and is free to change; a CLIENT cannot branch on a
 * sentence, and publishing the sentence would freeze this module's internal wording into the contract.
 * `already_in_force` is the idempotent case the policy decides; `superseded` is the concurrent-writer race
 * the DAL discovers. Neither is an error.
 */
export type MappingWriteNoOutcome = 'already_in_force' | 'superseded';

/** The result of executing a write decision. */
export type MappingWriteResult =
    | { readonly written: false; readonly outcome: MappingWriteNoOutcome; readonly reason: string }
    | {
          readonly written: true;
          /** The row this write created. */
          readonly mappingId: string;
          /** The corroboration binding this write earned, or `undefined` when it earned none. */
          readonly promotion: PromotionRecord | undefined;
      };

/** A memo lookup hit, and how it was found. */
export interface MemoHit {
    readonly foodId: string;
    /** `exact` when the key matched verbatim, `near` when a nearest-neighbour scan found it. */
    readonly match: 'exact' | 'near';
    /** Trigram similarity to the query key, in `[0, 1]`. Always `1` for an exact hit. */
    readonly similarity: number;
}

/** A machine-derived resolution the verification gate agreed with (R21). */
export interface VerifiedMemo {
    readonly normalizedKey: NormalizedIngredientKey;
    readonly foodId: string;
    readonly sourcePhrase: string;
    /**
     * The identifier of the model that AGREED with this resolution.
     *
     * ⛔ REQUIRED, and that is the enforcement of "an embedding entry is written only for a resolution the
     * verification gate agreed with": a caller with no model identifier to record has no agreement to record,
     * and cannot construct this value.
     */
    readonly verifiedBy: string;
}

/** The raw shape of a mapping row as projected by this DAL's reads. */
interface RawMappingRow {
    [column: string]: unknown;
    id: string;
    food_id: string;
    scope: string;
    origin: string;
}

/** The raw shape of a corroborator projection. */
interface RawCorroboratorRow {
    [column: string]: unknown;
    id: string;
    user_id: string;
}

/** The raw shape of a memo projection. */
interface RawMemoRow {
    [column: string]: unknown;
    food_id: string;
    similarity: string | number;
}

export class ResolutionMappingsDal {
    public constructor(private readonly db: RecipeDrizzle) {}

    /**
     * Run `fn` as ONE transaction over this DAL's database.
     *
     * Exposed here rather than leaving the service to reach for `withTransaction` itself, because the Unit of
     * Work is a property of THIS repository's statements: `findWriteFacts` takes a `FOR UPDATE` row lock that
     * is worth nothing unless the decision and the write it feeds happen before the transaction ends. A
     * service holding the seam without the lock is the shape that silently loses a corroboration.
     *
     * @param fn - The work to run inside the transaction.
     * @returns Whatever `fn` returns.
     * @sideEffect Opens a transaction; every write `fn` performs commits or rolls back together.
     */
    public async runInTransaction<T>(fn: (tx: RecipeTx) => Promise<T>): Promise<T> {
        return withTransaction(this.db, fn);
    }

    /**
     * TIER 1's READ: the mapping in force for this phrase, for this caller.
     *
     * Precedence is the caller's OWN mapping, then the global one — expressed as a sort key rather than two
     * queries so the answer comes from one indexed read and cannot disagree with itself. `created_at DESC`
     * breaks a tie that the partial unique indexes already make unreachable, and `id DESC` breaks the tie
     * `created_at` cannot: two rows written inside one `timestamptz` tick would otherwise order arbitrarily.
     *
     * @param normalizedKey - The phrase's match grain.
     * @param userId - The requesting user, or `undefined` for an unattended import (R22) — which sees
     *   global mappings and nobody's personal ones.
     * @returns The mapping in force, or `undefined` when nothing binds this phrase for this caller.
     * @sideEffect Reads `ingredient_resolution_mappings`.
     */
    public async findInForce(
        normalizedKey: NormalizedIngredientKey,
        userId: string | undefined,
    ): Promise<MappingInForce | undefined> {
        const caller = userId ?? null;
        const result = await this.db.execute<RawMappingRow>(sql`
            SELECT id, food_id, scope, origin
            FROM ingredient_resolution_mappings
            WHERE normalized_key = ${normalizedKey}
              AND superseded_at IS NULL
              AND (scope = 'global' OR (${caller}::text IS NOT NULL AND user_id = ${caller}))
            ORDER BY (scope = 'author') DESC, created_at DESC, id DESC
            LIMIT 1
        `);
        const row = result.rows[0];

        return row === undefined
            ? undefined
            : {
                  id: row.id,
                  foodId: row.food_id,
                  scope: row.scope as MappingScope,
                  origin: row.origin as MappingOrigin,
              };
    }

    /**
     * Read the facts the scope policy decides from, LOCKING every live mapping for the phrase.
     *
     * ⛔ The lock is the point. Without it, two users correcting the same phrase concurrently both read
     * "nobody else agrees" and both write an author-scoped mapping, so the second one's promotion never fires
     * — a corroboration silently lost. `FOR UPDATE` serialises correctors of the SAME phrase and leaves every
     * other phrase untouched. It is a no-op for a phrase with no live rows, which is why the write statements
     * still carry `ON CONFLICT DO NOTHING`.
     *
     * @param normalizedKey - The phrase's match grain.
     * @param userId - The correcting user.
     * @param foodId - The food being corrected TO — corroboration is agreement on the ANSWER, not merely on
     *   the phrase being wrong, so the corroborator query filters on it.
     * @param writer - The open transaction. Required in practice: reading these facts outside the transaction
     *   that acts on them discards the lock's guarantee.
     * @returns The live global mapping, the caller's own, and the other authors who already agree.
     * @sideEffect Reads and ROW-LOCKS `ingredient_resolution_mappings` until the transaction ends.
     */
    public async findWriteFacts(
        normalizedKey: NormalizedIngredientKey,
        userId: string,
        foodId: string,
        writer: Writer = this.db,
    ): Promise<MappingWriteFacts> {
        await writer.execute(sql`
            SELECT id FROM ingredient_resolution_mappings
            WHERE normalized_key = ${normalizedKey} AND superseded_at IS NULL
            FOR UPDATE
        `);

        const globalRows = await writer.execute<RawMappingRow>(sql`
            SELECT id, food_id, scope, origin FROM ingredient_resolution_mappings
            WHERE normalized_key = ${normalizedKey} AND scope = 'global' AND superseded_at IS NULL
            LIMIT 1
        `);
        const ownRows = await writer.execute<RawMappingRow>(sql`
            SELECT id, food_id, scope, origin FROM ingredient_resolution_mappings
            WHERE normalized_key = ${normalizedKey} AND scope = 'author' AND user_id = ${userId}
              AND superseded_at IS NULL
            LIMIT 1
        `);
        // ⛔ `user_id <> ${userId}` is what makes "the same user correcting twice does not promote" a
        // property of the SET the policy receives rather than a rule the policy has to remember. It is the
        // DISTINCT half of the distinct-user count; the partial unique index is the other half.
        const corroboratorRows = await writer.execute<RawCorroboratorRow>(sql`
            SELECT id, user_id FROM ingredient_resolution_mappings
            WHERE normalized_key = ${normalizedKey} AND scope = 'author' AND food_id = ${foodId}
              AND superseded_at IS NULL AND user_id IS NOT NULL AND user_id <> ${userId}
            ORDER BY created_at, id
        `);

        // U11/R20: the privacy fact the policy clamps reach on. Read from `ingredients.food_owner_id`
        // inside the same transaction as the facts above — a food promoted concurrently is read as still
        // private, which errs toward the NARROWER reach (the correction lands author-scoped and the next
        // corroborating write promotes it).
        const privateRows = await writer.execute<{ [column: string]: unknown; one: number }>(sql`
            SELECT 1 AS one FROM ingredients
            WHERE food_id = ${foodId} AND food_owner_id IS NOT NULL
            LIMIT 1
        `);

        const liveGlobal = globalRows.rows[0];
        const liveOwn = ownRows.rows[0];

        return {
            liveGlobal:
                liveGlobal === undefined
                    ? undefined
                    : {
                          id: liveGlobal.id,
                          foodId: liveGlobal.food_id,
                          origin: liveGlobal.origin as Exclude<MappingOrigin, 'author'>,
                      },
            liveOwn: liveOwn === undefined ? undefined : { id: liveOwn.id, foodId: liveOwn.food_id },
            corroboratorsForSameFood: corroboratorRows.rows.map((row) => ({ id: row.id, userId: row.user_id })),
            correctedFoodIsPrivate: privateRows.rows.length > 0,
        };
    }

    /**
     * Retire a mapping — **only if the caller wrote it**.
     *
     * ⛔ THE AUTHORIZATION IS THE `user_id` PREDICATE, not a check performed before calling this. A caller
     * holding another user's row id retires nothing: the statement matches no row, and zero rows IS the
     * denial. Exposed as its own method so that property is directly testable rather than only observable
     * through a successful write.
     *
     * @param mappingId - The row to retire.
     * @param userId - The caller, which must be the user who wrote the row.
     * @param writer - The open transaction, when enlisted in one.
     * @returns `true` when a row was retired, `false` when the caller had no standing to retire it.
     * @sideEffect Updates `ingredient_resolution_mappings`.
     */
    public async supersedeOwnMapping(mappingId: string, userId: string, writer: Writer = this.db): Promise<boolean> {
        const result = await writer.execute<{ id: string }>(sql`
            UPDATE ingredient_resolution_mappings SET superseded_at = now()
            WHERE id = ${mappingId} AND scope = 'author' AND user_id = ${userId} AND superseded_at IS NULL
            RETURNING id
        `);

        return result.rows.length > 0;
    }

    /**
     * Insert the corroboration binding two agreeing authors have earned.
     *
     * ⛔ A NEW ROW, never a flip of an existing one. Flipping an author's row to global would rewrite the
     * meaning of a record its author authored: the row would claim global authority attributed to an author
     * who never asserted it, carrying a `surfacing` that is not what caused the promotion (R20 requires both
     * facts), and it would silently destroy that author's own personal mapping.
     *
     * `ON CONFLICT DO NOTHING` on the corroboration-pair index makes the concurrent race safe: **the loser
     * gets zero rows and reads that as "somebody else already promoted this"** — no audit signal, no error,
     * and no failure of the user's own correction, which stands on its own regardless.
     *
     * ⛔ AND IT STILL COPIES NOBODY'S WORDS — that survived a reversal, so read why before restoring the copy.
     * Migration 0031 removed it on TWO arguments and the 2026-08-25 owner ruling (ADR-0027) reverses only one
     * of them: a phrase is not personal data, so there is no retention window to close. The OTHER argument
     * stands entirely on its own and has nothing to do with privacy — the copy bought NOTHING. 0021 keeps a
     * phrase to make the key derivation a two-way door (`SET normalized_key = f(source_phrase)`), and this
     * binding CITES two rows that each carry their own, so a backfill for the binding runs through
     * `corroborated_a` either way. `source_phrase` is left NULL and the input type has no member for one, so
     * a caller cannot supply it. The sibling parse-correction tier follows the identical rule.
     *
     * @param input - The agreed food, its key, and the two mappings the binding cites.
     * @param writer - The open transaction, when enlisted in one.
     * @returns The binding's row id, or `undefined` when another writer had already promoted this pair.
     * @sideEffect Updates and inserts into `ingredient_resolution_mappings`.
     */
    public async promoteByCorroboration(
        input: {
            readonly normalizedKey: NormalizedIngredientKey;
            readonly foodId: string;
            readonly citesExisting: string;
            readonly citesNew: string;
            readonly supersedesGlobal: string | undefined;
        },
        writer: Writer = this.db,
    ): Promise<string | undefined> {
        if (input.supersedesGlobal !== undefined) {
            await writer.execute(sql`
                UPDATE ingredient_resolution_mappings SET superseded_at = now()
                WHERE id = ${input.supersedesGlobal} AND scope = 'global' AND superseded_at IS NULL
            `);
        }

        // The pair is stored in a stable order so two writers reaching this with the same two mappings in
        // opposite argument order still collide on the unique index rather than both inserting.
        const [first, second] = [input.citesExisting, input.citesNew].sort();
        const inserted = await writer.execute<{ id: string }>(sql`
            INSERT INTO ingredient_resolution_mappings
                (normalized_key, source_phrase, food_id, scope, origin, user_id, surfacing,
                 corroborated_a, corroborated_b)
            VALUES (${input.normalizedKey}, NULL, ${input.foodId}, 'global', 'corroboration',
                    NULL, 'corroboration', ${first}, ${second})
            ON CONFLICT (corroborated_a, corroborated_b) WHERE origin = 'corroboration' DO NOTHING
            RETURNING id
        `);

        return inserted.rows[0]?.id;
    }

    /**
     * Record a machine-derived resolution the verification gate agreed with (R21).
     *
     * Upserts on the phrase: a re-verification under a newer model REPLACES the memo rather than accumulating
     * beside it, because a memo is a food id rather than a vector — a newer judge's answer supersedes an
     * older one rather than being incomparable to it.
     *
     * ⛔ THERE IS NO PERSON ON THIS ROW, and that is the tier's defining asymmetry with the two correction
     * tiers rather than an omission. A memo is the MODEL's conclusion — nobody asserted it — so there is no
     * correction here and nothing to count, which is the only reason the sibling tables keep a `user_id` at
     * all. Migration 0026 had added an `owner_id` purely so an erasure sweep had a predicate; the 2026-08-25
     * owner ruling (ADR-0027) removed both the sweep and the column.
     *
     * ⚠️ Nothing in U10 calls this. It exists so the tier's write bar — "only a resolution the gate agreed
     * with, and record which model agreed" — is expressed as a REQUIRED field on the input type rather than a
     * sentence in a plan, before U11 has a writer to forget it.
     *
     * @param memo - The phrase, the resolved food, and the model that agreed.
     * @sideEffect Inserts into or updates `ingredient_resolution_memos`.
     */
    public async recordMemo(memo: VerifiedMemo, writer: Writer = this.db): Promise<void> {
        await writer.execute(sql`
            INSERT INTO ingredient_resolution_memos
                (normalized_key, food_id, source_phrase, verified_by)
            VALUES (${memo.normalizedKey}, ${memo.foodId}, ${memo.sourcePhrase}, ${memo.verifiedBy})
            ON CONFLICT (normalized_key) DO UPDATE
                SET food_id = EXCLUDED.food_id,
                    source_phrase = EXCLUDED.source_phrase,
                    verified_by = EXCLUDED.verified_by,
                    verified_at = now()
        `);
    }

    /**
     * THE MEMO TIER'S READ: the remembered resolution for this phrase — exact key first, nearest neighbour second.
     *
     * R14 forbids equality-only matching, so the neighbour half is not optional. It is an INDEXED k-NN scan
     * (`ORDER BY normalized_key <-> $1` over the GiST trigram index), which is why this is a bounded read
     * rather than the whole-table fetch plus in-process cosine loop the plan originally proposed.
     *
     * ⛔ The `similarity >= floor` filter is what stops a k-NN scan being a random-answer generator: with a
     * non-empty table it always returns SOMETHING, so without the floor `bay leaves` resolves to whatever is
     * closest. The exact branch is written separately rather than folded into the ordering because an exact
     * hit must be reported as exact — a caller deciding how much to trust the answer needs to know which of
     * the two happened.
     *
     * @param normalizedKey - The phrase's match grain.
     * @param floor - The minimum trigram similarity a neighbour must clear.
     * @returns The memo hit, or `undefined` when nothing is remembered close enough.
     * @sideEffect Reads `ingredient_resolution_memos`.
     */
    public async findMemo(
        normalizedKey: NormalizedIngredientKey,
        floor: number = MEMO_SIMILARITY_FLOOR,
    ): Promise<MemoHit | undefined> {
        const exact = await this.db.execute<RawMemoRow>(sql`
            SELECT food_id, 1 AS similarity FROM ingredient_resolution_memos
            WHERE normalized_key = ${normalizedKey} LIMIT 1
        `);

        if (exact.rows[0] !== undefined) {
            return { foodId: exact.rows[0].food_id, match: 'exact', similarity: 1 };
        }

        const near = await this.db.execute<RawMemoRow>(sql`
            SELECT food_id, similarity(normalized_key, ${normalizedKey}) AS similarity
            FROM ingredient_resolution_memos
            ORDER BY normalized_key <-> ${normalizedKey}
            LIMIT 1
        `);
        const row = near.rows[0];

        if (row === undefined) {
            return undefined;
        }

        const score = Number(row.similarity);

        return score >= floor ? { foodId: row.food_id, match: 'near', similarity: score } : undefined;
    }

    /**
     * Execute a write decision as ONE transaction.
     *
     * The ordering is forced by the schema and is not a preference: the new row conflicts with the old row's
     * live-index slot, so the retirement must precede the insert; but `superseded_by` needs the new row's id,
     * so the link must follow it. Three statements, one transaction — outside one there is a window in which
     * the author has NO live mapping and a concurrent reader falls through to the global tier.
     *
     * @param request - The decision plus the row content it needs.
     * @param writer - An open transaction to enlist in; omitted, this opens its own.
     * @returns What was written, or `written: false` with the reason nothing was.
     * @sideEffect Updates and inserts into `ingredient_resolution_mappings`.
     */
    public async applyWrite(request: MappingWriteRequest, writer?: RecipeTx): Promise<MappingWriteResult> {
        if (writer !== undefined) {
            return this.applyWriteIn(request, writer);
        }

        return withTransaction(this.db, (tx) => this.applyWriteIn(request, tx));
    }

    /**
     * The body of {@link ResolutionMappingsDal.applyWrite}, always running inside a transaction.
     *
     * @param request - The decision plus the row content it needs.
     * @param tx - The open transaction.
     * @returns What was written.
     * @sideEffect Updates and inserts into `ingredient_resolution_mappings`.
     */
    private async applyWriteIn(request: MappingWriteRequest, tx: RecipeTx): Promise<MappingWriteResult> {
        const { decision } = request;

        if (decision.write === 'none') {
            // The policy's only `none` cases are both "the binding that applies to this caller already says
            // exactly this" — re-asserting it would mint a churn row and inflate the corroboration count.
            return { written: false, outcome: 'already_in_force', reason: decision.reason };
        }

        const retired = await this.retirePredecessor(decision, request.userId, tx);
        const mappingId = await this.insertMapping(request, decision.scope, decision.origin, tx);

        if (mappingId === undefined) {
            // Another writer holds the live slot this row needed. Nothing was retired that this write is
            // responsible for replacing (the retirement above is conditional on its own predicate), so the
            // honest answer is "somebody else got there", not an error thrown at a user fixing a recipe line.
            return {
                written: false,
                outcome: 'superseded',
                reason: 'Another correction for this phrase committed first.',
            };
        }

        if (retired !== undefined) {
            await tx.execute(sql`
                UPDATE ingredient_resolution_mappings SET superseded_by = ${mappingId} WHERE id = ${retired}
            `);
        }

        if (decision.write === 'author' && decision.promotion !== undefined) {
            const bindingId = await this.promoteByCorroboration(
                {
                    normalizedKey: request.normalizedKey,
                    foodId: request.foodId,
                    citesExisting: decision.promotion.citesExisting,
                    citesNew: mappingId,
                    supersedesGlobal: decision.promotion.supersedesGlobal,
                },
                tx,
            );

            if (bindingId !== undefined) {
                return {
                    written: true,
                    mappingId,
                    promotion: {
                        mappingId: bindingId,
                        citesExisting: decision.promotion.citesExisting,
                        citesNew: mappingId,
                    },
                };
            }
        }

        return { written: true, mappingId, promotion: undefined };
    }

    /**
     * Retire whatever this decision displaces, under the predicate that authorizes it.
     *
     * @param decision - The write decision naming what is displaced.
     * @param userId - The caller, which the author-scoped predicate matches on.
     * @param tx - The open transaction.
     * @returns The retired row's id, or `undefined` when nothing was retired.
     * @sideEffect Updates `ingredient_resolution_mappings`.
     */
    private async retirePredecessor(
        decision: Exclude<MappingWriteDecision, { write: 'none' }>,
        userId: string,
        tx: RecipeTx,
    ): Promise<string | undefined> {
        if (decision.supersedes === undefined) {
            return undefined;
        }

        if (decision.write === 'author') {
            return (await this.supersedeOwnMapping(decision.supersedes, userId, tx)) ? decision.supersedes : undefined;
        }

        // A curator retiring the global mapping in force. The predicate is `scope = 'global'` rather than a
        // user match: a grant holder outranks both a previous curator and a corroboration binding, and the
        // grant itself was checked by the policy that produced this decision.
        const result = await tx.execute<{ id: string }>(sql`
            UPDATE ingredient_resolution_mappings SET superseded_at = now()
            WHERE id = ${decision.supersedes} AND scope = 'global' AND superseded_at IS NULL
            RETURNING id
        `);

        return result.rows[0]?.id;
    }

    /**
     * Insert the mapping this decision creates.
     *
     * The `ON CONFLICT` target is spelled with the partial index's own predicate, which is how Postgres infers
     * a PARTIAL unique index. Getting it wrong does not fail loudly — it either matches no index (an error at
     * runtime) or, worse, a different one — so the two targets mirror `0021`'s index definitions verbatim.
     *
     * @param request - The row content.
     * @param scope - The reach the decision resolved to.
     * @param origin - The authority the decision resolved to.
     * @param tx - The open transaction.
     * @returns The new row's id, or `undefined` when another writer already holds the live slot.
     * @sideEffect Inserts into `ingredient_resolution_mappings`.
     */
    private async insertMapping(
        request: MappingWriteRequest,
        scope: MappingScope,
        origin: MappingOrigin,
        tx: RecipeTx,
    ): Promise<string | undefined> {
        const values = sql`
            (${request.normalizedKey}, ${request.sourcePhrase}, ${request.foodId}, ${scope}, ${origin},
             ${request.userId}, ${request.surfacing})
        `;
        const columns = sql`(normalized_key, source_phrase, food_id, scope, origin, user_id, surfacing)`;
        const conflict =
            scope === 'global'
                ? sql`(normalized_key) WHERE scope = 'global' AND superseded_at IS NULL`
                : sql`(normalized_key, user_id) WHERE scope = 'author' AND superseded_at IS NULL AND user_id IS NOT NULL`;

        const result = await tx.execute<{ id: string }>(sql`
            INSERT INTO ingredient_resolution_mappings ${columns}
            VALUES ${values}
            ON CONFLICT ${conflict} DO NOTHING
            RETURNING id
        `);

        return result.rows[0]?.id;
    }
}
