/**
 * `ParseCorrectionsDal` — every statement over the parse-correction tier (plan U21).
 *
 * DESIGN PATTERN: **Repository**, with the authorization pushed INTO the statements, and the deliberate twin
 * of `resolution/resolutionMappings.dal.ts`. It EXECUTES a {@link CorrectionScopeDecision}; it never makes
 * one. The rule lives in `domain/correctionScopePolicy.ts` (bound to this subject by
 * `domain/parseCorrectionPolicy.ts`), which is pure and exhaustible; what lives here is the SQL that carries
 * a decision out atomically.
 *
 * ## ⛔ Three `WHERE` clauses ARE the authorization, and none of them is a branch
 *
 * 1. **`user_id = :caller` inside the supersede `UPDATE`.** "An author-scoped correction is superseded only
 *    by the cook who made it" is not enforced by a check the caller could be trusted to run first — it is
 *    enforced by the statement matching nothing. **Zero rows returned IS the denial**, atomically, with no id
 *    a caller can pass that reaches somebody else's row. (An index cannot do this: superseding a row RELIEVES
 *    uniqueness rather than violating it, so indexes alone would leave the edit path wide open.)
 * 2. **`ON CONFLICT … DO NOTHING` on the promotion insert.** The concurrent-promotion race then has a LOSER,
 *    not an ERROR: the loser reads zero rows as "somebody else already promoted this", emits no audit signal,
 *    and does not fail the cook's correction.
 * 3. **`(scope = 'global' OR (:caller IS NOT NULL AND user_id = :caller))`.** An unattended import has no
 *    user, and must see global corrections and NOBODY's personal ones. Written with the explicit
 *    `IS NOT NULL` rather than relying on `user_id = NULL` evaluating to NULL, because the latter is correct
 *    and is a reviewer trap.
 *
 * ⚠️ DELIBERATE — `user_id` is a COUNTER and an AUTHORIZATION predicate, and it is deliberately NOT erasable.
 * It was spelled `owner_id` until migration 0033; read
 * `docs/architecture/decisions/0027-ingredient-phrase-is-not-personal-data.md` before "cleaning it up".
 *
 * ## ⛔ THE ANSWER'S IDENTITY IS POSTGRES', NOT THIS PROCESS'S
 *
 * "Do two cooks assert the same parse?" is answered by `jsonb` equality — the database sorts object keys and
 * normalizes numerics, so it already owns a canonical form. {@link ParseCorrectionsDal.findWriteFacts}
 * therefore projects `corrected_facts::text` for the stored rows and renders the caller's proposal through
 * the SAME `::jsonb::text` cast, and hands the policy two strings that came out of the same canonicalizer.
 *
 * ⚠️ CORRECTED — this used to say "in the SAME statement". It is the same TRANSACTION and the same cast, but
 * four statements: the `FOR UPDATE` lock read, a standalone `SELECT :proposal::jsonb::text`, and one read
 * each for the live global and the caller's own row. What the argument rests on is the shared CAST, not
 * statement count.
 *
 * That is not a convenience. A TypeScript-side comparison would be a SECOND derivation of an equality the
 * unique indexes already enforce, free to disagree with them — and the symptom would be silent: corroboration
 * would simply stop firing for parses whose producers happened to serialize keys in different orders, with
 * every unit test still green. `parseCorrectionsDal.integration.test.ts` fires a key-reordered parse at it
 * directly for exactly this reason.
 *
 * ## The Unit of Work is the CALLER's
 *
 * `findWriteFacts` → decide → `applyWrite` must be one transaction, or two concurrent correctors read the
 * same facts and both act on them. `findWriteFacts` therefore takes a row lock on every live correction for
 * the line (`FOR UPDATE`), which serialises correctors of the SAME line and leaves correctors of other lines
 * untouched. The one case the lock cannot cover is a line with no live rows to lock — two first-writers — and
 * that is exactly what the `ON CONFLICT DO NOTHING` clauses handle, with nothing retired to leave dangling.
 *
 * ## ⛔ NOTHING HERE READS INSIDE `corrected_facts`
 *
 * The payload is written, read back and compared by the database. That is why {@link CorrectedParse} is an
 * opaque JSON object rather than `ParsedFacts` imported from `@kitchensink/recipe-import-core` — see the
 * schema module for the full reasoning, and note the day a caller needs a field is the day the edge is worth
 * taking.
 */
import { sql } from 'drizzle-orm';
import type { NormalizedIngredientKey } from '@kitchensink/recipe-core/resolution/normalized-key';

import type { RecipeDrizzle } from '../../database/database.module.js';
import type { RecipeTx, Writer } from '../../database/unitOfWork.js';
import { withTransaction } from '../../database/unitOfWork.js';
import type { CorrectedParse } from '../../database/schema/ingredientParseCorrections.js';
import type {
    CorrectionOrigin,
    CorrectionScope,
    CorrectionScopeDecision,
    CorroboratingCorrection,
    LiveGlobalCorrection,
} from '../domain/correctionScopePolicy.js';

/** The correction in force for a line, for a given caller. */
export interface ParseCorrectionInForce {
    readonly id: string;
    /** The corrected parse this row asserts. */
    readonly facts: CorrectedParse;
    readonly scope: CorrectionScope;
    readonly origin: CorrectionOrigin;
}

/** The facts the scope policy decides from, read under the lock that makes acting on them safe. */
export interface ParseCorrectionWriteFacts {
    /**
     * The caller's proposed parse in PostgreSQL's canonical `jsonb` rendering.
     *
     * ⛔ Fed to the policy as `correctedAnswer`, so its comparisons run over the same canonical form as the
     * stored answers below. Deriving it in TypeScript instead is the drift this DAL's docstring warns about.
     */
    readonly canonicalAnswer: string;
    readonly liveGlobal: LiveGlobalCorrection | undefined;
    readonly liveOwn: { readonly id: string; readonly answer: string } | undefined;
    readonly corroboratorsForSameAnswer: readonly CorroboratingCorrection[];
}

/** Everything a write needs beyond the decision itself. */
export interface ParseCorrectionWriteRequest {
    /** The decision to execute. Produced by the policy; this DAL never derives one. */
    readonly decision: CorrectionScopeDecision;
    readonly normalizedKey: NormalizedIngredientKey;
    /** The raw line, persisted so a key-derivation change is a backfill rather than data loss. */
    readonly sourceLine: string;
    /** The corrected parse. Never the raw line — see {@link CorrectedParse}. */
    readonly correctedFacts: CorrectedParse;
    /** The cook making the correction — the row's counting key, and the supersede predicate. */
    readonly userId: string;
    /** Which affordance produced the correction. */
    readonly surfacing: string;
}

/** A promotion that actually happened — the audit payload, carrying what the durable row records. */
export interface ParsePromotionRecord {
    /** The corroboration binding's row id. */
    readonly correctionId: string;
    /** The pre-existing corroborating correction it cites. */
    readonly citesExisting: string;
    /** The correction this write created, cited alongside it. */
    readonly citesNew: string;
}

/**
 * Why a write decision produced no row.
 *
 * A CLOSED SET beside the prose `reason`: the prose is written for a reviewer reading the module and is free
 * to change, and a caller cannot branch on a sentence. `already_in_force` is the idempotent case the policy
 * decides; `superseded` is the concurrent-writer race this DAL discovers. Neither is an error.
 */
export type ParseCorrectionNoOutcome = 'already_in_force' | 'superseded';

/** The result of executing a write decision. */
export type ParseCorrectionWriteResult =
    | { readonly written: false; readonly outcome: ParseCorrectionNoOutcome; readonly reason: string }
    | {
          readonly written: true;
          /** The row this write created. */
          readonly correctionId: string;
          /** The corroboration binding this write earned, or `undefined` when it earned none. */
          readonly promotion: ParsePromotionRecord | undefined;
      };

/** The raw shape of a correction row as projected by this DAL's reads. */
interface RawCorrectionRow {
    [column: string]: unknown;
    id: string;
    corrected_facts: CorrectedParse;
    answer: string;
    scope: string;
    origin: string;
}

/** The raw shape of a corroborator projection. */
interface RawCorroboratorRow {
    [column: string]: unknown;
    id: string;
    user_id: string;
}

export class ParseCorrectionsDal {
    public constructor(private readonly db: RecipeDrizzle) {}

    /**
     * Run `fn` as ONE transaction over this DAL's database.
     *
     * Exposed here rather than leaving the caller to reach for `withTransaction` itself, because the Unit of
     * Work is a property of THIS repository's statements: `findWriteFacts` takes a `FOR UPDATE` row lock that
     * is worth nothing unless the decision and the write it feeds happen before the transaction ends.
     *
     * @param fn - The work to run inside the transaction.
     * @returns Whatever `fn` returns.
     * @sideEffect Opens a transaction; every write `fn` performs commits or rolls back together.
     */
    public async runInTransaction<T>(fn: (tx: RecipeTx) => Promise<T>): Promise<T> {
        return withTransaction(this.db, fn);
    }

    /**
     * THE TIER'S READ: the correction in force for this line, for this caller.
     *
     * Precedence is the caller's OWN correction, then the global one — expressed as a sort key rather than
     * two queries so the answer comes from one indexed read and cannot disagree with itself. `created_at
     * DESC` breaks a tie the partial unique indexes already make unreachable, and `id DESC` breaks the tie
     * `created_at` cannot: two rows written inside one `timestamptz` tick would otherwise order arbitrarily.
     *
     * ⛔ Consulted BEFORE the parse cache and before either engine (KTD-15). A correction that lost to a
     * cached machine parse would be a correction that does nothing.
     *
     * @param normalizedKey - The line's match grain.
     * @param userId - The requesting cook, or `undefined` for an unattended import — which sees global
     *   corrections and nobody's personal ones.
     * @returns The correction in force, or `undefined` when nothing binds this line for this caller.
     * @sideEffect Reads `ingredient_parse_corrections`.
     */
    public async findInForce(
        normalizedKey: NormalizedIngredientKey,
        userId: string | undefined,
    ): Promise<ParseCorrectionInForce | undefined> {
        const caller = userId ?? null;
        const result = await this.db.execute<RawCorrectionRow>(sql`
            SELECT id, corrected_facts, corrected_facts::text AS answer, scope, origin
            FROM ingredient_parse_corrections
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
                  facts: row.corrected_facts,
                  scope: row.scope as CorrectionScope,
                  origin: row.origin as CorrectionOrigin,
              };
    }

    /**
     * Read the facts the scope policy decides from, LOCKING every live correction for the line.
     *
     * ⛔ The lock is the point. Without it, two cooks correcting the same line concurrently both read "nobody
     * else agrees" and both write an author-scoped correction, so the second one's promotion never fires — a
     * corroboration silently lost. `FOR UPDATE` serialises correctors of the SAME line and leaves every other
     * line untouched. It is a no-op for a line with no live rows, which is why the write statements still
     * carry `ON CONFLICT DO NOTHING`.
     *
     * @param normalizedKey - The line's match grain.
     * @param userId - The correcting cook.
     * @param correctedFacts - The parse being corrected TO — corroboration is agreement on the ANSWER, not
     *   merely on the line being wrong, so the corroborator query filters on it.
     * @param writer - The open transaction. Required in practice: reading these facts outside the transaction
     *   that acts on them discards the lock's guarantee.
     * @returns The canonical rendering of the proposal, the live global correction, the caller's own, and the
     *   other cooks who already agree.
     * @sideEffect Reads and ROW-LOCKS `ingredient_parse_corrections` until the transaction ends.
     */
    public async findWriteFacts(
        normalizedKey: NormalizedIngredientKey,
        userId: string,
        correctedFacts: CorrectedParse,
        writer: Writer = this.db,
    ): Promise<ParseCorrectionWriteFacts> {
        const proposal = JSON.stringify(correctedFacts);

        await writer.execute(sql`
            SELECT id FROM ingredient_parse_corrections
            WHERE normalized_key = ${normalizedKey} AND superseded_at IS NULL
            FOR UPDATE
        `);

        // ⛔ The proposal's canonical form comes from the SAME `jsonb` cast the stored answers do, so the
        // policy's `===` compares like with like. Rendering it in Node would be a second canonicalization.
        const canonical = await writer.execute<{ answer: string }>(sql`SELECT ${proposal}::jsonb::text AS answer`);
        const canonicalAnswer = canonical.rows[0]?.answer ?? proposal;

        const globalRows = await writer.execute<RawCorrectionRow>(sql`
            SELECT id, corrected_facts, corrected_facts::text AS answer, scope, origin
            FROM ingredient_parse_corrections
            WHERE normalized_key = ${normalizedKey} AND scope = 'global' AND superseded_at IS NULL
            LIMIT 1
        `);
        const ownRows = await writer.execute<RawCorrectionRow>(sql`
            SELECT id, corrected_facts, corrected_facts::text AS answer, scope, origin
            FROM ingredient_parse_corrections
            WHERE normalized_key = ${normalizedKey} AND scope = 'author' AND user_id = ${userId}
              AND superseded_at IS NULL
            LIMIT 1
        `);
        // ⛔ `user_id <> ${userId}` is what makes "the same cook correcting twice does not promote" a
        // property of the SET the policy receives rather than a rule the policy has to remember. It is the
        // DISTINCT half of the distinct-user count; the partial unique index is the other half.
        const corroboratorRows = await writer.execute<RawCorroboratorRow>(sql`
            SELECT id, user_id FROM ingredient_parse_corrections
            WHERE normalized_key = ${normalizedKey} AND scope = 'author'
              AND corrected_facts = ${proposal}::jsonb
              AND superseded_at IS NULL AND user_id IS NOT NULL AND user_id <> ${userId}
            ORDER BY created_at, id
        `);

        const liveGlobal = globalRows.rows[0];
        const liveOwn = ownRows.rows[0];

        return {
            canonicalAnswer,
            liveGlobal:
                liveGlobal === undefined
                    ? undefined
                    : {
                          id: liveGlobal.id,
                          answer: liveGlobal.answer,
                          origin: liveGlobal.origin as Exclude<CorrectionOrigin, 'author'>,
                      },
            liveOwn: liveOwn === undefined ? undefined : { id: liveOwn.id, answer: liveOwn.answer },
            corroboratorsForSameAnswer: corroboratorRows.rows.map((row) => ({ id: row.id, userId: row.user_id })),
        };
    }

    /**
     * Retire a correction — **only if the caller made it**.
     *
     * ⛔ THE AUTHORIZATION IS THE `user_id` PREDICATE, not a check performed before calling this. A caller
     * holding another cook's row id retires nothing: the statement matches no row, and zero rows IS the
     * denial. Exposed as its own method so that property is directly testable rather than only observable
     * through a successful write.
     *
     * @param correctionId - The row to retire.
     * @param userId - The caller, which must be the row's own cook.
     * @param writer - The open transaction, when enlisted in one.
     * @returns `true` when a row was retired, `false` when the caller had no standing to retire it.
     * @sideEffect Updates `ingredient_parse_corrections`.
     */
    public async supersedeOwnCorrection(
        correctionId: string,
        userId: string,
        writer: Writer = this.db,
    ): Promise<boolean> {
        const result = await writer.execute<{ id: string }>(sql`
            UPDATE ingredient_parse_corrections SET superseded_at = now()
            WHERE id = ${correctionId} AND scope = 'author' AND user_id = ${userId} AND superseded_at IS NULL
            RETURNING id
        `);

        return result.rows.length > 0;
    }

    /**
     * Insert the corroboration binding two agreeing cooks have earned.
     *
     * ⛔ A NEW ROW, never a flip of an existing one. Flipping a cook's row to global would rewrite the meaning
     * of a record its author authored: the row would claim global authority attributed to someone who never
     * asserted it, carrying a `surfacing` that is not what caused the promotion, and it would silently
     * destroy that cook's own personal correction.
     *
     * ⛔ The binding carries NEITHER `user_id` NOR `source_line`, and that survived a reversal. The 2026-08-25
     * owner ruling (ADR-0027) repealed 0029's pair CHECK and the privacy argument behind it, but the OTHER
     * argument stands on its own: the copy buys nothing, because the binding CITES two rows that each carry
     * their own line, so a key-derivation backfill runs through `corroborated_a` either way. The curated tier
     * follows the identical rule.
     *
     * `ON CONFLICT DO NOTHING` on the corroboration-pair index makes the concurrent race safe: **the loser
     * gets zero rows and reads that as "somebody else already promoted this"** — no audit signal, no error,
     * and no failure of the cook's own correction, which stands on its own regardless.
     *
     * @param input - The line, the agreed parse, and the two corrections the binding cites.
     * @param writer - The open transaction, when enlisted in one.
     * @returns The binding's row id, or `undefined` when another writer had already promoted this pair.
     * @sideEffect Updates and inserts into `ingredient_parse_corrections`.
     */
    public async promoteByCorroboration(
        input: {
            readonly normalizedKey: NormalizedIngredientKey;
            readonly correctedFacts: CorrectedParse;
            readonly citesExisting: string;
            readonly citesNew: string;
            readonly supersedesGlobal: string | undefined;
        },
        writer: Writer = this.db,
    ): Promise<string | undefined> {
        if (input.supersedesGlobal !== undefined) {
            await writer.execute(sql`
                UPDATE ingredient_parse_corrections SET superseded_at = now()
                WHERE id = ${input.supersedesGlobal} AND scope = 'global' AND superseded_at IS NULL
            `);
        }

        // The pair is stored in a stable order so two writers reaching this with the same two corrections in
        // opposite argument order still collide on the unique index rather than both inserting.
        const [first, second] = [input.citesExisting, input.citesNew].sort();
        const inserted = await writer.execute<{ id: string }>(sql`
            INSERT INTO ingredient_parse_corrections
                (normalized_key, source_line, corrected_facts, scope, origin, user_id, surfacing,
                 corroborated_a, corroborated_b)
            VALUES (${input.normalizedKey}, NULL, ${JSON.stringify(input.correctedFacts)}::jsonb, 'global',
                    'corroboration', NULL, 'corroboration', ${first}, ${second})
            ON CONFLICT (corroborated_a, corroborated_b) WHERE origin = 'corroboration' DO NOTHING
            RETURNING id
        `);

        return inserted.rows[0]?.id;
    }

    /**
     * Execute a write decision as ONE transaction.
     *
     * The ordering is forced by the schema and is not a preference: the new row conflicts with the old row's
     * live-index slot, so the retirement must precede the insert; but `superseded_by` needs the new row's id,
     * so the link must follow it. Outside one transaction there is a window in which the cook has NO live
     * correction and a concurrent reader falls through to the global tier.
     *
     * @param request - The decision plus the row content it needs.
     * @param writer - An open transaction to enlist in; omitted, this opens its own.
     * @returns What was written, or `written: false` with the reason nothing was.
     * @sideEffect Updates and inserts into `ingredient_parse_corrections`.
     */
    public async applyWrite(
        request: ParseCorrectionWriteRequest,
        writer?: RecipeTx,
    ): Promise<ParseCorrectionWriteResult> {
        if (writer !== undefined) {
            return this.applyWriteIn(request, writer);
        }

        return withTransaction(this.db, (tx) => this.applyWriteIn(request, tx));
    }

    /**
     * The body of {@link ParseCorrectionsDal.applyWrite}, always running inside a transaction.
     *
     * @param request - The decision plus the row content it needs.
     * @param tx - The open transaction.
     * @returns What was written.
     * @sideEffect Updates and inserts into `ingredient_parse_corrections`.
     */
    private async applyWriteIn(
        request: ParseCorrectionWriteRequest,
        tx: RecipeTx,
    ): Promise<ParseCorrectionWriteResult> {
        const { decision } = request;

        if (decision.write === 'none') {
            // Both of the policy's `none` cases are "the binding that applies to this caller already says
            // exactly this" — re-asserting it would mint a churn row and inflate the corroboration count.
            return { written: false, outcome: 'already_in_force', reason: decision.reason };
        }

        const retired = await this.retirePredecessor(decision, request.userId, tx);
        const correctionId = await this.insertCorrection(request, decision.scope, decision.origin, tx);

        if (correctionId === undefined) {
            // Another writer holds the live slot this row needed. Nothing was retired that this write is
            // responsible for replacing (the retirement above is conditional on its own predicate), so the
            // honest answer is "somebody else got there", not an error thrown at a cook fixing a line.
            return {
                written: false,
                outcome: 'superseded',
                reason: 'Another correction for this line committed first.',
            };
        }

        if (retired !== undefined) {
            await tx.execute(sql`
                UPDATE ingredient_parse_corrections SET superseded_by = ${correctionId} WHERE id = ${retired}
            `);
        }

        if (decision.write === 'author' && decision.promotion !== undefined) {
            const bindingId = await this.promoteByCorroboration(
                {
                    normalizedKey: request.normalizedKey,
                    correctedFacts: request.correctedFacts,
                    citesExisting: decision.promotion.citesExisting,
                    citesNew: correctionId,
                    supersedesGlobal: decision.promotion.supersedesGlobal,
                },
                tx,
            );

            if (bindingId !== undefined) {
                return {
                    written: true,
                    correctionId,
                    promotion: {
                        correctionId: bindingId,
                        citesExisting: decision.promotion.citesExisting,
                        citesNew: correctionId,
                    },
                };
            }
        }

        return { written: true, correctionId, promotion: undefined };
    }

    /**
     * Retire whatever this decision displaces, under the predicate that authorizes it.
     *
     * @param decision - The write decision naming what is displaced.
     * @param userId - The caller, which the author-scoped predicate matches on.
     * @param tx - The open transaction.
     * @returns The retired row's id, or `undefined` when nothing was retired.
     * @sideEffect Updates `ingredient_parse_corrections`.
     */
    private async retirePredecessor(
        decision: Exclude<CorrectionScopeDecision, { write: 'none' }>,
        userId: string,
        tx: RecipeTx,
    ): Promise<string | undefined> {
        if (decision.supersedes === undefined) {
            return undefined;
        }

        if (decision.write === 'author') {
            return (await this.supersedeOwnCorrection(decision.supersedes, userId, tx))
                ? decision.supersedes
                : undefined;
        }

        // A curator retiring the global correction in force. The predicate is `scope = 'global'` rather than
        // an owner match: a grant holder outranks both a previous curator and a corroboration binding, and
        // the grant itself was checked by the policy that produced this decision.
        const result = await tx.execute<{ id: string }>(sql`
            UPDATE ingredient_parse_corrections SET superseded_at = now()
            WHERE id = ${decision.supersedes} AND scope = 'global' AND superseded_at IS NULL
            RETURNING id
        `);

        return result.rows[0]?.id;
    }

    /**
     * Insert the correction this decision creates.
     *
     * The `ON CONFLICT` target is spelled with the partial index's own predicate, which is how Postgres infers
     * a PARTIAL unique index. Getting it wrong does not fail loudly — it either matches no index (an error at
     * runtime) or, worse, a different one — so the two targets mirror the index definitions IN FORCE
     * verbatim: `0029`'s for the global slot, and `0029`'s author slot AS RENAMED BY `0033`
     * (`owner_id` → `user_id`, index `idx_parse_corrections_live_owner` → `…_live_user`). ⚠️ CORRECTED —
     * this said "mirror `0029`'s definitions verbatim", which the author target has not done since 0033;
     * against 0029's literal text it would infer no index at all.
     *
     * @param request - The row content.
     * @param scope - The reach the decision resolved to.
     * @param origin - The authority the decision resolved to.
     * @param tx - The open transaction.
     * @returns The new row's id, or `undefined` when another writer already holds the live slot.
     * @sideEffect Inserts into `ingredient_parse_corrections`.
     */
    private async insertCorrection(
        request: ParseCorrectionWriteRequest,
        scope: CorrectionScope,
        origin: CorrectionOrigin,
        tx: RecipeTx,
    ): Promise<string | undefined> {
        const columns = sql`(normalized_key, source_line, corrected_facts, scope, origin, user_id, surfacing)`;
        const values = sql`
            (${request.normalizedKey}, ${request.sourceLine}, ${JSON.stringify(request.correctedFacts)}::jsonb,
             ${scope}, ${origin}, ${request.userId}, ${request.surfacing})
        `;
        const conflict =
            scope === 'global'
                ? sql`(normalized_key) WHERE scope = 'global' AND superseded_at IS NULL`
                : sql`(normalized_key, user_id) WHERE scope = 'author' AND superseded_at IS NULL AND user_id IS NOT NULL`;

        const result = await tx.execute<{ id: string }>(sql`
            INSERT INTO ingredient_parse_corrections ${columns}
            VALUES ${values}
            ON CONFLICT ${conflict} DO NOTHING
            RETURNING id
        `);

        return result.rows[0]?.id;
    }
}
