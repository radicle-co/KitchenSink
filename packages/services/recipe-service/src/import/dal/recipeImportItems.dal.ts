/**
 * `RecipeImportItemsDal` (ADR-0072 §2, §3, §8) — the SQL truth behind a bulk import's ITEMS: one row per recipe the client
 * sent, its stage, the unit it paid, the parse job it holds, the recipe it saved, and what the cook said about it.
 *
 * @pattern Repository over the shared Drizzle client. The rules that make `advance` safe to repeat live in the SQL:
 *
 *  1. **A request is all or nothing.** `upsertItems` locks the import's header, decides every item first
 *     (`decideItemUpsert`) and writes only if none is refused, so one locked item rolls the whole chunk back by never
 *     starting it. The header lock also serialises two chunks inserting the same new ordinal.
 *  2. **Paying is `SELECT … FOR UPDATE` of the unpaid items, THEN the allowance lock, THEN a mark of exactly the admitted
 *     items.** Two concurrent calls cannot pay one item twice (the second waits on the row, then re-reads it as paid), and the
 *     units spent are the units marked. A REFUSED recipe (no ingredient line or no step, `refusal`) is never charged, parsed or
 *     saved: the refusal is a stored fact set when the item is written, and every query that moves an item forward leaves it out.
 *  3. **Each step is a compare-and-swap on the state it leaves** (`attachJob` on the generation, `snapshot` on `parsing`,
 *     `claimSave` on `matched` and `saved_at IS NULL`): zero rows IS "someone else did it", and a repeated step writes nothing.
 *  4. **The save claim joins the recipe's own transaction** (`claimSave(tx, …)`), so the claim and the recipe commit or vanish
 *     together and a second save finds zero rows.
 *  5. **`saved_at` and `allowance_spent_at` are facts of their own**; nothing here infers either from `recipe_id` or
 *     `parse_job_id`.
 */
import { and, asc, eq, gt, inArray, isNotNull, isNull, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { isDeepStrictEqual } from 'node:util';

import { ImportAllowanceDal } from '../../common/dal/importAllowance.dal.js';
import type { RecipeDrizzle } from '../../database/client.js';
import {
    IMPORT_REFUSALS,
    IMPORT_STAGES,
    IMPORT_VISIBILITIES,
    recipeImportItems,
    recipeImportLines,
    type ImportStage,
    type RecipeImportItemRow,
} from '../../database/schema/recipeImports.js';
import type { RecipeTx } from '../../database/unitOfWork.js';
import type { ImportRecipe, ImportStatement } from '../../recipes/import.schema.js';
import { ITEM_REVIEWS, type ItemReview } from '../domain/importBindingPolicy.js';
import { decideItemUpsert } from '../domain/importItemUpsert.js';
import { HOLD_REASONS, type HoldReason, type ImportHold } from '../domain/importHold.js';
import { importRefusalOf, type ImportRefusal } from '../domain/importRefusal.js';
import type { ImportFileFacts } from '../domain/importSaveGap.js';
import { columnsOfStatement } from '../domain/importStatement.js';
import { lockImportHeader } from './importLocks.js';
import { ImportItemAlreadyClaimedError, ImportItemChangedError } from './recipeImportItems.errors.js';
import { touchImport, type ImportVisibility } from './recipeImports.dal.js';
import type { NewImportLine } from './recipeImportLines.dal.js';

/** One item as the DAL returns it, with its stage, review mark and visibility narrowed to the CHECK vocabularies. */
export type ImportItem = Omit<RecipeImportItemRow, 'stage' | 'review' | 'visibility' | 'refusal' | 'heldReason'> & {
    readonly stage: ImportStage;
    readonly review: ItemReview;
    readonly visibility: ImportVisibility | null;
    /** Why the import refuses the recipe, or `null` (set when the item is written). */
    readonly refusal: ImportRefusal | null;
    /** Why the save held the item, or `null` (never held, or held before reasons were recorded). */
    readonly heldReason: HoldReason | null;
};

/** One item of a request. */
export interface UpsertItemInput {
    readonly ordinal: number;
    readonly recipe: ImportRecipe;
    /** ABSENT keeps what the item holds; PRESENT replaces it. */
    readonly statement?: ImportStatement;
    readonly visibility?: ImportVisibility;
}

/** What a request answers. */
export type UpsertOutcome =
    | { readonly kind: 'ok' }
    | { readonly kind: 'locked'; readonly ordinal: number; readonly stage: 'parsing' | 'matched' }
    | { readonly kind: 'saved'; readonly ordinal: number };

/** What the cook says about one item. `undefined` keeps, a value replaces; `visibility: null` clears the recipe's own choice. */
export interface ChoicesPatch {
    readonly statement?: ImportStatement;
    readonly visibility?: ImportVisibility | null;
    /** The cuisine the save uses, replacing the file's (ADR-0072 §3 as amended 2026-11-11). */
    readonly cuisine?: string;
    /** The servings the save uses, replacing the file's. */
    readonly servings?: number;
    /** The prep minutes the save uses, replacing the file's. */
    readonly prepTimeMinutes?: number;
    /** The cook minutes the save uses, replacing the file's. */
    readonly cookTimeMinutes?: number;
}

/** What the save needs, as the payload states it, read in SQL so the item list needs no document. */
export interface ItemSaveFacts {
    readonly file: ImportFileFacts;
    readonly ingredientLineCount: number;
    readonly stepCount: number;
}

/** One item of the list: no payload, and what the save needs read out of it. */
export type ListedImportItem = ImportItem & { readonly saveFacts: ItemSaveFacts };

/** What paying answers. */
export type PayOutcome =
    /** These items spent a unit. (Fewer than asked when the day's room ran short; the rest waits.) */
    | { readonly kind: 'paid'; readonly ordinals: readonly number[] }
    /** Nothing was unpaid. */
    | { readonly kind: 'nothing' }
    /** The allowance is spent: nothing was paid, and more room opens at `resetsAt`. */
    | { readonly kind: 'refused'; readonly resetsAt: Date };

/** The item row, narrowed. A value the CHECK should have kept out is a defect and is thrown. */
function toItem(row: RecipeImportItemRow): ImportItem {
    const stage = IMPORT_STAGES.find((value) => value === row.stage);
    const review = ITEM_REVIEWS.find((value) => value === row.review);
    const visibility = row.visibility === null ? null : IMPORT_VISIBILITIES.find((value) => value === row.visibility);
    const refusal = row.refusal === null ? null : IMPORT_REFUSALS.find((value) => value === row.refusal);
    const heldReason = row.heldReason === null ? null : HOLD_REASONS.find((value) => value === row.heldReason);

    if (
        stage === undefined ||
        review === undefined ||
        visibility === undefined ||
        refusal === undefined ||
        heldReason === undefined
    ) {
        throw new Error(
            `recipe_import_items ${row.importId}/${String(row.ordinal)} holds a value this build does not know`,
        );
    }

    return { ...row, stage, review, visibility, refusal, heldReason };
}

/** The columns a request's statement, when it has one, writes. Pure. */
function statementPatch(statement: ImportStatement | undefined) {
    if (statement === undefined) {
        return {};
    }

    const columns = columnsOfStatement(statement);

    return { statementKind: columns.statementKind, citation: columns.citation, sourceKind: columns.sourceKind };
}

/**
 * The item columns a cook's choices write: ONLY the ones the entry names, each replacing what the item holds. The ONE list of
 * what a choice can change, used by the upload (statement and visibility) and the wizard (all of them). Pure.
 */
function choicesColumnsOf(entry: ChoicesPatch) {
    return {
        ...statementPatch(entry.statement),
        ...(entry.visibility === undefined ? {} : { visibility: entry.visibility }),
        ...(entry.cuisine === undefined ? {} : { cuisine: entry.cuisine }),
        ...(entry.servings === undefined ? {} : { servings: entry.servings }),
        ...(entry.prepTimeMinutes === undefined ? {} : { prepTimeMinutes: entry.prepTimeMinutes }),
        ...(entry.cookTimeMinutes === undefined ? {} : { cookTimeMinutes: entry.cookTimeMinutes }),
    };
}

/** Moves the fence: written by every write of what an item is saved from (see `decision_rev` in migration 0059). */
const BUMP_DECISION_REV = { decisionRev: sql`${recipeImportItems.decisionRev} + 1` } as const;

/**
 * The ingredient-line count a payload holds, in SQL. The ONE statement of it: the item list counts with it. Takes the payload
 * column so a query that aliases the table can use it.
 */
const lineCountOf = (payload: SQLWrapper): SQL<number> =>
    sql<number>`jsonb_array_length(COALESCE(${payload} -> 'ingredientLines', '[]'::jsonb))`;

/** An integer a payload states, read in SQL: `NULL` when it states none (the contract admitted it as an int4). */
const payloadInt = (key: string) => sql<number | null>`(${recipeImportItems.payload} ->> ${key})::int`;

export class RecipeImportItemsDal {
    public constructor(
        private readonly db: RecipeDrizzle,
        private readonly allowance: ImportAllowanceDal,
    ) {}

    /**
     * Insert, keep, replace or refuse every item of a request, all or nothing.
     *
     * @param importId - The import (already known to be the caller's).
     * @param inputs - The items, with distinct ordinals.
     * @returns `ok`, or the first item that is locked or saved, with NOTHING of the request written.
     * @sideEffect Locks the header, writes items and the activity clock.
     */
    public async upsertItems(importId: string, inputs: readonly UpsertItemInput[]): Promise<UpsertOutcome> {
        return this.db.transaction(async (tx): Promise<UpsertOutcome> => {
            // Serialises two chunks that name one new ordinal; the PK would otherwise answer the second with a 23505.
            await lockImportHeader(tx, importId);

            const held = await tx
                .select()
                .from(recipeImportItems)
                .where(
                    and(
                        eq(recipeImportItems.importId, importId),
                        inArray(
                            recipeImportItems.ordinal,
                            inputs.map((input) => input.ordinal),
                        ),
                    ),
                )
                .for('update');
            const byOrdinal = new Map(held.map((row) => [row.ordinal, toItem(row)] as const));
            const decisions = inputs.map((input) => {
                const existing = byOrdinal.get(input.ordinal);

                return {
                    input,
                    decision: decideItemUpsert({
                        existing:
                            existing === undefined ? undefined : { stage: existing.stage, payload: existing.payload },
                        recipe: input.recipe,
                    }),
                };
            });

            for (const { input, decision } of decisions) {
                if (decision.kind === 'locked') {
                    return { kind: 'locked', ordinal: input.ordinal, stage: decision.stage };
                }

                if (decision.kind === 'saved') {
                    return { kind: 'saved', ordinal: input.ordinal };
                }
            }

            for (const { input, decision } of decisions) {
                const patch = choicesColumnsOf(input);

                if (decision.kind === 'insert') {
                    await tx.insert(recipeImportItems).values({
                        importId,
                        ordinal: input.ordinal,
                        title: input.recipe.title,
                        payload: input.recipe,
                        refusal: importRefusalOf({
                            ingredientLineCount: input.recipe.ingredientLines.length,
                            stepCount: input.recipe.steps.length,
                        }),
                        ...patch,
                    });
                } else if (decision.kind === 'replace') {
                    await tx
                        .update(recipeImportItems)
                        .set({
                            title: input.recipe.title,
                            payload: input.recipe,
                            // A fixed recipe clears the refusal; an emptied one sets it (the unit a paid item spent stays spent).
                            refusal: importRefusalOf({
                                ingredientLineCount: input.recipe.ingredientLines.length,
                                stepCount: input.recipe.steps.length,
                            }),
                            ...patch,
                            ...BUMP_DECISION_REV,
                            // A new recipe needs a new parse job. The job id is derived from the generation, and a paid item
                            // can hold a job created just before a crash and never attached, made from the OLD text.
                            parseGeneration: sql`${recipeImportItems.parseGeneration} + 1`,
                            updatedAt: sql`now()`,
                        })
                        .where(
                            and(eq(recipeImportItems.importId, importId), eq(recipeImportItems.ordinal, input.ordinal)),
                        );
                } else if (Object.keys(patch).length > 0 && !isNoopPatch(byOrdinal.get(input.ordinal), patch)) {
                    await tx
                        .update(recipeImportItems)
                        .set({ ...patch, ...BUMP_DECISION_REV, updatedAt: sql`now()` })
                        .where(
                            and(eq(recipeImportItems.importId, importId), eq(recipeImportItems.ordinal, input.ordinal)),
                        );
                }
            }

            await touchImport(tx, importId);

            return { kind: 'ok' };
        });
    }

    /** One item, payload included, or `undefined`. @sideEffect Reads. */
    public async findItem(importId: string, ordinal: number): Promise<ImportItem | undefined> {
        const [row] = await this.db
            .select()
            .from(recipeImportItems)
            .where(and(eq(recipeImportItems.importId, importId), eq(recipeImportItems.ordinal, ordinal)));

        return row === undefined ? undefined : toItem(row);
    }

    /**
     * A page of items by ordinal, WITHOUT their payloads (the list shows a title, not a document).
     *
     * @param after - Items with an ordinal greater than this; omit for the first page.
     * @sideEffect Reads.
     */
    public async findPage(importId: string, after: number | undefined, limit: number): Promise<ListedImportItem[]> {
        const rows = await this.db
            .select({
                ...itemColumnsWithoutPayload(),
                fileCuisine: sql<string | null>`${recipeImportItems.payload} ->> 'cuisine'`,
                fileServings: payloadInt('servings'),
                filePrepTimeMinutes: payloadInt('prepTimeMinutes'),
                fileCookTimeMinutes: payloadInt('cookTimeMinutes'),
                fileTotalTimeMinutes: payloadInt('totalTimeMinutes'),
                ingredientLineCount: lineCountOf(recipeImportItems.payload).mapWith(Number),
                stepCount:
                    sql<number>`jsonb_array_length(COALESCE(${recipeImportItems.payload} -> 'steps', '[]'::jsonb))`.mapWith(
                        Number,
                    ),
            })
            .from(recipeImportItems)
            .where(
                and(
                    eq(recipeImportItems.importId, importId),
                    after === undefined ? undefined : gt(recipeImportItems.ordinal, after),
                ),
            )
            .orderBy(asc(recipeImportItems.ordinal))
            .limit(limit);

        return rows.map(
            ({
                fileCuisine,
                fileServings,
                filePrepTimeMinutes,
                fileCookTimeMinutes,
                fileTotalTimeMinutes,
                ingredientLineCount,
                stepCount,
                ...row
            }) => ({
                ...toItem({ ...row, payload: null }),
                saveFacts: {
                    file: {
                        cuisine: fileCuisine,
                        servings: fileServings,
                        prepTimeMinutes: filePrepTimeMinutes,
                        cookTimeMinutes: fileCookTimeMinutes,
                        totalTimeMinutes: fileTotalTimeMinutes,
                    },
                    ingredientLineCount,
                    stepCount,
                },
            }),
        );
    }

    /**
     * The items at these stages, oldest ordinal first, optionally with their payloads (the parse step needs the lines).
     *
     * @sideEffect Reads.
     */
    public async findByStage(
        importId: string,
        stages: readonly ImportStage[],
        limit: number,
        options: { readonly withPayload: boolean },
    ): Promise<ImportItem[]> {
        const where = and(eq(recipeImportItems.importId, importId), inArray(recipeImportItems.stage, [...stages]));
        const order = asc(recipeImportItems.ordinal);

        if (options.withPayload) {
            return (await this.db.select().from(recipeImportItems).where(where).orderBy(order).limit(limit)).map(
                toItem,
            );
        }

        const rows = await this.db
            .select({ ...itemColumnsWithoutPayload() })
            .from(recipeImportItems)
            .where(where)
            .orderBy(order)
            .limit(limit);

        return rows.map((row) => toItem({ ...row, payload: null }));
    }

    /**
     * The items that can be given a parse job NOW: still received or parsing, holding no job, and paid. An unpaid item is NOT
     * here (it waits for the allowance), and neither is a REFUSED one (it is never parsed) or one that already holds a job.
     *
     * ⛔ Selected in SQL rather than filtered from a page of everything, so an import with a thousand items already in flight
     * does not starve the ones that are ready for a job (head-of-line blocking). LEAST RECENTLY LOOKED AT first, with
     * {@link deferItem} to send one that could not start to the back, so a start that keeps failing does not hold the front.
     *
     * @sideEffect Reads.
     */
    public async findNeedingJob(importId: string, limit: number): Promise<ImportItem[]> {
        return (
            await this.db
                .select()
                .from(recipeImportItems)
                .where(
                    and(
                        eq(recipeImportItems.importId, importId),
                        inArray(recipeImportItems.stage, ['received', 'parsing']),
                        isNull(recipeImportItems.parseJobId),
                        isNull(recipeImportItems.refusal),
                        isNotNull(recipeImportItems.allowanceSpentAt),
                    ),
                )
                .orderBy(asc(recipeImportItems.updatedAt), asc(recipeImportItems.ordinal))
                .limit(limit)
        ).map(toItem);
    }

    /**
     * The items that hold a parse job and are not matched yet, least recently looked at first, without payloads.
     *
     * ⛔ Ordered by `updated_at`, with {@link deferItem} to send a job that has not landed to the back: jobs that stay `running`
     * (the worker is stuck) or `partial` (waiting on a retry) would otherwise stay at the front of every call and hold every
     * later item out of matching until the job's 24-hour TTL.
     *
     * @sideEffect Reads.
     */
    public async findParsing(importId: string, limit: number): Promise<ImportItem[]> {
        const rows = await this.db
            .select({ ...itemColumnsWithoutPayload() })
            .from(recipeImportItems)
            .where(
                and(
                    eq(recipeImportItems.importId, importId),
                    eq(recipeImportItems.stage, 'parsing'),
                    isNotNull(recipeImportItems.parseJobId),
                ),
            )
            .orderBy(asc(recipeImportItems.updatedAt), asc(recipeImportItems.ordinal))
            .limit(limit);

        return rows.map((row) => toItem({ ...row, payload: null }));
    }

    /**
     * The matched items worth trying to save: those the cook has said where the recipe came from (an item cannot be saved
     * without), LEAST RECENTLY LOOKED AT first. Payloads included (the save builds the recipe from it).
     *
     * ⛔ An item whose hold still APPLIES to this cook is left out ({@link holdItem}, `holdApplies`): looking at it again would
     * re-queue it forever for nothing. A hold applies at the current revision, and for a cause the cook's facts decide (the
     * label, a create refusal) only under the facts it was judged under, so an upgrade or a containment change brings the
     * item back with no decision (review M1 on #220). `IS NOT DISTINCT FROM`: an item never held has a NULL hold.
     *
     * @param cookKey - The asking cook's facts (`cookKeyOf`).
     *
     * ⛔ Ordered by `updated_at`, with {@link deferItem} to send a looked-at-but-not-saved item to the back, so an item that
     * cannot be saved yet (its review is open, a food is down, its visibility is refused) does not hold the same place at the
     * front of every call and starve the ones behind it.
     *
     * @sideEffect Reads.
     */
    public async findSaveCandidates(importId: string, limit: number, cookKey: string): Promise<ImportItem[]> {
        return (
            await this.db
                .select()
                .from(recipeImportItems)
                .where(
                    and(
                        eq(recipeImportItems.importId, importId),
                        eq(recipeImportItems.stage, 'matched'),
                        isNotNull(recipeImportItems.statementKind),
                        // ⛔ The SQL twin of `holdApplies` (importHold.ts): a hold is out of the queue only while it is at the
                        // current revision AND, for a cause the cook's facts decide, judged under THIS cook's facts. A hold
                        // with no reason predates 0082 and is read as a cause in the item.
                        sql`NOT (
                            ${recipeImportItems.heldAtRev} IS NOT DISTINCT FROM ${recipeImportItems.decisionRev}
                            AND (
                                COALESCE(${recipeImportItems.heldReason}, 'item') NOT IN ('visibility', 'createRefused')
                                OR ${recipeImportItems.heldCookKey} = ${cookKey}
                            )
                        )`,
                    ),
                )
                .orderBy(asc(recipeImportItems.updatedAt), asc(recipeImportItems.ordinal))
                .limit(limit)
        ).map(toItem);
    }

    /**
     * Send an item that was looked at but could not be saved to the back of the line. Touches the item only, never the
     * import's activity clock (a deferral is not the cook's activity).
     *
     * @sideEffect Writes `updated_at`.
     */
    public async deferItem(importId: string, ordinal: number): Promise<void> {
        await this.db
            .update(recipeImportItems)
            .set({ updatedAt: sql`clock_timestamp()` })
            .where(and(eq(recipeImportItems.importId, importId), eq(recipeImportItems.ordinal, ordinal)));
    }

    /**
     * Hold an item the save cannot save, with why, until something that could change the outcome changes.
     *
     * Fenced on the revision the save READ: a decision that landed while the save was looking moved the revision, so the hold
     * is not written and that decision is looked at on the next call. No later write clears the hold: the next decision moves
     * `decision_rev` past it, and for a cause the cook's facts decide, a cook with other facts is not held by it
     * ({@link findSaveCandidates}). Touches neither `updated_at` nor the import's activity clock (a hold is not the cook's
     * activity).
     *
     * @param decisionRev - The item's `decision_rev` as the save read it.
     * @param hold - Why, and for a cause the cook's facts decide, the facts it was judged under (`holdOf`).
     * @returns Whether the item is now held (`false`: it changed in between).
     * @sideEffect Writes `held_at_rev`, `held_reason` and `held_cook_key`.
     */
    public async holdItem(importId: string, ordinal: number, decisionRev: number, hold: ImportHold): Promise<boolean> {
        const held = await this.db
            .update(recipeImportItems)
            .set({ heldAtRev: decisionRev, heldReason: hold.reason, heldCookKey: hold.cookKey })
            .where(
                and(
                    eq(recipeImportItems.importId, importId),
                    eq(recipeImportItems.ordinal, ordinal),
                    eq(recipeImportItems.decisionRev, decisionRev),
                ),
            )
            .returning({ ordinal: recipeImportItems.ordinal });

        return held.length > 0;
    }

    /**
     * Record what the cook says about one item.
     *
     * @returns `ok`; `saved` (an item is saved once: the edit belongs in the editor); `missing`.
     * @sideEffect Writes the item and the activity clock.
     */
    public async recordChoices(
        importId: string,
        ordinal: number,
        patch: ChoicesPatch,
    ): Promise<'ok' | 'saved' | 'missing'> {
        const outcome = await this.recordChoicesBatch(importId, [{ ordinal, ...patch }]);

        return outcome.kind;
    }

    /**
     * Record choices for several items, all or nothing.
     *
     * @returns `ok`, or the first item that is saved or missing, with nothing written.
     * @sideEffect Writes the items and the activity clock.
     */
    public async recordChoicesBatch(
        importId: string,
        entries: readonly (ChoicesPatch & { readonly ordinal: number })[],
    ): Promise<{ readonly kind: 'ok' } | { readonly kind: 'saved' | 'missing'; readonly ordinal: number }> {
        return this.db.transaction(async (tx) => {
            await lockImportHeader(tx, importId);

            const held = await tx
                .select({ ...itemColumnsWithoutPayload() })
                .from(recipeImportItems)
                .where(
                    and(
                        eq(recipeImportItems.importId, importId),
                        inArray(
                            recipeImportItems.ordinal,
                            entries.map((entry) => entry.ordinal),
                        ),
                    ),
                )
                .for('update');
            const byOrdinal = new Map(held.map((row) => [row.ordinal, toItem({ ...row, payload: null })] as const));

            const unwritable = unwritableEntryOf(entries, byOrdinal);

            if (unwritable !== undefined) {
                return unwritable;
            }

            // ⛔ A replay that changes nothing writes nothing: moving the revision would release a hold for no decision.
            const changed = entries
                .map((entry) => ({ ordinal: entry.ordinal, patch: choicesColumnsOf(entry) }))
                .filter(({ ordinal, patch }) => !isNoopPatch(byOrdinal.get(ordinal), patch));

            for (const { ordinal, patch } of changed) {
                await tx
                    .update(recipeImportItems)
                    .set({ ...patch, ...BUMP_DECISION_REV, updatedAt: sql`now()` })
                    .where(and(eq(recipeImportItems.importId, importId), eq(recipeImportItems.ordinal, ordinal)));
            }

            await touchImport(tx, importId);

            return { kind: 'ok' as const };
        });
    }

    /**
     * Spend the allowance for the next unpaid items, in ordinal order.
     *
     * @param userId - The verified caller; only their import is paid for.
     * @param importId - The import.
     * @param request - The most items to pay now, and whether the cook holds a paid plan (the bulk limit is per plan).
     * @returns The items paid (fewer than `limit` when the day's room ran short), `nothing` when none was unpaid, or `refused`.
     * @sideEffect Locks the unpaid items, then the user's allowance; writes the ledger and `allowance_spent_at`.
     */
    public async payUnpaid(
        userId: string,
        importId: string,
        request: { readonly limit: number; readonly isPremium: boolean },
    ): Promise<PayOutcome> {
        return this.db.transaction(async (tx): Promise<PayOutcome> => {
            await lockImportHeader(tx, importId);

            const unpaid = await tx.execute<{ ordinal: number }>(sql`
                SELECT i.ordinal
                  FROM recipe_import_items i
                  JOIN recipe_imports h ON h.id = i.import_id
                 WHERE i.import_id = ${importId}
                   AND h.user_id = ${userId}
                   AND i.stage = 'received'
                   AND i.allowance_spent_at IS NULL
                   AND i.refusal IS NULL
                 ORDER BY i.ordinal
                 LIMIT ${request.limit}
                   FOR UPDATE OF i
            `);

            if (unpaid.rows.length === 0) {
                return { kind: 'nothing' };
            }

            const admission = await this.allowance.admit(tx, userId, {
                channel: 'bulk',
                isPremium: request.isPremium,
                units: unpaid.rows.length,
            });

            if (admission.kind === 'refused') {
                return { kind: 'refused', resetsAt: admission.resetsAt };
            }

            const ordinals = unpaid.rows.slice(0, admission.units).map((row) => row.ordinal);

            await tx
                .update(recipeImportItems)
                .set({ allowanceSpentAt: sql`now()`, updatedAt: sql`now()` })
                .where(and(eq(recipeImportItems.importId, importId), inArray(recipeImportItems.ordinal, ordinals)));
            await touchImport(tx, importId);

            return { kind: 'paid', ordinals };
        });
    }

    /**
     * Name the parse job an item is on, once per generation. Naming the same job again is a no-op that answers `true`.
     *
     * @returns Whether the item now names that job.
     * @sideEffect Writes the item.
     */
    public async attachJob(importId: string, ordinal: number, generation: number, jobId: string): Promise<boolean> {
        const attached = await this.db
            .update(recipeImportItems)
            .set({ parseJobId: jobId, stage: 'parsing', updatedAt: sql`now()` })
            .where(
                and(
                    eq(recipeImportItems.importId, importId),
                    eq(recipeImportItems.ordinal, ordinal),
                    eq(recipeImportItems.parseGeneration, generation),
                    inArray(recipeImportItems.stage, ['received', 'parsing']),
                    sql`${recipeImportItems.allowanceSpentAt} IS NOT NULL`,
                    sql`(${recipeImportItems.parseJobId} IS NULL OR ${recipeImportItems.parseJobId} = ${jobId})`,
                ),
            )
            .returning({ ordinal: recipeImportItems.ordinal });

        return attached.length > 0;
    }

    /**
     * Let go of a job that expired before the item was matched: bump the generation (so the next job has a new id) and clear
     * the reference. The item stays paid; it will be given a new job without being charged again.
     *
     * @returns Whether this call did it (a second call finds the generation moved). @sideEffect Writes the item.
     */
    public async detachExpiredJob(importId: string, ordinal: number, generation: number): Promise<boolean> {
        const detached = await this.db
            .update(recipeImportItems)
            .set({ parseGeneration: generation + 1, parseJobId: null, stage: 'parsing', updatedAt: sql`now()` })
            .where(
                and(
                    eq(recipeImportItems.importId, importId),
                    eq(recipeImportItems.ordinal, ordinal),
                    eq(recipeImportItems.parseGeneration, generation),
                    eq(recipeImportItems.stage, 'parsing'),
                ),
            )
            .returning({ ordinal: recipeImportItems.ordinal });

        return detached.length > 0;
    }

    /**
     * Copy an item's match lines into the import's own rows and move it to `matched`, once.
     *
     * The stage compare-and-swap comes FIRST, so a second snapshot writes nothing. The lines are written in the same
     * transaction, so an item is never `matched` with half its lines.
     *
     * @returns Whether this call took the snapshot. @sideEffect Writes the item and its lines.
     */
    public async snapshot(importId: string, ordinal: number, lines: readonly NewImportLine[]): Promise<boolean> {
        return this.db.transaction(async (tx) => {
            await lockImportHeader(tx, importId);

            const claimed = await tx
                .update(recipeImportItems)
                .set({ stage: 'matched', matchedAt: sql`now()`, updatedAt: sql`now()` })
                .where(
                    and(
                        eq(recipeImportItems.importId, importId),
                        eq(recipeImportItems.ordinal, ordinal),
                        eq(recipeImportItems.stage, 'parsing'),
                    ),
                )
                .returning({ ordinal: recipeImportItems.ordinal });

            if (claimed.length === 0) {
                return false;
            }

            if (lines.length > 0) {
                await tx.insert(recipeImportLines).values(
                    lines.map((line) => ({
                        importId,
                        ordinal,
                        ...line,
                        candidates: [...line.candidates],
                    })),
                );
            }

            await touchImport(tx, importId);

            return true;
        });
    }

    /**
     * Take the save of an item, INSIDE the recipe's own transaction. Call it right after the recipe row is written: a second
     * save finds zero rows and throws, which rolls the second recipe back.
     *
     * ⛔ THE FENCE. The claim holds only if the item's `decision_rev` is still the one the save READ before it spent seconds
     * building the recipe. A statement, a visibility, a review mark or a pick written in between moved it, so the recipe in this
     * transaction was built from a decision that is no longer the cook's: it rolls back, and the next call saves from the new one.
     *
     * @param tx - The recipe's transaction.
     * @param decisionRev - The `decisionRev` of the item as the save read it.
     * @throws {ImportItemAlreadyClaimedError} when the item was saved first. {@link ImportItemChangedError} when a decision
     *   moved the fence. A missing statement is the table's CHECK.
     * @sideEffect Writes the item (and sheds its payload) and the activity clock.
     */
    public async claimSave(
        tx: RecipeTx,
        importId: string,
        ordinal: number,
        recipeId: string,
        decisionRev: number,
    ): Promise<void> {
        await lockImportHeader(tx, importId);

        const claimed = await tx
            .update(recipeImportItems)
            .set({ stage: 'saved', savedAt: sql`now()`, recipeId, payload: null, updatedAt: sql`now()` })
            .where(
                and(
                    eq(recipeImportItems.importId, importId),
                    eq(recipeImportItems.ordinal, ordinal),
                    eq(recipeImportItems.stage, 'matched'),
                    isNull(recipeImportItems.savedAt),
                    eq(recipeImportItems.decisionRev, decisionRev),
                ),
            )
            .returning({ ordinal: recipeImportItems.ordinal });

        if (claimed.length === 0) {
            const [held] = await tx
                .select({ savedAt: recipeImportItems.savedAt })
                .from(recipeImportItems)
                .where(and(eq(recipeImportItems.importId, importId), eq(recipeImportItems.ordinal, ordinal)));

            // Saved by someone else: done. Anything else (a moved fence, or a stage that moved back) is a retry.
            throw held?.savedAt === null || held === undefined
                ? new ImportItemChangedError(ordinal)
                : new ImportItemAlreadyClaimedError(ordinal);
        }

        await touchImport(tx, importId);
    }
}

/** The item's columns but the payload (the list never reads the document). */
function itemColumnsWithoutPayload() {
    const { payload: _payload, ...rest } = recipeImportItems;

    return {
        importId: rest.importId,
        ordinal: rest.ordinal,
        title: rest.title,
        stage: rest.stage,
        review: rest.review,
        parseJobId: rest.parseJobId,
        parseGeneration: rest.parseGeneration,
        decisionRev: rest.decisionRev,
        allowanceSpentAt: rest.allowanceSpentAt,
        matchedAt: rest.matchedAt,
        savedAt: rest.savedAt,
        recipeId: rest.recipeId,
        statementKind: rest.statementKind,
        citation: rest.citation,
        sourceKind: rest.sourceKind,
        visibility: rest.visibility,
        cuisine: rest.cuisine,
        heldAtRev: rest.heldAtRev,
        heldReason: rest.heldReason,
        heldCookKey: rest.heldCookKey,
        servings: rest.servings,
        prepTimeMinutes: rest.prepTimeMinutes,
        cookTimeMinutes: rest.cookTimeMinutes,
        refusal: rest.refusal,
        createdAt: rest.createdAt,
        updatedAt: rest.updatedAt,
    };
}

/**
 * Whether a patch of what an item is saved from changes nothing it already holds (an idempotent replay writes no row, so
 * it moves no revision and releases no hold). Pure.
 */
function isNoopPatch(held: ImportItem | undefined, columns: ReturnType<typeof choicesColumnsOf>): boolean {
    if (held === undefined) {
        return false;
    }

    // Compared over the keys the patch names, against the item's own columns: no second list of what a choice writes.
    const current: Readonly<Record<string, unknown>> = held;

    return Object.entries(columns).every(([key, value]) => isDeepStrictEqual(current[key], value));
}

/**
 * The first entry naming an item that is missing or already saved (an item is saved once: the edit belongs in the editor), or
 * `undefined` when every entry can be written. Pure.
 */
function unwritableEntryOf(
    entries: readonly { readonly ordinal: number }[],
    byOrdinal: ReadonlyMap<number, ImportItem>,
): { readonly kind: 'saved' | 'missing'; readonly ordinal: number } | undefined {
    for (const { ordinal } of entries) {
        const item = byOrdinal.get(ordinal);

        if (item === undefined || item.stage === 'saved') {
            return { kind: item === undefined ? 'missing' : 'saved', ordinal };
        }
    }

    return undefined;
}
