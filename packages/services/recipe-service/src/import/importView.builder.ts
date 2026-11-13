/**
 * `ImportViewBuilder` — the import view every route answers with: a `GET`, an `advance`, a cursor move, the choices (ADR-0072
 * §2, §8, §9).
 *
 * DESIGN PATTERN: **Builder / read model**. The view is derived at read time from facts the database holds, and nothing in it
 * is stored. Three rules live here:
 *
 *  1. **The allowance state is in the view.** An `advance` that reaches the allowance does the work it can pay for and answers
 *     `200` with this state (ADR-0072 §8 as amended), so the client keeps the progress it paid for and explains the pause
 *     from `used`, `limit` and `resetsAt`. The state is read with the same clock, window and rows the admission uses.
 *  2. **The pause and each item's issue are DERIVED** (`importItemIssueOf`, and the live slot count): a stored issue is wrong
 *     the moment the cook fixes it, the reason "flagged" is not stored either. What the save still needs (a cuisine, servings or
 *     times) is judged by the one policy over facts the page reads out of the payload in SQL (`importSaveGapOf`), never from
 *     the save's hold, and a refusal (`importRefusalOf`) is the stored fact the write set.
 *  3. **`version` digests what the view was built from, VERDICTS INCLUDED.** The review gate writes its verdict by key from the
 *     worker, so no counter this service bumps could see one land; the digest takes the verdicts on record for the import's
 *     lines as an input, read in SQL by either key a line holds.
 *
 * A page asks for ONE ROW MORE than it returns: `nextAfter` is set exactly when more follow.
 */
import { Inject, Injectable } from '@nestjs/common';

import { ImportAllowanceDal } from '../common/dal/importAllowance.dal.js';
import { sha256Hex } from '../common/sha256.js';
import { isPremiumPrincipal, type Principal } from '../auth/principal.js';
import type { RecipeDrizzle } from '../database/client.js';
import { DrizzleProvider } from '../database/database.module.js';
import type { ImportView } from '../recipes/import.schema.js';
import type { ImportHeader, ImportVisibility, RecipeImportsDal } from './dal/recipeImports.dal.js';
import type { ListedImportItem, RecipeImportItemsDal } from './dal/recipeImportItems.dal.js';
import { importItemIssueOf } from './domain/importItemIssue.js';
import { importRefusalOf } from './domain/importRefusal.js';
import { importSaveFactsOf, importSaveGapOf } from './domain/importSaveGap.js';
import { statementOfColumns } from './domain/importStatement.js';
import { importViewVersionOf } from './domain/importViewVersion.js';
import { visibilityRefusedFor } from './domain/importVisibility.js';
import { PRIVATE_SLOTS, type PrivateSlotsPort } from './privateSlots.port.js';
import { RECIPE_IMPORT_ITEMS_DAL, RECIPE_IMPORTS_DAL } from './import.tokens.js';

/** A page of items. */
export interface ItemPage {
    /** Items with an ordinal greater than this; omit for the first page. */
    readonly after?: number;
    readonly limit: number;
}

/** The view's item, as the wire carries it. */
type ViewItem = ImportView['items'][number];

@Injectable()
export class ImportViewBuilder {
    public constructor(
        @Inject(RECIPE_IMPORTS_DAL)
        private readonly imports: Pick<
            RecipeImportsDal,
            'countsByStage' | 'verdictFingerprint' | 'countUnsavedPrivate'
        >,
        @Inject(RECIPE_IMPORT_ITEMS_DAL) private readonly items: Pick<RecipeImportItemsDal, 'findPage'>,
        @Inject(ImportAllowanceDal) private readonly allowance: Pick<ImportAllowanceDal, 'stateOf'>,
        @Inject(DrizzleProvider) private readonly db: RecipeDrizzle,
        @Inject(PRIVATE_SLOTS) private readonly slots: PrivateSlotsPort,
    ) {}

    /**
     * Build the view of one import for its owner.
     *
     * @param principal - The verified caller (their plan and containment judge each item's visibility).
     * @param header - The caller's import.
     * @param page - Which items to show.
     * @returns The view. @sideEffect Reads; writes nothing.
     */
    public async build(principal: Principal, header: ImportHeader, page: ItemPage): Promise<ImportView> {
        const [rows, counts, allowance, verdicts, outOfSlots] = await Promise.all([
            this.items.findPage(header.id, page.after, page.limit + 1),
            this.imports.countsByStage(header.id),
            this.allowance.stateOf(this.db, header.userId, {
                channel: 'bulk',
                isPremium: isPremiumPrincipal(principal),
            }),
            this.imports.verdictFingerprint(header.id),
            this.isOutOfSlots(principal, header),
        ]);
        const shown = rows.slice(0, page.limit);
        const last = shown.at(-1);
        const nextAfter = rows.length > page.limit && last !== undefined ? last.ordinal : null;
        const allowanceSpent = allowance.used >= allowance.limit;
        const pause = outOfSlots ? { reason: 'outOfSlots' } : null;
        const items = shown.map((item) => this.itemOf(principal, header, item, { allowanceSpent, outOfSlots }));
        const cursorOrdinal = header.cursorOrdinal >= header.expectedTotal ? null : header.cursorOrdinal;
        const base = {
            id: header.id,
            matchMode: header.matchMode,
            visibility: header.visibility,
            cursorOrdinal,
            reviewClosed: header.reviewClosedAt !== null,
            expectedTotal: header.expectedTotal,
            allowance,
            pause,
            counts,
            items,
            nextAfter,
        };

        return {
            ...base,
            version: importViewVersionOf(
                {
                    header: {
                        id: header.id,
                        matchMode: header.matchMode,
                        visibility: header.visibility,
                        cursorOrdinal,
                        reviewClosed: base.reviewClosed,
                        expectedTotal: header.expectedTotal,
                    },
                    counts,
                    allowance,
                    pause,
                    items,
                    nextAfter,
                    verdicts,
                },
                sha256Hex,
            ),
        };
    }

    /** Whether the cook has no private slot and something unsaved would use one. Derived, never stored (ADR-0073 §8). */
    private async isOutOfSlots(principal: Principal, header: ImportHeader): Promise<boolean> {
        if (await this.slots.hasAvailable(principal)) {
            return false;
        }

        return (await this.imports.countUnsavedPrivate(header.id)) > 0;
    }

    /** One item as the list shows it, with the issue that keeps it from being saved. Pure given its inputs. */
    private itemOf(
        principal: Principal,
        header: ImportHeader,
        item: ListedImportItem,
        read: { readonly allowanceSpent: boolean; readonly outOfSlots: boolean },
    ): ViewItem {
        const statement = statementOfColumns(item) ?? null;
        const effective: ImportVisibility = item.visibility ?? header.visibility;
        // The stored refusal, else the one the payload's counts state: a payload that slipped past the upload's refusal is
        // named for what it lacks, and never reaches the save gap (which throws for it). A saved item's payload is gone.
        const refusal =
            item.refusal ??
            (item.stage === 'saved'
                ? null
                : importRefusalOf({
                      ingredientLineCount: item.saveFacts.ingredientLineCount,
                      stepCount: item.saveFacts.stepCount,
                  }));
        // Only a matched, unrefused item has a save gap to judge: a refused one has no ingredient line or step, and a saved one
        // has no payload left. (`importSaveGapOf` throws for either, which is a defect, not a hold.)
        const reading =
            statement === null || item.stage !== 'matched' || refusal !== null
                ? undefined
                : importSaveGapOf({
                      statement,
                      ...importSaveFactsOf(item, item.saveFacts.file),
                      ingredientLineCount: item.saveFacts.ingredientLineCount,
                      stepCount: item.saveFacts.stepCount,
                  });
        const issue = importItemIssueOf({
            heldAtCurrentRevision: item.heldAtRev === item.decisionRev,
            stage: item.stage,
            hasStatement: statement !== null,
            visibilityRefused:
                statement !== null &&
                visibilityRefusedFor(
                    {
                        principalKind: principal.principalKind,
                        containment: principal.containment,
                        isPremium: isPremiumPrincipal(principal),
                    },
                    statement,
                    effective,
                ),
            private: effective === 'private',
            outOfSlots: read.outOfSlots,
            paid: item.allowanceSpentAt !== null,
            allowanceSpent: read.allowanceSpent,
            refusal,
            saveGap: reading !== undefined && 'gap' in reading ? reading.gap : null,
        });

        return {
            ordinal: item.ordinal,
            title: item.title,
            stage: item.stage,
            review: item.review,
            statement,
            visibility: item.visibility,
            recipeId: item.recipeId,
            issue: issue === null ? null : { reason: issue },
        };
    }
}
