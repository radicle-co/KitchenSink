/**
 * `RecipeImportsDal` (ADR-0072) — the SQL truth behind a bulk import's HEADER: its owner, its modes, its wizard cursor, its
 * activity clock.
 *
 * @pattern Repository over the shared Drizzle client. The rules live in the SQL, so no caller can get them wrong:
 *
 *  1. **The owner is in the WHERE.** Every read and write carries `user_id = :caller`; a stranger reads, lists, moves and
 *     deletes nothing, and creating an id some other cook holds answers `foreign`, which the service shows as not found (a
 *     403, or a different answer, would confirm the id exists).
 *  2. **Creating an id twice is idempotent for its owner.** The client mints the id, so a lost `201` replays safely.
 *  3. **The cursor move is a compare-and-swap** (`WHERE cursor_ordinal = :from`): of two devices racing from one position,
 *     exactly one moves, and the loser is told where the cursor is now. The mark on the item left moves in the SAME
 *     transaction.
 *  4. **`updated_at` is the activity clock** the 30-day purge reads (ADR-0072 §9): every write and every advance bumps it,
 *     and every read leaves it.
 *  5. **The verdict fingerprint is read in SQL**, by either key a line holds, so the view's `version` costs one aggregate and
 *     never a hash per line.
 */
import { and, desc, eq, sql } from 'drizzle-orm';

import type { Writer } from '../../database/unitOfWork.js';
import type { RecipeDrizzle } from '../../database/client.js';
import {
    IMPORT_VISIBILITIES,
    recipeImportItems,
    recipeImports,
    type RecipeImportRow,
} from '../../database/schema/recipeImports.js';
import { MATCH_MODES, type ItemReview, type MatchMode } from '../domain/importBindingPolicy.js';
import { BUMP_DECISION_REV } from './decisionRev.js';

/** Public or private. */
export type ImportVisibility = (typeof IMPORT_VISIBILITIES)[number];

/** An import's header, with its columns narrowed to the vocabularies the CHECKs enforce. */
export interface ImportHeader {
    readonly id: string;
    readonly userId: string;
    readonly matchMode: MatchMode;
    readonly visibility: ImportVisibility;
    readonly expectedTotal: number;
    /** An item's ordinal, or `expectedTotal` for done. */
    readonly cursorOrdinal: number;
    readonly reviewClosedAt: Date | null;
    readonly createdAt: Date;
    /** `createdAt` at microsecond precision, as an ISO string: the keyset the list pages by (a `Date` keeps milliseconds). */
    readonly createdAtIso: string;
    readonly updatedAt: Date;
}

/**
 * How many of the arrived items are at each stage. A REFUSED item (ADR-0072 §3) is terminal and is counted under `refused`
 * only, so `received` is the items still waiting to move on; `total` is every arrived item.
 */
export interface StageCounts {
    readonly total: number;
    readonly received: number;
    readonly parsing: number;
    readonly matched: number;
    readonly saved: number;
    readonly refused: number;
}

/** A header and its counts, for the list. */
export interface ImportHeaderWithCounts extends ImportHeader {
    readonly counts: StageCounts;
}

/** Where the list continues from. */
export interface ImportListAfter {
    /** The previous page's last `createdAtIso`. */
    readonly createdAt: string;
    readonly id: string;
}

/** What creating a header answers. */
export type InsertHeaderOutcome =
    | { readonly kind: 'created'; readonly header: ImportHeader }
    | { readonly kind: 'existing'; readonly header: ImportHeader }
    /** The id belongs to another cook. Never leaked: the service answers not found. */
    | { readonly kind: 'foreign' };

/** What a cursor move answers. */
export type MoveCursorOutcome =
    | { readonly kind: 'moved' }
    | { readonly kind: 'conflict'; readonly cursorOrdinal: number }
    | { readonly kind: 'missing' };

/** A header, narrowed. A value the CHECK should have kept out is a defect and is thrown. */
function toHeader(row: RecipeImportRow, createdAtIso: string): ImportHeader {
    const matchMode = MATCH_MODES.find((mode) => mode === row.matchMode);
    const visibility = IMPORT_VISIBILITIES.find((value) => value === row.visibility);

    if (matchMode === undefined || visibility === undefined) {
        throw new Error(`recipe_imports ${row.id} holds a mode or visibility this build does not know`);
    }

    return {
        id: row.id,
        userId: row.userId,
        matchMode,
        visibility,
        expectedTotal: row.expectedTotal,
        cursorOrdinal: row.cursorOrdinal,
        reviewClosedAt: row.reviewClosedAt,
        createdAt: row.createdAt,
        createdAtIso,
        updatedAt: row.updatedAt,
    };
}

/** `created_at` to the microsecond, in SQL: the only precision-safe way to page by it. */
const CREATED_AT_ISO = sql<string>`to_char(${recipeImports.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

const EMPTY_COUNTS: StageCounts = { total: 0, received: 0, parsing: 0, matched: 0, saved: 0, refused: 0 };

/**
 * Move an import's activity clock (`updated_at`), which the purge reads as its last activity. The ONE statement of it,
 * for every DAL whose write counts as activity; each calls it in its own transaction.
 *
 * @sideEffect Writes `recipe_imports.updated_at`.
 */
export async function touchImport(writer: Pick<Writer, 'update'>, importId: string): Promise<void> {
    await writer
        .update(recipeImports)
        .set({ updatedAt: sql`now()` })
        .where(eq(recipeImports.id, importId));
}

export class RecipeImportsDal {
    public constructor(private readonly db: RecipeDrizzle) {}

    /**
     * Create the header, or answer the one that exists.
     *
     * @param userId - The verified caller.
     * @param input - The client-minted id and the choices.
     * @returns `created`; `existing` when the caller already holds this id; `foreign` when someone else does.
     * @sideEffect Writes `recipe_imports` once.
     */
    public async insertHeader(
        userId: string,
        input: {
            readonly id: string;
            readonly matchMode: MatchMode;
            readonly visibility: ImportVisibility;
            readonly expectedTotal: number;
        },
    ): Promise<InsertHeaderOutcome> {
        const created = await this.db
            .insert(recipeImports)
            .values({ ...input, userId })
            .onConflictDoNothing()
            .returning({ id: recipeImports.id });

        const found = await this.selectHeader(input.id);

        if (found === undefined) {
            throw new Error('the import header vanished between its insert and its read');
        }

        if (found.userId !== userId) {
            return { kind: 'foreign' };
        }

        return { kind: created.length > 0 ? 'created' : 'existing', header: found };
    }

    /** The caller's header, or `undefined` (a stranger's and a missing one are ONE answer). @sideEffect Reads. */
    public async findHeader(userId: string, importId: string): Promise<ImportHeader | undefined> {
        const header = await this.selectHeader(importId);

        return header?.userId === userId ? header : undefined;
    }

    /**
     * The caller's imports, newest first, one keyset page.
     *
     * @param userId - The verified caller.
     * @param after - Where the previous page ended.
     * @param limit - The page size.
     * @returns The headers with their stage counts. @sideEffect Reads.
     */
    public async listHeaders(
        userId: string,
        after: ImportListAfter | undefined,
        limit: number,
    ): Promise<ImportHeaderWithCounts[]> {
        const rows = await this.db
            .select({ row: recipeImports, createdAtIso: CREATED_AT_ISO })
            .from(recipeImports)
            .where(
                and(
                    eq(recipeImports.userId, userId),
                    after === undefined
                        ? undefined
                        : sql`(${recipeImports.createdAt}, ${recipeImports.id}) < (${after.createdAt}::timestamptz, ${after.id}::uuid)`,
                ),
            )
            .orderBy(desc(recipeImports.createdAt), desc(recipeImports.id))
            .limit(limit);
        const counts = await this.countsFor(rows.map(({ row }) => row.id));

        return rows.map(({ row, createdAtIso }) => ({
            ...toHeader(row, createdAtIso),
            counts: counts.get(row.id) ?? EMPTY_COUNTS,
        }));
    }

    /** How many of the arrived items are at each stage. @sideEffect Reads. */
    public async countsByStage(importId: string): Promise<StageCounts> {
        return (await this.countsFor([importId])).get(importId) ?? EMPTY_COUNTS;
    }

    /**
     * Delete the caller's import, with its items and lines. The recipes it saved stay.
     *
     * @returns Whether it existed. @sideEffect Deletes; the foreign keys cascade to the items and lines.
     */
    public async deleteHeader(userId: string, importId: string): Promise<boolean> {
        const deleted = await this.db
            .delete(recipeImports)
            .where(and(eq(recipeImports.id, importId), eq(recipeImports.userId, userId)))
            .returning({ id: recipeImports.id });

        return deleted.length > 0;
    }

    /**
     * Move the activity clock. Called in the transaction of any write that does not already move it.
     *
     * @param importId - The import.
     * @param writer - The transaction to join; the base client by default.
     * @sideEffect Writes `updated_at`.
     */
    public async touch(importId: string, writer: Pick<Writer, 'update'> = this.db): Promise<void> {
        await touchImport(writer, importId);
    }

    /**
     * Move the wizard's cursor, and mark the item left, as one compare-and-swap.
     *
     * @param userId - The verified caller.
     * @param importId - The import.
     * @param move - Where the caller believes the cursor is (`from`), where it goes (`to`), and the one mark the move makes.
     * @returns `moved`; `conflict` with where the cursor is now, changing nothing; `missing` for a stranger's import.
     * @sideEffect Writes the header and at most one item.
     */
    public async moveCursor(
        userId: string,
        importId: string,
        move: {
            readonly from: number;
            readonly to: number;
            readonly mark?: { readonly ordinal: number; readonly review: ItemReview };
        },
    ): Promise<MoveCursorOutcome> {
        return this.db.transaction(async (tx): Promise<MoveCursorOutcome> => {
            const moved = await tx
                .update(recipeImports)
                .set({ cursorOrdinal: move.to, updatedAt: sql`now()` })
                .where(
                    and(
                        eq(recipeImports.id, importId),
                        eq(recipeImports.userId, userId),
                        eq(recipeImports.cursorOrdinal, move.from),
                    ),
                )
                .returning({ id: recipeImports.id });

            if (moved.length === 0) {
                const [current] = await tx
                    .select({ cursorOrdinal: recipeImports.cursorOrdinal })
                    .from(recipeImports)
                    .where(and(eq(recipeImports.id, importId), eq(recipeImports.userId, userId)));

                return current === undefined
                    ? { kind: 'missing' }
                    : { kind: 'conflict', cursorOrdinal: current.cursorOrdinal };
            }

            if (move.mark !== undefined) {
                await tx
                    .update(recipeImportItems)
                    .set({
                        review: move.mark.review,
                        ...BUMP_DECISION_REV,
                        updatedAt: sql`now()`,
                    })
                    .where(
                        and(eq(recipeImportItems.importId, importId), eq(recipeImportItems.ordinal, move.mark.ordinal)),
                    );
            }

            return { kind: 'moved' };
        });
    }

    /**
     * Record “Save and leave”. The first time is kept.
     *
     * @returns Whether the caller's import exists. @sideEffect Writes the header.
     */
    public async closeReview(userId: string, importId: string): Promise<boolean> {
        const closed = await this.db
            .update(recipeImports)
            .set({ reviewClosedAt: sql`COALESCE(${recipeImports.reviewClosedAt}, now())`, updatedAt: sql`now()` })
            .where(and(eq(recipeImports.id, importId), eq(recipeImports.userId, userId)))
            .returning({ id: recipeImports.id });

        return closed.length > 0;
    }

    /**
     * How many verdicts are on record for the import's lines, and when the latest landed — by EITHER key a line holds (the
     * proposal's, and the saved line's). The view's `version` digests this, so a verdict that lands after the snapshot moves it.
     *
     * @sideEffect One aggregate read.
     */
    public async verdictFingerprint(
        importId: string,
    ): Promise<{ readonly count: number; readonly latest: string | null }> {
        const result = await this.db.execute<{ count: number; latest: string | null }>(sql`
            SELECT count(*)::int AS count,
                   to_char(max(v.verified_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS latest
              FROM recipe_ingredient_verifications v
             WHERE v.verification_key IN (
                   SELECT l.verification_key FROM recipe_import_lines l
                    WHERE l.import_id = ${importId} AND l.verification_key IS NOT NULL
                   UNION
                   SELECT l.saved_verification_key FROM recipe_import_lines l
                    WHERE l.import_id = ${importId} AND l.saved_verification_key IS NOT NULL)
        `);
        const [row] = result.rows;

        return { count: row?.count ?? 0, latest: row?.latest ?? null };
    }

    /**
     * How many unsaved items would be saved private: the item's own choice over the import's. The out-of-slots pause is
     * derived from this and the live slot count (ADR-0073 §8); nothing about it is stored. A REFUSED recipe is never saved,
     * so it would use no slot and is not counted.
     *
     * @sideEffect One count.
     */
    public async countUnsavedPrivate(importId: string): Promise<number> {
        const result = await this.db.execute<{ count: number }>(sql`
            SELECT count(*)::int AS count
              FROM recipe_import_items i
              JOIN recipe_imports h ON h.id = i.import_id
             WHERE i.import_id = ${importId}
               AND i.stage <> 'saved'
               AND i.refusal IS NULL
               AND COALESCE(i.visibility, h.visibility) = 'private'
        `);

        return result.rows[0]?.count ?? 0;
    }

    private async selectHeader(importId: string): Promise<ImportHeader | undefined> {
        const [found] = await this.db
            .select({ row: recipeImports, createdAtIso: CREATED_AT_ISO })
            .from(recipeImports)
            .where(eq(recipeImports.id, importId));

        return found === undefined ? undefined : toHeader(found.row, found.createdAtIso);
    }

    private async countsFor(importIds: readonly string[]): Promise<ReadonlyMap<string, StageCounts>> {
        if (importIds.length === 0) {
            return new Map();
        }

        const rows = await this.db
            .select({
                importId: recipeImportItems.importId,
                stage: recipeImportItems.stage,
                refused: sql<boolean>`${recipeImportItems.refusal} IS NOT NULL`,
                count: sql<number>`count(*)::int`,
            })
            .from(recipeImportItems)
            .where(sql`${recipeImportItems.importId} IN ${importIds}`)
            .groupBy(
                recipeImportItems.importId,
                recipeImportItems.stage,
                sql`${recipeImportItems.refusal} IS NOT NULL`,
            );
        const byImport = new Map<string, { -readonly [K in keyof StageCounts]: number }>();

        for (const row of rows) {
            const counts = byImport.get(row.importId) ?? {
                total: 0,
                received: 0,
                parsing: 0,
                matched: 0,
                saved: 0,
                refused: 0,
            };

            if (row.refused) {
                counts.refused += row.count;
                counts.total += row.count;
            } else if (
                row.stage === 'received' ||
                row.stage === 'parsing' ||
                row.stage === 'matched' ||
                row.stage === 'saved'
            ) {
                counts[row.stage] += row.count;
                counts.total += row.count;
            }

            byImport.set(row.importId, counts);
        }

        return byImport;
    }
}
