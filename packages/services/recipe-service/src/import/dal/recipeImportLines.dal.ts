/**
 * `RecipeImportLinesDal` (ADR-0072 §4, §6, §10) — the SQL truth behind a bulk import's SNAPSHOT lines: each parsed food's
 * match as it was when the item was matched, the cook's pick, and the saved line's verdict key. And the two LISTS built from
 * them and the ingredients they became: the lines the import bound that may need a second look (“flagged”), and the lines
 * saved as written that wait for the cook (“to check”), per import and across the whole library.
 *
 * @pattern Repository over the shared Drizzle client. The rules live in the SQL:
 *
 *  1. **The owner is in the WHERE**, through the import. A stranger's pick finds no line; a stranger's list is empty.
 *  2. **A pick applies only against the judgement the cook saw** (`l.judgement_digest = :against`); otherwise the answer is
 *     `stale` and nothing is written. A stale pick is neither an error nor silent.
 *  3. **A list is the JOIN to the live ingredient.** A line is “to check” only while an ingredient still names it
 *     (`ingredients.import_line_id`) with no origin (`bound_by IS NULL`): a cook who edited the line into a food, picked one,
 *     or deleted the recipe has taken it off the list by that act alone, and nothing stored needs to be kept in step.
 *  4. **Keyset paging by (ordinal, line, food)**, ascending, so no line is skipped or repeated.
 *
 * ⛔ No food name and no verdict is stored or returned here (ADR-0045): names come from food, and verdicts from the verdict
 * table, at read time.
 */
import { and, asc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';

import type { RecipeDrizzle } from '../../database/client.js';
import { ingredients } from '../../database/schema/ingredients.js';
import { recipes } from '../../database/schema/recipes.js';
import {
    recipeImportItems,
    recipeImportLines,
    recipeImports,
    type RecipeImportLineRow,
} from '../../database/schema/recipeImports.js';
import type { Writer } from '../../database/unitOfWork.js';
import { BOUND_BY_VALUES, type BoundBy } from '../../recipes/domain/bindingOriginCarryForward.js';
import type { LineCursor } from '../domain/importPaging.js';
import { lockImportHeader } from './importLocks.js';
import { touchImport } from './recipeImports.dal.js';

/** One snapshot line, as the importer writes it. Numerics are the columns' own decimal text. */
export interface NewImportLine {
    readonly lineIndex: number;
    readonly foodIndex: number;
    readonly sourceLine: string;
    readonly lineDigest: string;
    readonly judgementDigest: string;
    readonly phrase: string;
    readonly quantity: string | null;
    readonly quantityHigh: string | null;
    readonly unit: string;
    readonly statedQuantity: string | null;
    readonly statedQuantityHigh: string | null;
    readonly statedUnit: string | null;
    readonly preparation: string | null;
    /** The food's name as the editor saves it (`pastedLineRowOf`): a leading size word is in the unit, not here. */
    readonly name: string;
    /** The cook's words, when the parse chose them as the shown name; `null` otherwise. */
    readonly displayText: string | null;
    /** A dimension the cook wrote in parentheses, never the unit; `null` when there is none. */
    readonly note: string | null;
    readonly matchedBy: 'curated' | 'memo' | 'lexical' | null;
    readonly foodId: string | null;
    readonly foodVariantId: string | null;
    readonly rung: string | null;
    readonly margin: number | null;
    /** `[{ kind, id, rung, isDefault }]`, ids only, at most five. */
    readonly candidates: readonly {
        readonly kind: 'root' | 'variant';
        readonly id: string;
        readonly rung: string | null;
        readonly isDefault: boolean;
    }[];
    readonly verificationKey: string | null;
    readonly review: 'owed' | 'refused' | null;
}

/** A snapshot line, as the DAL returns it. */
export type ImportLine = RecipeImportLineRow;

/** What a cook can choose for one food of one line. */
export type PickChoice =
    | { readonly kind: 'food'; readonly id: string }
    | { readonly kind: 'variant'; readonly id: string }
    | { readonly kind: 'asWritten' };

/** The ingredient a snapshot line became. */
export interface LinkedIngredient {
    readonly ingredientId: string;
    readonly recipeId: string;
    /** The line's position in author order (`sort_order`), which the rebind command addresses. */
    readonly sortOrder: number;
    readonly boundBy: BoundBy | null;
    readonly foodLookupId: string;
}

/** The ingredient a pick rebinds, with the version of its draft READ IN THE SAME QUERY as its position. */
export interface RebindTarget extends LinkedIngredient {
    /** `recipes.current_version`. The rebind's `expectedVersion`: an edit after this read is a `409`, not a rebind of another line. */
    readonly recipeVersion: number;
}

/** One row of a list: the snapshot line, the item's title, and the ingredient it became. */
export interface ListedLine extends LinkedIngredient {
    readonly line: ImportLine;
    readonly title: string;
    /** The key the verdict about the saved line lives under, when the line was bound. */
    readonly savedVerificationKey: string | null;
}

/** `bound_by` as the column holds it, narrowed. */
function boundByOf(stored: string | null): BoundBy | null {
    if (stored === null) {
        return null;
    }

    const known = BOUND_BY_VALUES.find((value) => value === stored);

    if (known === undefined) {
        throw new Error(`ingredients.bound_by holds a value this build does not know: ${stored}`);
    }

    return known;
}

/** The origins that mean “the import bound this without the cook”: every one but `cook`. */
const IMPORT_BOUND = BOUND_BY_VALUES.filter((value) => value !== 'cook');

/** A line has something for the cook to pick: a proposal, or at least one candidate. */
const HAS_SOMETHING_TO_PICK = sql`(${recipeImportLines.foodId} IS NOT NULL OR ${recipeImportLines.foodVariantId} IS NOT NULL OR jsonb_array_length(${recipeImportLines.candidates}) > 0)`;

/** Nobody has picked on a line: no food, no variant, not kept as written. */
const UNPICKED = and(
    isNull(recipeImportLines.pickedFoodId),
    isNull(recipeImportLines.pickedFoodVariantId),
    eq(recipeImportLines.pickedAsWritten, false),
);

export class RecipeImportLinesDal {
    public constructor(private readonly db: RecipeDrizzle) {}

    /** The snapshot lines of one item, in line then food order. @sideEffect Reads. */
    public async findForItem(importId: string, ordinal: number): Promise<ImportLine[]> {
        return this.db
            .select()
            .from(recipeImportLines)
            .where(and(eq(recipeImportLines.importId, importId), eq(recipeImportLines.ordinal, ordinal)))
            .orderBy(asc(recipeImportLines.lineIndex), asc(recipeImportLines.foodIndex));
    }

    /** The snapshot lines of several items, in ordinal, line then food order. @sideEffect Reads. */
    public async findForItems(importId: string, ordinals: readonly number[]): Promise<ImportLine[]> {
        if (ordinals.length === 0) {
            return [];
        }

        return this.db
            .select()
            .from(recipeImportLines)
            .where(and(eq(recipeImportLines.importId, importId), inArray(recipeImportLines.ordinal, [...ordinals])))
            .orderBy(
                asc(recipeImportLines.ordinal),
                asc(recipeImportLines.lineIndex),
                asc(recipeImportLines.foodIndex),
            );
    }

    /** One snapshot line, for its owner, or `undefined` (a stranger's and a missing one are ONE answer). @sideEffect Reads. */
    public async findLine(
        userId: string,
        importId: string,
        ordinal: number,
        lineIndex: number,
        foodIndex: number,
    ): Promise<ImportLine | undefined> {
        const [row] = await this.db
            .select({ line: recipeImportLines })
            .from(recipeImportLines)
            .innerJoin(recipeImports, eq(recipeImports.id, recipeImportLines.importId))
            .where(
                and(
                    eq(recipeImports.userId, userId),
                    eq(recipeImportLines.importId, importId),
                    eq(recipeImportLines.ordinal, ordinal),
                    eq(recipeImportLines.lineIndex, lineIndex),
                    eq(recipeImportLines.foodIndex, foodIndex),
                ),
            );

        return row?.line;
    }

    /**
     * What each snapshot line of a SAVED item became: the draft's ingredient it names, with who bound it. A line whose recipe
     * was deleted, or whose ingredient was edited out of the link, has no entry.
     *
     * @returns Line id → the ingredient. @sideEffect Reads.
     */
    public async findLinkedForItem(
        userId: string,
        importId: string,
        ordinal: number,
    ): Promise<ReadonlyMap<string, LinkedIngredient>> {
        const rows = await this.db
            .select({
                lineId: recipeImportLines.id,
                ingredientId: ingredients.id,
                recipeId: ingredients.recipeId,
                sortOrder: ingredients.sortOrder,
                boundBy: ingredients.boundBy,
                foodLookupId: ingredients.foodLookupId,
            })
            .from(recipeImportLines)
            .innerJoin(recipeImports, eq(recipeImports.id, recipeImportLines.importId))
            .innerJoin(ingredients, eq(ingredients.importLineId, recipeImportLines.id))
            .innerJoin(recipes, eq(recipes.id, ingredients.recipeId))
            .where(
                and(
                    eq(recipeImports.userId, userId),
                    eq(recipeImportLines.importId, importId),
                    eq(recipeImportLines.ordinal, ordinal),
                    isNull(recipes.deletedAt),
                ),
            );

        return new Map(
            rows.map(({ lineId, ...row }) => [lineId, { ...row, boundBy: boundByOf(row.boundBy) }] as const),
        );
    }

    /**
     * Record the cook's decision on one food of one line, against the judgement they saw.
     *
     * @param options.onlyUnsaved - `true` for a pick on an item that may not be saved yet: the item is locked and refused if it is
     *   saved (the pick belongs to the rebind path then), and the pick moves the item's save fence. `false` for the record that
     *   follows a successful rebind of a saved draft: the item is saved, so there is nothing to fence.
     * @returns `applied`; `stale` when the line's judgement is no longer the digest the cook saw (nothing written);
     *   `saved` when `onlyUnsaved` and the item was saved first (nothing written); `missing` when the caller has no such line.
     * @sideEffect Writes the line, the item's fence and the import's activity clock.
     */
    public async recordPick(
        userId: string,
        importId: string,
        ordinal: number,
        lineIndex: number,
        foodIndex: number,
        against: string,
        pick: PickChoice,
        options: { readonly onlyUnsaved: boolean },
    ): Promise<'applied' | 'stale' | 'missing' | 'saved'> {
        return this.db.transaction(async (tx) => {
            // The one lock order: header, then item, then line (see `importLocks.ts`).
            await lockImportHeader(tx, importId);

            const [item] = await tx
                .select({ stage: recipeImportItems.stage })
                .from(recipeImportItems)
                .innerJoin(recipeImports, eq(recipeImports.id, recipeImportItems.importId))
                .where(
                    and(
                        eq(recipeImports.userId, userId),
                        eq(recipeImportItems.importId, importId),
                        eq(recipeImportItems.ordinal, ordinal),
                    ),
                )
                .for('no key update', { of: recipeImportItems });

            if (item === undefined) {
                return 'missing' as const;
            }

            if (options.onlyUnsaved && item.stage === 'saved') {
                return 'saved' as const;
            }

            const [line] = await tx
                .select({ id: recipeImportLines.id, judgementDigest: recipeImportLines.judgementDigest })
                .from(recipeImportLines)
                .where(
                    and(
                        eq(recipeImportLines.importId, importId),
                        eq(recipeImportLines.ordinal, ordinal),
                        eq(recipeImportLines.lineIndex, lineIndex),
                        eq(recipeImportLines.foodIndex, foodIndex),
                    ),
                )
                .for('update');

            if (line === undefined) {
                return 'missing' as const;
            }

            if (line.judgementDigest !== against) {
                return 'stale' as const;
            }

            await tx
                .update(recipeImportLines)
                .set({
                    pickedFoodId: pick.kind === 'food' ? pick.id : null,
                    pickedFoodVariantId: pick.kind === 'variant' ? pick.id : null,
                    pickedAsWritten: pick.kind === 'asWritten',
                    pickedAgainstDigest: against,
                })
                .where(eq(recipeImportLines.id, line.id));

            // A pick on an UNSAVED item is a decision the save reads, so it moves the fence. After the rebind of a saved
            // draft there is no save left to fence.
            if (options.onlyUnsaved) {
                await tx
                    .update(recipeImportItems)
                    .set({ decisionRev: sql`${recipeImportItems.decisionRev} + 1`, saveFailures: 0 })
                    .where(and(eq(recipeImportItems.importId, importId), eq(recipeImportItems.ordinal, ordinal)));
            }

            await touchImport(tx, importId);

            return 'applied' as const;
        });
    }

    /**
     * Claim the one curation count of a line whose CURATED proposal the review gate contradicted (review item 5 on #220):
     * a conditional write of the line's marker, so only the first read that sees the contradiction counts it. The verdict
     * key is in the predicate, as the paste's is (`claimCurationReport` on the match store).
     *
     * @param lineId - The snapshot line.
     * @param verificationKey - The key the contradicting verdict is stored under.
     * @returns Whether this call won the claim. Zero rows IS the answer "already counted, or not a curated line".
     * @sideEffect One conditional update of the line.
     */
    public async claimCurationReport(lineId: string, verificationKey: string): Promise<boolean> {
        const won = await this.db
            .update(recipeImportLines)
            .set({ curationReportedAt: sql`now()` })
            .where(
                and(
                    eq(recipeImportLines.id, lineId),
                    eq(recipeImportLines.verificationKey, verificationKey),
                    eq(recipeImportLines.matchedBy, 'curated'),
                    isNull(recipeImportLines.curationReportedAt),
                ),
            )
            .returning({ id: recipeImportLines.id });

        return won.length > 0;
    }

    /**
     * Store the keys the saved lines' verdicts live under. Called in the save's own transaction.
     *
     * @param writer - The transaction.
     * @sideEffect Writes the lines.
     */
    public async setSavedKeys(
        writer: Pick<Writer, 'update'>,
        entries: readonly { readonly id: string; readonly key: string }[],
    ): Promise<void> {
        for (const entry of entries) {
            await writer
                .update(recipeImportLines)
                .set({ savedVerificationKey: entry.key })
                .where(eq(recipeImportLines.id, entry.id));
        }
    }

    /**
     * The lines saved as written that wait for the cook, one import, one page.
     *
     * @param after - The previous page's last position.
     * @sideEffect Reads.
     */
    public async listToCheck(
        userId: string,
        importId: string,
        after: LineCursor | undefined,
        limit: number,
    ): Promise<ListedLine[]> {
        return this.listWhere(
            userId,
            importId,
            sql`${ingredients.boundBy} IS NULL AND ${UNPICKED} AND ${HAS_SOMETHING_TO_PICK}`,
            after,
            limit,
        );
    }

    /**
     * The lines the import bound without the cook (every origin but `cook`), one import, one page. Whether each is FLAGGED is
     * derived by the caller from the verdict, so the page is a candidate set, not the answer.
     *
     * @sideEffect Reads.
     */
    public async listFlaggable(
        userId: string,
        importId: string,
        after: LineCursor | undefined,
        limit: number,
    ): Promise<ListedLine[]> {
        return this.listWhere(userId, importId, inArray(ingredients.boundBy, IMPORT_BOUND), after, limit);
    }

    /**
     * How many lines wait for the cook across every import they hold (the “{count} to check” at the top of My recipes).
     *
     * @sideEffect One count.
     */
    public async countToCheck(userId: string): Promise<number> {
        const [row] = await this.db
            .select({ count: sql<number>`count(*)::int` })
            .from(recipeImportLines)
            .innerJoin(recipeImports, eq(recipeImports.id, recipeImportLines.importId))
            .innerJoin(ingredients, eq(ingredients.importLineId, recipeImportLines.id))
            .innerJoin(recipes, eq(recipes.id, ingredients.recipeId))
            .where(
                and(
                    eq(recipeImports.userId, userId),
                    isNull(recipes.deletedAt),
                    isNull(ingredients.boundBy),
                    UNPICKED,
                    HAS_SOMETHING_TO_PICK,
                ),
            );

        return row?.count ?? 0;
    }

    /**
     * The draft's ingredient a snapshot line became, for a pick to rebind. The caller must own the import, and the recipe
     * must still exist.
     *
     * @returns The ingredient with its position AND its draft's current version from ONE read, so the rebind addresses the line it
     *   found: if the editor reorders or deletes lines afterwards the version no longer matches and the rebind is a `409`.
     * @sideEffect Reads.
     */
    public async findLinkedIngredient(
        userId: string,
        importId: string,
        ordinal: number,
        lineIndex: number,
        foodIndex: number,
    ): Promise<RebindTarget | undefined> {
        const [row] = await this.db
            .select({
                ingredientId: ingredients.id,
                recipeId: ingredients.recipeId,
                sortOrder: ingredients.sortOrder,
                boundBy: ingredients.boundBy,
                foodLookupId: ingredients.foodLookupId,
                recipeVersion: recipes.currentVersion,
            })
            .from(recipeImportLines)
            .innerJoin(recipeImports, eq(recipeImports.id, recipeImportLines.importId))
            .innerJoin(ingredients, eq(ingredients.importLineId, recipeImportLines.id))
            .innerJoin(recipes, eq(recipes.id, ingredients.recipeId))
            .where(
                and(
                    eq(recipeImports.userId, userId),
                    eq(recipeImportLines.importId, importId),
                    eq(recipeImportLines.ordinal, ordinal),
                    eq(recipeImportLines.lineIndex, lineIndex),
                    eq(recipeImportLines.foodIndex, foodIndex),
                    isNull(recipes.deletedAt),
                ),
            );

        return row === undefined ? undefined : { ...row, boundBy: boundByOf(row.boundBy) };
    }

    private async listWhere(
        userId: string,
        importId: string,
        condition: ReturnType<typeof sql>,
        after: LineCursor | undefined,
        limit: number,
    ): Promise<ListedLine[]> {
        const rows = await this.db
            .select({
                line: recipeImportLines,
                title: recipeImportItems.title,
                ingredientId: ingredients.id,
                recipeId: ingredients.recipeId,
                sortOrder: ingredients.sortOrder,
                boundBy: ingredients.boundBy,
                foodLookupId: ingredients.foodLookupId,
            })
            .from(recipeImportLines)
            .innerJoin(recipeImports, eq(recipeImports.id, recipeImportLines.importId))
            .innerJoin(
                recipeImportItems,
                and(
                    eq(recipeImportItems.importId, recipeImportLines.importId),
                    eq(recipeImportItems.ordinal, recipeImportLines.ordinal),
                ),
            )
            .innerJoin(ingredients, eq(ingredients.importLineId, recipeImportLines.id))
            .innerJoin(recipes, eq(recipes.id, ingredients.recipeId))
            .where(
                and(
                    eq(recipeImports.userId, userId),
                    eq(recipeImportLines.importId, importId),
                    eq(recipeImportItems.stage, 'saved'),
                    isNull(recipes.deletedAt),
                    condition,
                    after === undefined
                        ? undefined
                        : or(
                              gt(recipeImportLines.ordinal, after.ordinal),
                              and(
                                  eq(recipeImportLines.ordinal, after.ordinal),
                                  gt(recipeImportLines.lineIndex, after.lineIndex),
                              ),
                              and(
                                  eq(recipeImportLines.ordinal, after.ordinal),
                                  eq(recipeImportLines.lineIndex, after.lineIndex),
                                  gt(recipeImportLines.foodIndex, after.foodIndex),
                              ),
                          ),
                ),
            )
            .orderBy(asc(recipeImportLines.ordinal), asc(recipeImportLines.lineIndex), asc(recipeImportLines.foodIndex))
            .limit(limit);

        return rows.map((row) => ({
            line: row.line,
            title: row.title,
            ingredientId: row.ingredientId,
            recipeId: row.recipeId,
            sortOrder: row.sortOrder,
            boundBy: boundByOf(row.boundBy),
            foodLookupId: row.foodLookupId,
            savedVerificationKey: row.line.savedVerificationKey,
        }));
    }
}
