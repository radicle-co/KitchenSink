/**
 * `ImportService` — the bulk import's header, items, wizard cursor and list (ADR-0072 §1, §2, §3).
 *
 * DESIGN PATTERN: **Application Service** over three ports (the header repository, the item repository and the view
 * builder), the `ParseJobsService` shape: it owns the rules the repositories deliberately do not, and every route that changes
 * an import answers with the one view the builder derives.
 *
 * ## The rules that live HERE
 *
 *  1. **Ownership is a 404, never a 403.** A stranger's import and an absent one are ONE answer (`IMPORT_NOT_FOUND`): the
 *     repository folds the owner into its WHERE, and a different answer would confirm the id exists. Creating an id some other
 *     cook holds is the same answer.
 *  2. **Create is idempotent.** The client mints the id, so a lost `201` replays: the same choices answer the same import,
 *     different choices are `IMPORT_ID_IN_USE`. The first chunk is stored by the same all-or-nothing upsert a later `PUT` uses.
 *  3. **An item that cannot change says why**: `IMPORT_ITEM_LOCKED` once it is past `received` (a paid parse was made from
 *     what it holds), `IMPORT_ITEM_ALREADY_SAVED` once it is saved. And an ordinal at or past `expectedTotal` is a 400: SQL
 *     cannot hold that rule (a CHECK cannot read another table), so it is here.
 *  4. **The cursor is a compare-and-swap that tells the loser where it is.** The pure reducer (`importCursor.ts`) decides the
 *     move and the one mark it makes; the repository applies both as a swap from where the caller said the cursor was.
 */
import { Inject, Injectable } from '@nestjs/common';

import type { Principal } from '../auth/principal.js';
import { apiError } from '../common/apiError.js';
import type {
    CreateImportRequest,
    ImportCursorRequest,
    ImportListResponse,
    ImportView,
    PutImportItemsRequest,
    RecordImportChoicesBatchRequest,
} from '../recipes/import.schema.js';
import {
    importCursorMoved,
    importIdInUse,
    importItemAlreadySaved,
    importItemLocked,
    importNotFound,
} from '../recipes/recipe.error.js';
import type { ImportHeader, RecipeImportsDal } from './dal/recipeImports.dal.js';
import type { RecipeImportItemsDal, UpsertItemInput, UpsertOutcome } from './dal/recipeImportItems.dal.js';
import { RECIPE_IMPORT_ITEMS_DAL, RECIPE_IMPORTS_DAL } from './import.tokens.js';
import {
    backItem,
    nextItem,
    openItem,
    ordinalOfPosition,
    positionOfOrdinal,
    skipItem,
    type CursorMove,
} from './domain/importCursor.js';
import { IMPORT_DEFAULT_PAGE_SIZE, IMPORT_LIST_DEFAULT_PAGE_SIZE } from './domain/importLimits.js';
import { decodeImportListCursor, encodeImportListCursor } from './domain/importPaging.js';
import { ImportViewBuilder } from './importView.builder.js';
import { ownedImport } from './importOwnership.js';

/** What a page of items asks for. */
export interface ViewQuery {
    readonly after?: number;
    readonly limit?: number;
}

/** What a page of imports asks for. */
export interface ListQuery {
    readonly after?: string;
    readonly limit?: number;
}

/** A `400 VALIDATION_FAILED` naming the field. */
function invalid(field: string, why: string) {
    return apiError('VALIDATION_FAILED', why, { fields: [`${field}: ${why}`] });
}

@Injectable()
export class ImportService {
    public constructor(
        @Inject(RECIPE_IMPORTS_DAL)
        private readonly imports: Pick<
            RecipeImportsDal,
            'insertHeader' | 'findHeader' | 'listHeaders' | 'deleteHeader' | 'moveCursor' | 'closeReview'
        >,
        @Inject(RECIPE_IMPORT_ITEMS_DAL)
        private readonly items: Pick<RecipeImportItemsDal, 'upsertItems' | 'recordChoicesBatch'>,
        @Inject(ImportViewBuilder) private readonly builder: Pick<ImportViewBuilder, 'build'>,
    ) {}

    /**
     * Create an import from the first chunk of the file, or answer the one this id already is.
     *
     * @param principal - The verified caller.
     * @param body - The client-minted id, the choices and the first items.
     * @returns The view.
     * @throws `IMPORT_NOT_FOUND` for an id another cook holds, `IMPORT_ID_IN_USE` for the caller's own id with other choices,
     *   `IMPORT_ITEM_LOCKED` / `IMPORT_ITEM_ALREADY_SAVED` for an item that cannot change.
     * @sideEffect Writes the header and the items.
     */
    public async create(principal: Principal, body: CreateImportRequest): Promise<ImportView> {
        const created = await this.imports.insertHeader(principal.userId, {
            id: body.id,
            matchMode: body.matchMode,
            visibility: body.visibility,
            expectedTotal: body.expectedTotal,
        });

        if (created.kind === 'foreign') {
            throw importNotFound(body.id);
        }

        const { header } = created;

        if (
            created.kind === 'existing' &&
            (header.matchMode !== body.matchMode ||
                header.visibility !== body.visibility ||
                header.expectedTotal !== body.expectedTotal)
        ) {
            throw importIdInUse();
        }

        return this.storeAndView(principal, header, body.items);
    }

    /**
     * Store more of the file, or a corrected recipe, keyed by ordinal so a replay is safe.
     *
     * @throws `IMPORT_NOT_FOUND`, a `400` for an ordinal at or past the file's expected total, `IMPORT_ITEM_LOCKED`,
     *   `IMPORT_ITEM_ALREADY_SAVED`.
     * @sideEffect Writes the items.
     */
    public async putItems(principal: Principal, importId: string, body: PutImportItemsRequest): Promise<ImportView> {
        const header = await ownedImport(this.imports, principal, importId);
        const past = body.items.find((item) => item.ordinal >= header.expectedTotal);

        if (past !== undefined) {
            throw invalid(
                `items.${String(past.ordinal)}.ordinal`,
                `an ordinal must be below the file's expected total, ${String(header.expectedTotal)}`,
            );
        }

        return this.storeAndView(principal, header, body.items);
    }

    /** The owner's import, one page of items. @throws `IMPORT_NOT_FOUND`. @sideEffect Reads. */
    public async getView(principal: Principal, importId: string, query: ViewQuery): Promise<ImportView> {
        const header = await ownedImport(this.imports, principal, importId);

        return this.builder.build(principal, header, {
            ...(query.after === undefined ? {} : { after: query.after }),
            limit: query.limit ?? IMPORT_DEFAULT_PAGE_SIZE,
        });
    }

    /**
     * The caller's imports, newest first, so a second device can find one and resume it.
     *
     * @throws A `400` for a cursor this service did not issue. @sideEffect Reads.
     */
    public async list(principal: Principal, query: ListQuery): Promise<ImportListResponse> {
        const limit = query.limit ?? IMPORT_LIST_DEFAULT_PAGE_SIZE;
        const after = query.after === undefined ? undefined : decodeImportListCursor(query.after);

        if (query.after !== undefined && after === undefined) {
            throw invalid('after', 'not a cursor this service issued');
        }

        const rows = await this.imports.listHeaders(principal.userId, after, limit + 1);
        const shown = rows.slice(0, limit);
        const last = shown.at(-1);

        return {
            imports: shown.map((row) => ({
                id: row.id,
                matchMode: row.matchMode,
                visibility: row.visibility,
                expectedTotal: row.expectedTotal,
                counts: row.counts,
                createdAt: row.createdAt.toISOString(),
                updatedAt: row.updatedAt.toISOString(),
            })),
            nextAfter:
                rows.length > limit && last !== undefined
                    ? encodeImportListCursor({ createdAt: last.createdAtIso, id: last.id })
                    : null,
        };
    }

    /**
     * Delete the caller's import and its working data. The recipes it saved stay.
     *
     * @throws `IMPORT_NOT_FOUND`. @sideEffect Deletes the header; the foreign keys cascade to its items and lines.
     */
    public async delete(principal: Principal, importId: string): Promise<void> {
        if (!(await this.imports.deleteHeader(principal.userId, importId))) {
            throw importNotFound(importId);
        }
    }

    /** “Save and leave”: record that the cook ended the wizard. @throws `IMPORT_NOT_FOUND`. @sideEffect Writes the header. */
    public async leave(principal: Principal, importId: string): Promise<ImportView> {
        if (!(await this.imports.closeReview(principal.userId, importId))) {
            throw importNotFound(importId);
        }

        return this.getView(principal, importId, {});
    }

    /**
     * Record statements and visibilities for several items at once, each with its OWN statement (a statement is per recipe).
     *
     * @throws `IMPORT_NOT_FOUND` (also for an item that never arrived), `IMPORT_ITEM_ALREADY_SAVED`. @sideEffect Writes.
     */
    public async recordChoicesBatch(
        principal: Principal,
        importId: string,
        body: RecordImportChoicesBatchRequest,
    ): Promise<ImportView> {
        const header = await ownedImport(this.imports, principal, importId);
        const outcome = await this.items.recordChoicesBatch(header.id, body.items);

        if (outcome.kind === 'saved') {
            throw importItemAlreadySaved(outcome.ordinal);
        }

        if (outcome.kind === 'missing') {
            throw importNotFound(importId);
        }

        return this.getView(principal, importId, {});
    }

    /**
     * Move the wizard's cursor, as a compare-and-swap from where the caller says it is.
     *
     * @throws `IMPORT_NOT_FOUND`; `IMPORT_CURSOR_MOVED` (carrying where it is now) when another device moved it first; a
     *   `400` for an item past the file.
     * @sideEffect Writes the header and at most one item's review mark.
     */
    public async moveCursor(principal: Principal, importId: string, body: ImportCursorRequest): Promise<ImportView> {
        const header = await ownedImport(this.imports, principal, importId);
        const count = header.expectedTotal;
        const position = positionOfOrdinal(header.cursorOrdinal, count);
        const current = position.kind === 'done' ? null : position.index;

        if (body.from !== current) {
            throw importCursorMoved(current);
        }

        const move = this.moveOf(body, position, count);
        const outcome = await this.imports.moveCursor(principal.userId, importId, {
            from: header.cursorOrdinal,
            to: ordinalOfPosition(move.position, count),
            ...(move.mark === undefined ? {} : { mark: { ordinal: move.mark.index, review: move.mark.review } }),
        });

        if (outcome.kind === 'missing') {
            throw importNotFound(importId);
        }

        if (outcome.kind === 'conflict') {
            throw importCursorMoved(outcome.cursorOrdinal >= count ? null : outcome.cursorOrdinal);
        }

        return this.getView(principal, importId, {});
    }

    /** The reducer's move for a request. @throws A `400` for an `open` past the file. Pure apart from the throw. */
    private moveOf(
        body: ImportCursorRequest,
        position: ReturnType<typeof positionOfOrdinal>,
        count: number,
    ): CursorMove {
        switch (body.move.action) {
            case 'next':
                return nextItem(position, count);
            case 'skip':
                return skipItem(position, count);
            case 'back':
                return backItem(position, count);
            case 'open':
                if (body.move.to >= count) {
                    throw invalid('move.to', `an item must be below the file's expected total, ${String(count)}`);
                }

                return openItem(position, count, body.move.to);
        }
    }

    /**
     * Store a request's items, all or nothing, and answer the import's first page.
     *
     * @throws The contract's error for a refused item. @sideEffect Writes the items.
     */
    private async storeAndView(
        principal: Principal,
        header: ImportHeader,
        items: PutImportItemsRequest['items'],
    ): Promise<ImportView> {
        this.raiseIfRefused(await this.items.upsertItems(header.id, items.map(toUpsertInput)));

        return this.builder.build(principal, header, { limit: IMPORT_DEFAULT_PAGE_SIZE });
    }

    /** Throw the contract's error for an upsert that was refused. */
    private raiseIfRefused(outcome: UpsertOutcome): void {
        if (outcome.kind === 'locked') {
            throw importItemLocked(outcome.ordinal, outcome.stage);
        }

        if (outcome.kind === 'saved') {
            throw importItemAlreadySaved(outcome.ordinal);
        }
    }
}

/** A request's item as the repository takes it. Pure. */
function toUpsertInput(item: CreateImportRequest['items'][number]): UpsertItemInput {
    return {
        ordinal: item.ordinal,
        recipe: item.recipe,
        ...(item.statement === undefined ? {} : { statement: item.statement }),
        ...(item.visibility === undefined ? {} : { visibility: item.visibility }),
    };
}
