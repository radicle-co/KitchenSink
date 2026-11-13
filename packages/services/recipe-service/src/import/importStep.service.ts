/**
 * `ImportStepService` — one item with its match lines (the wizard step), the cook's picks, and the two worklists of a bulk
 * import (ADR-0072 §6, §7, §10).
 *
 * DESIGN PATTERN: **Application Service** over the repositories and the line enricher. Four rules live here:
 *
 *  1. **A pick on an UNSAVED item is a stored decision** against the judgement the cook saw (`against`); a pick made against a
 *     judgement that has since changed is `applied: false` with the FRESH step, neither an error nor silent. The save reads it
 *     as the cook's decision, which always wins.
 *  2. **A pick on a SAVED line REBINDS THE DRAFT as `cook`**, through the one rebind command, so the version, the correction
 *     the cook taught, the visibility rules and the carry-forward apply exactly as for an edit in the editor. ⛔ The pick is
 *     recorded only AFTER the rebind succeeded: recording first would hide from the to-check list a line that was never
 *     rebound.
 *  3. **“Keep as written” is acceptance, not an unbind.** On a line already as written it records the acceptance; on a line
 *     the import bound it is a `400`, because making a bound line unbound is the editor's job and not a pick.
 *  4. **Flagged is DERIVED, and a page may be short only when `nextAfter` says more follow.** The repository returns candidates
 *     (every origin but `cook`); the verdict decides which are listed. One page scans at most
 *     {@link IMPORT_FLAGGED_MAX_SCANS} batches and continues AFTER the last line it returned, so nothing is skipped.
 */
import { Inject, Injectable } from '@nestjs/common';

import type { CallerToken } from '../auth/CallerToken.js';
import { actingPrincipalOf, type Principal } from '../auth/principal.js';
import { apiError } from '../common/apiError.js';
import { quantityFromColumns } from '../recipes/dal/quantityColumns.js';
import { IngredientRebindService } from '../recipes/ingredientRebind.service.js';
import type {
    ImportFlaggedResponse,
    ImportPickRequest,
    ImportPickResponse,
    ImportStepResponse,
    ImportToCheckCountResponse,
    ImportToCheckResponse,
    RecordImportChoicesRequest,
} from '../recipes/import.schema.js';
import { importItemAlreadySaved, importNotFound, recipeNotFound } from '../recipes/recipe.error.js';
import type { ImportHeader, RecipeImportsDal } from './dal/recipeImports.dal.js';
import type { ImportItem, RecipeImportItemsDal } from './dal/recipeImportItems.dal.js';
import type { ImportLine, LinkedIngredient, ListedLine, RecipeImportLinesDal } from './dal/recipeImportLines.dal.js';
import {
    IMPORT_FLAGGED_MAX_SCANS,
    IMPORT_FLAGGED_SCAN_SIZE,
    IMPORT_LINES_DEFAULT_PAGE_SIZE,
} from './domain/importLimits.js';
import { decodeLineCursor, encodeLineCursor, type LineCursor } from './domain/importPaging.js';
import { fileCuisineOf, importCuisineOf } from './domain/importPublishGap.js';
import { statementOfColumns } from './domain/importStatement.js';
import { ImportLineView, type FlaggedRead } from './importLineView.js';
import { RECIPE_IMPORT_ITEMS_DAL, RECIPE_IMPORT_LINES_DAL, RECIPE_IMPORTS_DAL } from './import.tokens.js';
import { ownedImport } from './importOwnership.js';

/** A page of lines. */
export interface LineQuery {
    readonly after?: string;
    readonly limit?: number;
}

/** The position of a line in a list. Pure. */
function positionOf(line: ImportLine): LineCursor {
    return { ordinal: line.ordinal, lineIndex: line.lineIndex, foodIndex: line.foodIndex };
}

/** The cook's stored decision on a line, as the step shows it. Pure. */
function pickOf(line: ImportLine): ImportStepResponse['lines'][number]['pick'] {
    if (line.pickedFoodId !== null) {
        return { kind: 'food', id: line.pickedFoodId };
    }

    if (line.pickedFoodVariantId !== null) {
        return { kind: 'variant', id: line.pickedFoodVariantId };
    }

    return line.pickedAsWritten ? { kind: 'asWritten' } : null;
}

@Injectable()
export class ImportStepService {
    public constructor(
        @Inject(RECIPE_IMPORTS_DAL) private readonly imports: Pick<RecipeImportsDal, 'findHeader'>,
        @Inject(RECIPE_IMPORT_ITEMS_DAL)
        private readonly items: Pick<RecipeImportItemsDal, 'findItem' | 'recordChoices'>,
        @Inject(RECIPE_IMPORT_LINES_DAL)
        private readonly lines: Pick<
            RecipeImportLinesDal,
            | 'findForItem'
            | 'findLinkedForItem'
            | 'findLine'
            | 'recordPick'
            | 'findLinkedIngredient'
            | 'listFlaggable'
            | 'listToCheck'
            | 'countToCheck'
        >,
        @Inject(ImportLineView) private readonly lineView: Pick<ImportLineView, 'matchesOf' | 'flagsOf'>,
        @Inject(IngredientRebindService) private readonly rebinds: Pick<IngredientRebindService, 'rebind'>,
    ) {}

    /**
     * One item with its match lines, as the wizard shows it at the cursor.
     *
     * @throws `IMPORT_NOT_FOUND` for a stranger's or an absent import, or an item that never arrived.
     * @sideEffect Reads, and asks food for names as the caller.
     */
    public async step(
        principal: Principal,
        caller: CallerToken | undefined,
        importId: string,
        ordinal: number,
        deadline: AbortSignal | undefined,
    ): Promise<ImportStepResponse> {
        const header = await ownedImport(this.imports, principal, importId);
        const item = await this.items.findItem(header.id, ordinal);

        if (item === undefined) {
            throw importNotFound(importId);
        }

        return this.stepOf(principal, caller, header, item, deadline);
    }

    /**
     * Record what the cook says about one item (its statement and its visibility) and answer the step.
     *
     * @throws `IMPORT_NOT_FOUND`; `IMPORT_ITEM_ALREADY_SAVED`. @sideEffect Writes the item.
     */
    public async recordChoices(
        principal: Principal,
        caller: CallerToken | undefined,
        importId: string,
        ordinal: number,
        body: RecordImportChoicesRequest,
        deadline: AbortSignal | undefined,
    ): Promise<ImportStepResponse> {
        const header = await ownedImport(this.imports, principal, importId);
        const outcome = await this.items.recordChoices(header.id, ordinal, body);

        if (outcome === 'saved') {
            throw importItemAlreadySaved(ordinal);
        }

        if (outcome === 'missing') {
            throw importNotFound(importId);
        }

        return this.step(principal, caller, importId, ordinal, deadline);
    }

    /**
     * Record the cook's decision on one food of one line. On a SAVED item it rebinds the draft as `cook` first.
     *
     * @returns `applied`, and the step to choose again from when it did not.
     * @throws `IMPORT_NOT_FOUND`; `RECIPE_NOT_FOUND` for a draft that was deleted or a line edited out of its link; a `400`
     *   for “as written” on a line the import bound; whatever the rebind throws (the version conflict, food unavailable).
     * @sideEffect Writes the line, and on a saved item the draft.
     */
    public async pick(
        principal: Principal,
        caller: CallerToken | undefined,
        importId: string,
        ordinal: number,
        body: ImportPickRequest,
        deadline: AbortSignal | undefined,
    ): Promise<ImportPickResponse> {
        const header = await ownedImport(this.imports, principal, importId);
        const item = await this.items.findItem(header.id, ordinal);
        const line =
            item === undefined
                ? undefined
                : await this.lines.findLine(principal.userId, importId, ordinal, body.lineIndex, body.foodIndex);

        if (item === undefined || line === undefined) {
            throw importNotFound(importId);
        }

        const outcome =
            line.judgementDigest !== body.against
                ? { applied: false, stage: item.stage }
                : await this.applyPick(principal, caller, item, body);

        // The step is built for the item AS IT NOW IS: a pick that met a save may have moved it to `saved`.
        return {
            applied: outcome.applied,
            step: await this.stepOf(principal, caller, header, { ...item, stage: outcome.stage }, deadline),
        };
    }

    /**
     * The lines the import bound that the review gate did not agree with, or is still checking.
     *
     * @throws `IMPORT_NOT_FOUND`; a `400` for a cursor this service did not issue. @sideEffect Reads.
     */
    public async flagged(
        principal: Principal,
        caller: CallerToken | undefined,
        importId: string,
        query: LineQuery,
        deadline: AbortSignal | undefined,
    ): Promise<ImportFlaggedResponse> {
        const header = await ownedImport(this.imports, principal, importId);
        const acting = actingPrincipalOf(principal);
        const limit = query.limit ?? IMPORT_LINES_DEFAULT_PAGE_SIZE;
        let after = this.cursorOf(query.after);
        const kept: { readonly row: ListedLine; readonly read: FlaggedRead }[] = [];
        let exhausted = false;

        for (let scan = 0; scan < IMPORT_FLAGGED_MAX_SCANS && kept.length <= limit && !exhausted; scan += 1) {
            const rows = await this.lines.listFlaggable(principal.userId, header.id, after, IMPORT_FLAGGED_SCAN_SIZE);
            const reads = await this.lineView.flagsOf(acting, caller, rows, deadline);

            exhausted = rows.length < IMPORT_FLAGGED_SCAN_SIZE;

            for (const row of rows) {
                after = positionOf(row.line);

                const read = reads.get(row.line.id);

                if (read !== undefined && read.flag.state !== 'clear') {
                    kept.push({ row, read });

                    if (kept.length > limit) {
                        break;
                    }
                }
            }
        }

        const shown = kept.slice(0, limit);
        const last = shown.at(-1);
        // More follow when one more line qualified than fit, or when the scan stopped before it reached the end.
        const nextAfter =
            kept.length > limit && last !== undefined
                ? encodeLineCursor(positionOf(last.row.line))
                : exhausted || after === undefined
                  ? null
                  : encodeLineCursor(after);
        const matches = await this.lineView.matchesOf(
            acting,
            caller,
            shown.map(({ row }) => row.line),
            deadline,
        );

        return {
            lines: shown.flatMap(({ row, read }) =>
                read.flag.state === 'clear'
                    ? []
                    : [
                          {
                              ordinal: row.line.ordinal,
                              lineIndex: row.line.lineIndex,
                              foodIndex: row.line.foodIndex,
                              title: row.title,
                              sourceLine: row.line.sourceLine,
                              recipeId: row.recipeId,
                              bound: read.bound,
                              boundBy: row.boundBy ?? 'cook',
                              flag: read.flag,
                              judgementDigest: row.line.judgementDigest,
                              match: matches.get(row.line.id) ?? null,
                          },
                      ],
            ),
            nextAfter,
        };
    }

    /**
     * The lines saved as written that wait for the cook, one import.
     *
     * @throws `IMPORT_NOT_FOUND`; a `400` for a cursor this service did not issue. @sideEffect Reads.
     */
    public async toCheck(
        principal: Principal,
        caller: CallerToken | undefined,
        importId: string,
        query: LineQuery,
        deadline: AbortSignal | undefined,
    ): Promise<ImportToCheckResponse> {
        const header = await ownedImport(this.imports, principal, importId);
        const limit = query.limit ?? IMPORT_LINES_DEFAULT_PAGE_SIZE;
        const rows = await this.lines.listToCheck(principal.userId, header.id, this.cursorOf(query.after), limit + 1);
        const shown = rows.slice(0, limit);
        const last = shown.at(-1);
        const matches = await this.lineView.matchesOf(
            actingPrincipalOf(principal),
            caller,
            shown.map((row) => row.line),
            deadline,
        );

        return {
            lines: shown.map((row) => ({
                ordinal: row.line.ordinal,
                lineIndex: row.line.lineIndex,
                foodIndex: row.line.foodIndex,
                title: row.title,
                sourceLine: row.line.sourceLine,
                judgementDigest: row.line.judgementDigest,
                match: matches.get(row.line.id) ?? null,
            })),
            nextAfter: rows.length > limit && last !== undefined ? encodeLineCursor(positionOf(last.line)) : null,
        };
    }

    /** How many lines wait for the caller across every import they hold. @sideEffect One count. */
    public async toCheckCount(principal: Principal): Promise<ImportToCheckCountResponse> {
        return { count: await this.lines.countToCheck(principal.userId) };
    }

    /**
     * Route a pick to the path its item is on. The item read above may be a moment old: a save can commit between that read and
     * the pick's own locked write, which then answers `saved`, and the pick is routed to the rebind of the draft instead.
     *
     * @returns Whether the pick applied, and the stage the item ended on (the step is built for it).
     */
    private async applyPick(
        principal: Principal,
        caller: CallerToken | undefined,
        item: ImportItem,
        body: ImportPickRequest,
    ): Promise<{ readonly applied: boolean; readonly stage: ImportItem['stage'] }> {
        if (item.stage === 'saved') {
            return { applied: await this.pickOnSaved(principal, caller, item, body), stage: 'saved' };
        }

        const outcome = await this.lines.recordPick(
            principal.userId,
            item.importId,
            item.ordinal,
            body.lineIndex,
            body.foodIndex,
            body.against,
            body.pick,
            { onlyUnsaved: true },
        );

        if (outcome === 'missing') {
            throw importNotFound(item.importId);
        }

        // Saved while the cook was choosing: the decision is not lost, it rebinds the draft as the cook.
        if (outcome === 'saved') {
            return {
                applied: await this.pickOnSaved(principal, caller, { ...item, stage: 'saved' }, body),
                stage: 'saved',
            };
        }

        return { applied: outcome === 'applied', stage: item.stage };
    }

    /** A pick on a line of a SAVED item: rebind the draft as the cook, then record it. Returns whether it applied. */
    private async pickOnSaved(
        principal: Principal,
        caller: CallerToken | undefined,
        item: ImportItem,
        body: ImportPickRequest,
    ): Promise<boolean> {
        const linked = await this.lines.findLinkedIngredient(
            principal.userId,
            item.importId,
            item.ordinal,
            body.lineIndex,
            body.foodIndex,
        );

        if (linked === undefined) {
            throw recipeNotFound(item.recipeId ?? item.importId);
        }

        if (body.pick.kind === 'asWritten') {
            if (linked.boundBy !== null) {
                throw apiError(
                    'VALIDATION_FAILED',
                    'A line the import bound to a food cannot be kept as written here; edit the recipe to unbind it.',
                    { fields: ['pick: the line is bound to a food'] },
                );
            }
        } else {
            await this.rebinds.rebind(
                principal,
                linked.recipeId,
                linked.sortOrder,
                {
                    expectedVersion: linked.recipeVersion,
                    target:
                        body.pick.kind === 'food'
                            ? { kind: 'catalogFood', foodId: body.pick.id }
                            : { kind: 'catalogVariant', foodVariantId: body.pick.id },
                },
                caller,
            );
        }

        // ⛔ AFTER the rebind: a pick recorded first would hide from the to-check list a line that was never rebound.
        await this.lines.recordPick(
            principal.userId,
            item.importId,
            item.ordinal,
            body.lineIndex,
            body.foodIndex,
            body.against,
            body.pick,
            { onlyUnsaved: false },
        );

        return true;
    }

    /** One item with its lines, as the step shows it. */
    private async stepOf(
        principal: Principal,
        caller: CallerToken | undefined,
        header: ImportHeader,
        item: ImportItem,
        deadline: AbortSignal | undefined,
    ): Promise<ImportStepResponse> {
        const acting = actingPrincipalOf(principal);
        const lines = await this.lines.findForItem(header.id, item.ordinal);
        const linked =
            item.stage === 'saved'
                ? await this.lines.findLinkedForItem(principal.userId, header.id, item.ordinal)
                : new Map<string, LinkedIngredient>();
        const flaggable: ListedLine[] = lines.flatMap((line) => {
            const link = linked.get(line.id);

            return link === undefined || link.boundBy === null || link.boundBy === 'cook'
                ? []
                : [{ ...link, line, title: item.title, savedVerificationKey: line.savedVerificationKey }];
        });
        const [matches, flags] = await Promise.all([
            this.lineView.matchesOf(acting, caller, lines, deadline),
            this.lineView.flagsOf(acting, caller, flaggable, deadline),
        ]);

        return {
            ordinal: item.ordinal,
            title: item.title,
            stage: item.stage,
            review: item.review,
            statement: statementOfColumns(item) ?? null,
            visibility: item.visibility,
            // A saved item's payload is gone, so its step shows only a cuisine the cook gave; the recipe holds what was saved.
            cuisine: importCuisineOf(item.cuisine, fileCuisineOf(item.payload)),
            lines: lines.map((line) => ({
                lineIndex: line.lineIndex,
                foodIndex: line.foodIndex,
                sourceLine: line.sourceLine,
                phrase: line.phrase,
                name: line.name,
                ...(line.displayText === null ? {} : { displayText: line.displayText }),
                ...(line.note === null ? {} : { note: line.note }),
                measure: {
                    quantity: quantityFromColumns(line),
                    unit: line.unit,
                    ...(line.preparation === null ? {} : { preparation: line.preparation }),
                },
                judgementDigest: line.judgementDigest,
                match: matches.get(line.id) ?? null,
                flag: flags.get(line.id)?.flag ?? null,
                pick: pickOf(line),
                boundBy: linked.get(line.id)?.boundBy ?? null,
            })),
        };
    }

    /** A list cursor. @throws A `400` for one this service did not issue. Pure apart from the throw. */
    private cursorOf(after: string | undefined): LineCursor | undefined {
        if (after === undefined) {
            return undefined;
        }

        const cursor = decodeLineCursor(after);

        if (cursor === undefined) {
            throw apiError('VALIDATION_FAILED', 'after: not a cursor this service issued', {
                fields: ['after: not a cursor this service issued'],
            });
        }

        return cursor;
    }
}
