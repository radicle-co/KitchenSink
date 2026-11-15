/**
 * `ImportController` maps each route to ONE service method, with the caller's identity from the verified
 * principal and the ids from the path (ADR-0072 §1). A route that called the wrong method, dropped the caller's credential
 * or took the owner from the body would still compile, so each mapping is pinned here against service doubles.
 *
 * What a route ANSWERS (status codes, pipes, the published shape) is the integration tier's: `__tests__/integration/import/`.
 */
import { describe, expect, it, vi } from 'vitest';

import { CallerToken } from '../../auth/CallerToken.js';
import type {
    CreateImportRequest,
    ImportCursorRequest,
    ImportPickRequest,
    ImportStepResponse,
    PutImportItemsRequest,
    RecordImportChoicesBatchRequest,
    RecordImportChoicesRequest,
} from '../../recipes/import.schema.js';
import { IMPORT_ID, makeImportView, makePrincipal } from '../__fixtures__/importFixtures.js';
import { ImportController } from '../import.controller.js';
import type { ImportAdvanceService } from '../importAdvance.service.js';
import type { ImportService } from '../import.service.js';
import type { ImportStepService } from '../importStep.service.js';

const COOK = makePrincipal();
const CALLER = CallerToken.fromAuthorizationHeader('Bearer cook-token');
const VIEW = makeImportView();
const STEP: ImportStepResponse = {
    ordinal: 2,
    title: 'Pancakes',
    stage: 'matched',
    review: 'pending',
    statement: null,
    visibility: null,
    cuisine: null,
    servings: null,
    prepTimeMinutes: null,
    cookTimeMinutes: null,
    totalTimeMinutes: null,
    lines: [],
};

function compose() {
    const imports = {
        create: vi.fn<ImportService['create']>().mockResolvedValue(VIEW),
        list: vi.fn<ImportService['list']>().mockResolvedValue({ imports: [], nextAfter: null }),
        putItems: vi.fn<ImportService['putItems']>().mockResolvedValue(VIEW),
        getView: vi.fn<ImportService['getView']>().mockResolvedValue(VIEW),
        delete: vi.fn<ImportService['delete']>().mockResolvedValue(undefined),
        moveCursor: vi.fn<ImportService['moveCursor']>().mockResolvedValue(VIEW),
        recordChoicesBatch: vi.fn<ImportService['recordChoicesBatch']>().mockResolvedValue(VIEW),
        leave: vi.fn<ImportService['leave']>().mockResolvedValue(VIEW),
    };
    const steps = {
        toCheckCount: vi.fn<ImportStepService['toCheckCount']>().mockResolvedValue({ count: 4 }),
        step: vi.fn<ImportStepService['step']>().mockResolvedValue(STEP),
        pick: vi.fn<ImportStepService['pick']>().mockResolvedValue({ applied: true, step: STEP }),
        recordChoices: vi.fn<ImportStepService['recordChoices']>().mockResolvedValue(STEP),
        flagged: vi.fn<ImportStepService['flagged']>().mockResolvedValue({ lines: [], nextAfter: null }),
        toCheck: vi.fn<ImportStepService['toCheck']>().mockResolvedValue({ lines: [], nextAfter: null }),
    };
    const advancer = { advance: vi.fn<ImportAdvanceService['advance']>().mockResolvedValue(VIEW) };

    return { imports, steps, advancer, controller: new ImportController(imports, steps, advancer) };
}

describe('ImportController', () => {
    it('create hands the principal and the body to ImportService.create', async () => {
        const { controller, imports } = compose();
        const body: CreateImportRequest = {
            id: IMPORT_ID,
            expectedTotal: 1,
            matchMode: 'keepAsWritten',
            visibility: 'private',
            items: [],
        };

        await expect(controller.create(COOK, body)).resolves.toBe(VIEW);
        expect(imports.create).toHaveBeenCalledExactlyOnceWith(COOK, body);
    });

    it('list passes the query through', async () => {
        const { controller, imports } = compose();

        await controller.list(COOK, { after: 'c', limit: 5 });

        expect(imports.list).toHaveBeenCalledExactlyOnceWith(COOK, { after: 'c', limit: 5 });
    });

    it('toCheckCount reads the library-wide count for the principal alone', async () => {
        const { controller, steps } = compose();

        await expect(controller.toCheckCount(COOK)).resolves.toEqual({ count: 4 });
        expect(steps.toCheckCount).toHaveBeenCalledExactlyOnceWith(COOK);
    });

    it('putItems names the import from the path', async () => {
        const { controller, imports } = compose();
        const body: PutImportItemsRequest = { items: [] };

        await controller.putItems(COOK, IMPORT_ID, body);

        expect(imports.putItems).toHaveBeenCalledExactlyOnceWith(COOK, IMPORT_ID, body);
    });

    it('getView passes the page query', async () => {
        const { controller, imports } = compose();

        await controller.getView(COOK, IMPORT_ID, { after: 3, limit: 10 });

        expect(imports.getView).toHaveBeenCalledExactlyOnceWith(COOK, IMPORT_ID, { after: 3, limit: 10 });
    });

    it("remove deletes the caller's import and answers nothing", async () => {
        const { controller, imports } = compose();

        await expect(controller.remove(COOK, IMPORT_ID)).resolves.toBeUndefined();
        expect(imports.delete).toHaveBeenCalledExactlyOnceWith(COOK, IMPORT_ID);
    });

    it("advance runs as the caller: the principal and the caller's credential, never a body field", async () => {
        const { controller, advancer } = compose();

        await expect(controller.advance(COOK, CALLER, IMPORT_ID, {})).resolves.toBe(VIEW);
        expect(advancer.advance).toHaveBeenCalledExactlyOnceWith(COOK, CALLER, IMPORT_ID);
    });

    it('step reads one item, with a deadline', async () => {
        const { controller, steps } = compose();

        await expect(controller.step(COOK, CALLER, IMPORT_ID, { ordinal: 2 })).resolves.toBe(STEP);
        expect(steps.step).toHaveBeenCalledExactlyOnceWith(COOK, CALLER, IMPORT_ID, 2, expect.any(AbortSignal));
    });

    it('moveCursor passes the move', async () => {
        const { controller, imports } = compose();
        const body: ImportCursorRequest = { from: 0, move: { action: 'next' } };

        await controller.moveCursor(COOK, IMPORT_ID, body);

        expect(imports.moveCursor).toHaveBeenCalledExactlyOnceWith(COOK, IMPORT_ID, body);
    });

    it('pick records one decision on the item named in the path', async () => {
        const { controller, steps } = compose();
        const body: ImportPickRequest = { lineIndex: 0, foodIndex: 0, against: 'jd', pick: { kind: 'asWritten' } };

        await controller.pick(COOK, CALLER, IMPORT_ID, { ordinal: 2 }, body);

        expect(steps.pick).toHaveBeenCalledExactlyOnceWith(COOK, CALLER, IMPORT_ID, 2, body, expect.any(AbortSignal));
    });

    it('recordChoices answers the step for the item named in the path', async () => {
        const { controller, steps } = compose();
        const body: RecordImportChoicesRequest = { visibility: 'private' };

        await expect(controller.recordChoices(COOK, CALLER, IMPORT_ID, { ordinal: 2 }, body)).resolves.toBe(STEP);
        expect(steps.recordChoices).toHaveBeenCalledExactlyOnceWith(
            COOK,
            CALLER,
            IMPORT_ID,
            2,
            body,
            expect.any(AbortSignal),
        );
    });

    it('recordChoicesBatch passes the entries', async () => {
        const { controller, imports } = compose();
        const body: RecordImportChoicesBatchRequest = { items: [{ ordinal: 0, visibility: 'private' }] };

        await controller.recordChoicesBatch(COOK, IMPORT_ID, body);

        expect(imports.recordChoicesBatch).toHaveBeenCalledExactlyOnceWith(COOK, IMPORT_ID, body);
    });

    it('leave closes the review', async () => {
        const { controller, imports } = compose();

        await expect(controller.leave(COOK, IMPORT_ID, {})).resolves.toBe(VIEW);
        expect(imports.leave).toHaveBeenCalledExactlyOnceWith(COOK, IMPORT_ID);
    });

    it('flagged and toCheck page the lines as the caller, each with a deadline', async () => {
        const { controller, steps } = compose();

        await controller.flagged(COOK, CALLER, IMPORT_ID, { after: 'c', limit: 2 });
        await controller.toCheck(COOK, CALLER, IMPORT_ID, { limit: 7 });

        expect(steps.flagged).toHaveBeenCalledExactlyOnceWith(
            COOK,
            CALLER,
            IMPORT_ID,
            { after: 'c', limit: 2 },
            expect.any(AbortSignal),
        );
        expect(steps.toCheck).toHaveBeenCalledExactlyOnceWith(
            COOK,
            CALLER,
            IMPORT_ID,
            { limit: 7 },
            expect.any(AbortSignal),
        );
    });
});
