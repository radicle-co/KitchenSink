/**
 * `ImportService` — the bulk import's header, items, cursor and list (ADR-0072 §1, §2), over fakes for every port.
 *
 * What each case guards:
 *
 *  - **Ownership is a 404.** An import some other cook holds (their id minted it) is `IMPORT_NOT_FOUND`, the same answer as
 *    an absent one: a 403, or a different code, would confirm the id exists.
 *  - **Create is idempotent.** The client mints the id, so a lost `201` replays: the same choices answer the same import, other
 *    choices are `IMPORT_ID_IN_USE`.
 *  - **An item that cannot change says why**, by the code the contract names: `IMPORT_ITEM_LOCKED` past `received`,
 *    `IMPORT_ITEM_ALREADY_SAVED` once saved. And an ordinal at or past `expectedTotal` is a 400, not a row.
 *  - **The cursor is a compare-and-swap that tells the loser where it is**, and it never moves past the end of the file.
 */
import { describe, expect, it, vi } from 'vitest';

import { RecipeErrorCode } from '@kitchensink/recipe-core';

import { isRecipeDomainError } from '../../recipes/recipe.error.js';
import type { CreateImportRequest } from '../../recipes/import.schema.js';
import { encodeImportListCursor } from '../domain/importPaging.js';
import { IMPORT_ID, makeHeader, makeImportView, makePrincipal, USER } from '../__fixtures__/importFixtures.js';
import { ImportService } from '../import.service.js';
import type { ImportHeader } from '../dal/recipeImports.dal.js';

const VIEW = makeImportView({ id: IMPORT_ID });
const RECIPE = { title: 'Soup', ingredientLines: ['2 cups flour'], steps: [{ instruction: 'Mix.' }] };

function build(
    overrides: {
        readonly header?: ImportHeader | undefined;
        readonly insert?: Awaited<ReturnType<ImportServiceImports['insertHeader']>>;
        readonly upsert?: Awaited<ReturnType<ImportServiceItems['upsertItems']>>;
        readonly move?: Awaited<ReturnType<ImportServiceImports['moveCursor']>>;
        readonly batch?: Awaited<ReturnType<ImportServiceItems['recordChoicesBatch']>>;
        readonly headers?: Awaited<ReturnType<ImportServiceImports['listHeaders']>>;
        readonly deleted?: boolean;
        readonly closed?: boolean;
    } = {},
) {
    const header = 'header' in overrides ? overrides.header : makeHeader();
    const imports = {
        insertHeader: vi.fn(async () => overrides.insert ?? ({ kind: 'created', header: makeHeader() } as const)),
        findHeader: vi.fn(async () => header),
        listHeaders: vi.fn(async () => overrides.headers ?? []),
        deleteHeader: vi.fn(async () => overrides.deleted ?? true),
        moveCursor: vi.fn(async () => overrides.move ?? ({ kind: 'moved' } as const)),
        closeReview: vi.fn(async () => overrides.closed ?? true),
    };
    const items = {
        upsertItems: vi.fn(async () => overrides.upsert ?? ({ kind: 'ok' } as const)),
        recordChoicesBatch: vi.fn(async () => overrides.batch ?? ({ kind: 'ok' } as const)),
    };
    const builder = { build: vi.fn(async () => VIEW) };

    return { service: new ImportService(imports, items, builder), imports, items, builder };
}

type ImportServiceImports = ConstructorParameters<typeof ImportService>[0];
type ImportServiceItems = ConstructorParameters<typeof ImportService>[1];

const COOK = makePrincipal();
const create = (patch: Partial<CreateImportRequest> = {}): CreateImportRequest => ({
    id: IMPORT_ID,
    expectedTotal: 3,
    matchMode: 'keepAsWritten',
    visibility: 'public',
    items: [{ ordinal: 0, recipe: RECIPE }],
    ...patch,
});

async function codeOf(promise: Promise<unknown>): Promise<unknown> {
    const error: unknown = await promise.catch((thrown: unknown) => thrown);

    return isRecipeDomainError(error) ? error.code : (error as { getResponse?: () => unknown }).getResponse?.();
}

describe('ImportService.create', () => {
    it('creates the header under the client’s id for the verified caller, stores the first chunk and answers the view', async () => {
        const { service, imports, items, builder } = build();

        expect(await service.create(COOK, create())).toBe(VIEW);
        expect(imports.insertHeader).toHaveBeenCalledWith(USER, {
            id: IMPORT_ID,
            matchMode: 'keepAsWritten',
            visibility: 'public',
            expectedTotal: 3,
        });
        expect(items.upsertItems).toHaveBeenCalledWith(IMPORT_ID, [{ ordinal: 0, recipe: RECIPE }]);
        expect(builder.build).toHaveBeenCalledOnce();
    });

    it('⛔ answers an id some other cook holds as not found, and stores nothing', async () => {
        const { service, items } = build({ insert: { kind: 'foreign' } });

        expect(await codeOf(service.create(COOK, create()))).toBe(RecipeErrorCode.IMPORT_NOT_FOUND);
        expect(items.upsertItems).not.toHaveBeenCalled();
    });

    it('replays: the same choices on an existing import are the same import', async () => {
        const { service, items } = build({ insert: { kind: 'existing', header: makeHeader() } });

        expect(await service.create(COOK, create())).toBe(VIEW);
        expect(items.upsertItems).toHaveBeenCalledOnce();
    });

    it.each([
        ['match mode', { matchMode: 'review' as const }],
        ['visibility', { visibility: 'private' as const }],
        ['expected total', { expectedTotal: 9 }],
    ])('⛔ refuses an existing id with another %s as IMPORT_ID_IN_USE, and stores nothing', async (_name, patch) => {
        const { service, items } = build({ insert: { kind: 'existing', header: makeHeader() } });

        expect(await codeOf(service.create(COOK, create(patch)))).toBe(RecipeErrorCode.IMPORT_ID_IN_USE);
        expect(items.upsertItems).not.toHaveBeenCalled();
    });

    it('maps a locked item to IMPORT_ITEM_LOCKED and a saved one to IMPORT_ITEM_ALREADY_SAVED', async () => {
        expect(
            await codeOf(
                build({ upsert: { kind: 'locked', ordinal: 0, stage: 'parsing' } }).service.create(COOK, create()),
            ),
        ).toBe(RecipeErrorCode.IMPORT_ITEM_LOCKED);
        expect(await codeOf(build({ upsert: { kind: 'saved', ordinal: 0 } }).service.create(COOK, create()))).toBe(
            RecipeErrorCode.IMPORT_ITEM_ALREADY_SAVED,
        );
    });
});

describe('ImportService.putItems', () => {
    it('stores the chunk for the owner’s import and answers the view', async () => {
        const { service, items } = build();

        expect(await service.putItems(COOK, IMPORT_ID, { items: [{ ordinal: 1, recipe: RECIPE }] })).toBe(VIEW);
        expect(items.upsertItems).toHaveBeenCalledWith(IMPORT_ID, [{ ordinal: 1, recipe: RECIPE }]);
    });

    it('is not found for a missing or foreign import, and stores nothing', async () => {
        const { service, items } = build({ header: undefined });

        expect(await codeOf(service.putItems(COOK, IMPORT_ID, { items: [{ ordinal: 1, recipe: RECIPE }] }))).toBe(
            RecipeErrorCode.IMPORT_NOT_FOUND,
        );
        expect(items.upsertItems).not.toHaveBeenCalled();
    });

    it('⛔ refuses an ordinal at or past the file’s expected total as a validation failure (not a row, not a 500)', async () => {
        const { service, items } = build({ header: makeHeader({ expectedTotal: 3 }) });
        const failure = await service
            .putItems(COOK, IMPORT_ID, { items: [{ ordinal: 3, recipe: RECIPE }] })
            .catch((thrown: unknown) => thrown);

        expect((failure as { getResponse: () => { code: string } }).getResponse().code).toBe('VALIDATION_FAILED');
        expect(items.upsertItems).not.toHaveBeenCalled();
    });

    it('maps the outcomes like create does', async () => {
        const put = (
            upsert: ImportServiceItems extends never ? never : Awaited<ReturnType<ImportServiceItems['upsertItems']>>,
        ) => build({ upsert }).service.putItems(COOK, IMPORT_ID, { items: [{ ordinal: 1, recipe: RECIPE }] });

        expect(await codeOf(put({ kind: 'locked', ordinal: 1, stage: 'matched' }))).toBe(
            RecipeErrorCode.IMPORT_ITEM_LOCKED,
        );
        expect(await codeOf(put({ kind: 'saved', ordinal: 1 }))).toBe(RecipeErrorCode.IMPORT_ITEM_ALREADY_SAVED);
    });
});

describe('ImportService.getView', () => {
    it('shows the owner’s import, one page of items', async () => {
        const { service, builder } = build();

        expect(await service.getView(COOK, IMPORT_ID, { after: 4, limit: 10 })).toBe(VIEW);
        expect(builder.build).toHaveBeenCalledWith(COOK, makeHeader(), { after: 4, limit: 10 });
    });

    it('defaults the page size', async () => {
        const { service, builder } = build();

        await service.getView(COOK, IMPORT_ID, {});

        expect(builder.build).toHaveBeenCalledWith(COOK, makeHeader(), { limit: 100 });
    });

    it('⛔ is not found for a stranger’s or an absent import', async () => {
        expect(await codeOf(build({ header: undefined }).service.getView(COOK, IMPORT_ID, {}))).toBe(
            RecipeErrorCode.IMPORT_NOT_FOUND,
        );
    });
});

describe('ImportService.list', () => {
    const header = (suffix: string, createdAtIso: string) => ({
        ...makeHeader({ id: `66666666-6666-4666-8666-0000000000${suffix}`, createdAtIso }),
        counts: { total: 1, received: 1, parsing: 0, matched: 0, saved: 0, refused: 0 },
    });

    it('lists the caller’s imports newest first and says where the next page starts', async () => {
        const { service, imports } = build({
            headers: [
                header('01', '2026-10-26T12:00:03.000000Z'),
                header('02', '2026-10-26T12:00:02.000000Z'),
                header('03', '2026-10-26T12:00:01.000000Z'),
            ],
        });

        const page = await service.list(COOK, { limit: 2 });

        expect(imports.listHeaders).toHaveBeenCalledWith(USER, undefined, 3);
        expect(page.imports.map((entry) => entry.id.slice(-2))).toEqual(['01', '02']);
        expect(page.nextAfter).toBe(
            encodeImportListCursor({
                createdAt: '2026-10-26T12:00:02.000000Z',
                id: '66666666-6666-4666-8666-000000000002',
            }),
        );
    });

    it('is the last page when no more row follows', async () => {
        const { service } = build({ headers: [header('01', '2026-10-26T12:00:03.000000Z')] });

        expect((await service.list(COOK, { limit: 2 })).nextAfter).toBeNull();
    });

    it('shows the fields the contract names, with the activity clock', async () => {
        const { service } = build({ headers: [header('01', '2026-10-26T12:00:03.000000Z')] });
        const [entry] = (await service.list(COOK, {})).imports;

        expect(entry).toEqual({
            id: '66666666-6666-4666-8666-000000000001',
            matchMode: 'keepAsWritten',
            visibility: 'public',
            expectedTotal: 3,
            counts: { total: 1, received: 1, parsing: 0, matched: 0, saved: 0, refused: 0 },
            createdAt: '2026-10-26T12:00:00.000Z',
            updatedAt: '2026-10-26T12:05:00.000Z',
        });
    });

    it('⛔ refuses a cursor it did not issue as a validation failure', async () => {
        const failure = await build()
            .service.list(COOK, { after: 'not-a-cursor' })
            .catch((thrown: unknown) => thrown);

        expect((failure as { getResponse: () => { code: string } }).getResponse().code).toBe('VALIDATION_FAILED');
    });
});

describe('ImportService.delete', () => {
    it('deletes the caller’s import', async () => {
        const { service, imports } = build();

        await service.delete(COOK, IMPORT_ID);

        expect(imports.deleteHeader).toHaveBeenCalledWith(USER, IMPORT_ID);
    });

    it('is not found when nothing was deleted (a stranger’s import is untouched)', async () => {
        expect(await codeOf(build({ deleted: false }).service.delete(COOK, IMPORT_ID))).toBe(
            RecipeErrorCode.IMPORT_NOT_FOUND,
        );
    });
});

describe('ImportService.leave (“Save and leave”)', () => {
    it('closes the review and answers the view', async () => {
        const { service, imports } = build();

        expect(await service.leave(COOK, IMPORT_ID)).toBe(VIEW);
        expect(imports.closeReview).toHaveBeenCalledWith(USER, IMPORT_ID);
    });

    it('is not found for a stranger’s import', async () => {
        expect(await codeOf(build({ closed: false }).service.leave(COOK, IMPORT_ID))).toBe(
            RecipeErrorCode.IMPORT_NOT_FOUND,
        );
    });
});

describe('ImportService.recordChoicesBatch', () => {
    const body = {
        items: [
            { ordinal: 1, visibility: 'public' as const },
            { ordinal: 2, statement: { kind: 'authored' as const } },
        ],
    };

    it('records every entry for the owner’s import and answers the view', async () => {
        const { service, items } = build();

        expect(await service.recordChoicesBatch(COOK, IMPORT_ID, body)).toBe(VIEW);
        expect(items.recordChoicesBatch).toHaveBeenCalledWith(IMPORT_ID, body.items);
    });

    it('maps a saved item to IMPORT_ITEM_ALREADY_SAVED and an item that never arrived to not found', async () => {
        expect(
            await codeOf(
                build({ batch: { kind: 'saved', ordinal: 1 } }).service.recordChoicesBatch(COOK, IMPORT_ID, body),
            ),
        ).toBe(RecipeErrorCode.IMPORT_ITEM_ALREADY_SAVED);
        expect(
            await codeOf(
                build({ batch: { kind: 'missing', ordinal: 2 } }).service.recordChoicesBatch(COOK, IMPORT_ID, body),
            ),
        ).toBe(RecipeErrorCode.IMPORT_NOT_FOUND);
    });
});

describe('ImportService.moveCursor', () => {
    const at = (cursorOrdinal: number, expectedTotal = 3) =>
        build({ header: makeHeader({ cursorOrdinal, expectedTotal }) });

    it('next marks the current item reviewed and moves on, as ONE compare-and-swap from where the caller said it was', async () => {
        const { service, imports } = at(1);

        await service.moveCursor(COOK, IMPORT_ID, { from: 1, move: { action: 'next' } });

        expect(imports.moveCursor).toHaveBeenCalledWith(USER, IMPORT_ID, {
            from: 1,
            to: 2,
            mark: { ordinal: 1, review: 'reviewed' },
        });
    });

    it('skip marks it skipped; back and open mark nothing', async () => {
        const skip = at(0);
        const back = at(2);
        const open = at(0);

        await skip.service.moveCursor(COOK, IMPORT_ID, { from: 0, move: { action: 'skip' } });
        await back.service.moveCursor(COOK, IMPORT_ID, { from: 2, move: { action: 'back' } });
        await open.service.moveCursor(COOK, IMPORT_ID, { from: 0, move: { action: 'open', to: 2 } });

        expect(skip.imports.moveCursor).toHaveBeenCalledWith(USER, IMPORT_ID, {
            from: 0,
            to: 1,
            mark: { ordinal: 0, review: 'skipped' },
        });
        expect(back.imports.moveCursor).toHaveBeenCalledWith(USER, IMPORT_ID, { from: 2, to: 1 });
        expect(open.imports.moveCursor).toHaveBeenCalledWith(USER, IMPORT_ID, { from: 0, to: 2 });
    });

    it('moving past the last item is done: the ordinal is the count, and `from: null` means done', async () => {
        const last = at(2);
        const done = at(3);

        await last.service.moveCursor(COOK, IMPORT_ID, { from: 2, move: { action: 'next' } });
        await done.service.moveCursor(COOK, IMPORT_ID, { from: null, move: { action: 'back' } });

        expect(last.imports.moveCursor).toHaveBeenCalledWith(USER, IMPORT_ID, {
            from: 2,
            to: 3,
            mark: { ordinal: 2, review: 'reviewed' },
        });
        expect(done.imports.moveCursor).toHaveBeenCalledWith(USER, IMPORT_ID, { from: 3, to: 2 });
    });

    it('⛔ refuses a stale `from` as IMPORT_CURSOR_MOVED naming where the cursor is now, writing nothing', async () => {
        const { service, imports } = at(2);
        const failure = await service
            .moveCursor(COOK, IMPORT_ID, { from: 0, move: { action: 'next' } })
            .catch((thrown: unknown) => thrown);

        expect(isRecipeDomainError(failure) && failure.code).toBe(RecipeErrorCode.IMPORT_CURSOR_MOVED);
        expect(isRecipeDomainError(failure) && failure.details).toEqual({ cursorOrdinal: 2 });
        expect(imports.moveCursor).not.toHaveBeenCalled();
    });

    it('names a cursor that is done as `null`', async () => {
        const failure = await at(3)
            .service.moveCursor(COOK, IMPORT_ID, { from: 0, move: { action: 'back' } })
            .catch((thrown: unknown) => thrown);

        expect(isRecipeDomainError(failure) && failure.details).toEqual({ cursorOrdinal: null });
    });

    it('⛔ loses the race honestly: the store’s own conflict is the same answer, with the position it found', async () => {
        const { service } = build({
            header: makeHeader({ cursorOrdinal: 1 }),
            move: { kind: 'conflict', cursorOrdinal: 2 },
        });
        const failure = await service
            .moveCursor(COOK, IMPORT_ID, { from: 1, move: { action: 'next' } })
            .catch((thrown: unknown) => thrown);

        expect(isRecipeDomainError(failure) && failure.code).toBe(RecipeErrorCode.IMPORT_CURSOR_MOVED);
        expect(isRecipeDomainError(failure) && failure.details).toEqual({ cursorOrdinal: 2 });
    });

    it('⛔ refuses to open an item past the file (a validation failure, not a silent no-op)', async () => {
        const failure = await at(0)
            .service.moveCursor(COOK, IMPORT_ID, { from: 0, move: { action: 'open', to: 3 } })
            .catch((thrown: unknown) => thrown);

        expect((failure as { getResponse: () => { code: string } }).getResponse().code).toBe('VALIDATION_FAILED');
    });

    it('is not found for a stranger’s import', async () => {
        const { service } = build({ header: undefined });

        expect(await codeOf(service.moveCursor(COOK, IMPORT_ID, { from: 0, move: { action: 'next' } }))).toBe(
            RecipeErrorCode.IMPORT_NOT_FOUND,
        );
    });
});
