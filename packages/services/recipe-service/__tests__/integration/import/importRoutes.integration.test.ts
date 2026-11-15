/**
 * The bulk import's routes over the REAL HTTP pipeline, with every store MOCKED (`docs/CODING_STANDARDS.md` §7.1a,
 * DD12): routing, the auth middleware, the zod pipe, the real import services over fake DALs, the exception filter, and
 * every body parsed against the PUBLISHED contract copy (`@kitchensink/schema-recipe`), the way an installed client parses it.
 *
 * What it pins, and what a unit test of the controller cannot see:
 *
 *  - **Every route exists and answers a body the published schema accepts**, with the status the contract says.
 *  - **`to-check-count` is a literal word, not an import id**: `GET /import/to-check-count` is the count, never a `400` from the
 *    id pipe. A route table that declared `:importId` first would answer `400` here.
 *  - **A stranger's import is a `404`** on every route that names one, exactly as an absent one is.
 *  - **`advance` answers `200`** (not `201`, the `POST` default).
 *  - **A body or an id the contract refuses is a `400` and reaches no store.**
 *  - **The body parser's refusals wear the envelope**: a 150 kB body on `POST /import` is a `413` `PAYLOAD_TOO_LARGE`, and an unsupported content-encoding is a `415`, not a `500`. The import's chunks are sized to it
 *    (`MAX_IMPORT_ITEMS_PER_REQUEST`), so a route that raised it would be a silent change of contract.
 *
 * What the SQL does (ownership scoping, the claims) is the LOCAL e2e tier's: `tests/e2e/import/importRoutes.e2e.test.ts`.
 */
import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    apiErrorSchema,
    importFlaggedResponseSchema,
    importListResponseSchema,
    importPickResponseSchema,
    importStepResponseSchema,
    importToCheckCountResponseSchema,
    importToCheckResponseSchema,
    importViewSchema,
} from '@kitchensink/schema-recipe';
import type { BootedServiceApp } from '@kitchensink/service-test-harness';

import { ErasureJobsDal } from '../../../src/account/dal/erasureJobs.dal.js';
import { ImportAllowanceDal } from '../../../src/common/dal/importAllowance.dal.js';
import {
    IMPORT_ID,
    UNLIMITED_PRIVATE_SLOTS,
    makeHeader,
    makeItem,
    makeLine,
    makeListedItem,
} from '../../../src/import/__fixtures__/importFixtures.js';
import {
    RECIPE_IMPORT_ITEMS_DAL,
    RECIPE_IMPORT_LINES_DAL,
    RECIPE_IMPORTS_DAL,
} from '../../../src/import/import.tokens.js';
import { PRIVATE_SLOTS } from '../../../src/import/privateSlots.port.js';
import { asPrincipal } from '../../../tests/support/asPrincipal.js';
import { bearerFor } from '../../../tests/support/foodFake.js';
import { bootMockedRecipeApp } from '../../../tests/support/mockedRecipeApp.js';

const COOK = '01JIMPORTROUTESCOOK000001';
const STRANGER = '01JIMPORTROUTESSTRANGER01';
const ABSENT_ID = '66666666-6666-4666-8666-0000000000ff';
const BASE = '/api/v1/import';
const ALLOWANCE = { limit: 1000, used: 3, resetsAt: '2026-10-27T12:00:00.000Z' };

const imports = {
    insertHeader: vi.fn(),
    findHeader: vi.fn(),
    listHeaders: vi.fn(),
    deleteHeader: vi.fn(),
    touch: vi.fn(),
    moveCursor: vi.fn(),
    closeReview: vi.fn(),
    countsByStage: vi.fn(),
    verdictFingerprint: vi.fn(),
    countUnsavedPrivate: vi.fn(),
};
const items = {
    upsertItems: vi.fn(),
    recordChoices: vi.fn(),
    recordChoicesBatch: vi.fn(),
    findPage: vi.fn(),
    findItem: vi.fn(),
    payUnpaid: vi.fn(),
    findNeedingJob: vi.fn(),
    findParsing: vi.fn(),
    findSaveCandidates: vi.fn(),
};
const lines = {
    findForItem: vi.fn(),
    findLinkedForItem: vi.fn(),
    findLine: vi.fn(),
    recordPick: vi.fn(),
    listFlaggable: vi.fn(),
    listToCheck: vi.fn(),
    countToCheck: vi.fn(),
    claimCurationReport: vi.fn(),
};
const allowance = { stateOf: vi.fn() };

let booted: BootedServiceApp;

async function call(
    principal: string,
    method: string,
    path: string,
    body?: unknown,
): Promise<{ status: number; json: unknown }> {
    const response = await asPrincipal(principal, () =>
        fetch(`${booted.baseUrl}${BASE}${path}`, {
            method,
            headers: { authorization: bearerFor(principal), 'content-type': 'application/json' },
            ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
        }),
    );
    const text = await response.text();

    return { status: response.status, json: text === '' ? undefined : (JSON.parse(text) as unknown) };
}

const recipe = {
    title: 'Pancakes',
    cuisine: 'American',
    servings: 4,
    prepTimeMinutes: 5,
    cookTimeMinutes: 10,
    totalTimeMinutes: 15,
    ingredientLines: ['2 cups flour'],
    steps: [{ instruction: 'Mix and cook.' }],
};

beforeAll(async () => {
    booted = await bootMockedRecipeApp({
        doubles: [
            { provide: RECIPE_IMPORTS_DAL, useValue: imports },
            { provide: RECIPE_IMPORT_ITEMS_DAL, useValue: items },
            { provide: RECIPE_IMPORT_LINES_DAL, useValue: lines },
            { provide: ImportAllowanceDal, useValue: allowance },
            { provide: PRIVATE_SLOTS, useValue: UNLIMITED_PRIVATE_SLOTS },
            { provide: ErasureJobsDal, useValue: { findActiveJob: async () => undefined } },
        ],
    });
});

afterAll(async () => {
    await booted?.close();
});

beforeEach(() => {
    for (const store of [imports, items, lines, allowance]) {
        for (const fn of Object.values(store)) {
            fn.mockReset();
        }
    }

    // Only the COOK's import exists: a stranger asking for it gets what an absent id gets.
    imports.findHeader.mockImplementation(async (userId: string, id: string) =>
        userId === COOK && id === IMPORT_ID ? makeHeader({ userId: COOK }) : undefined,
    );
    imports.insertHeader.mockImplementation(async (userId: string) =>
        userId === COOK ? { kind: 'created', header: makeHeader({ userId: COOK }) } : { kind: 'foreign' },
    );
    imports.listHeaders.mockResolvedValue([
        {
            ...makeHeader({ userId: COOK }),
            counts: { total: 3, received: 3, parsing: 0, matched: 0, saved: 0, refused: 0 },
        },
    ]);
    imports.deleteHeader.mockImplementation(async (userId: string, id: string) => userId === COOK && id === IMPORT_ID);
    imports.closeReview.mockImplementation(async (userId: string, id: string) => userId === COOK && id === IMPORT_ID);
    imports.moveCursor.mockResolvedValue({ kind: 'moved' });
    imports.countsByStage.mockResolvedValue({ total: 3, received: 3, parsing: 0, matched: 0, saved: 0, refused: 0 });
    imports.verdictFingerprint.mockResolvedValue({ count: 0, latest: null });
    imports.countUnsavedPrivate.mockResolvedValue(0);
    items.upsertItems.mockResolvedValue({ kind: 'stored' });
    items.recordChoices.mockResolvedValue('recorded');
    items.recordChoicesBatch.mockResolvedValue({ kind: 'recorded' });
    items.findPage.mockResolvedValue([makeListedItem({ stage: 'received' })]);
    items.findItem.mockResolvedValue(makeItem({ stage: 'received' }));
    items.payUnpaid.mockResolvedValue({ kind: 'nothing' });
    items.findNeedingJob.mockResolvedValue([]);
    items.findParsing.mockResolvedValue([]);
    items.findSaveCandidates.mockResolvedValue([]);
    lines.findForItem.mockResolvedValue([]);
    lines.findLinkedForItem.mockResolvedValue(new Map());
    lines.findLine.mockResolvedValue(makeLine({ judgementDigest: 'jd-now' }));
    lines.listFlaggable.mockResolvedValue([]);
    lines.listToCheck.mockResolvedValue([]);
    lines.countToCheck.mockResolvedValue(7);
    allowance.stateOf.mockResolvedValue(ALLOWANCE);
});

describe('the bulk import routes answer bodies the published contract parses', () => {
    it('POST /import answers 201 with the view', async () => {
        const { status, json } = await call(COOK, 'POST', '', {
            id: IMPORT_ID,
            expectedTotal: 3,
            matchMode: 'keepAsWritten',
            visibility: 'private',
            items: [{ ordinal: 0, recipe }],
        });

        expect(status).toBe(201);
        expect(importViewSchema.parse(json).id).toBe(IMPORT_ID);
        expect(imports.insertHeader).toHaveBeenCalledWith(COOK, expect.objectContaining({ id: IMPORT_ID }));
    });

    it("GET /import answers 200 with the caller's imports", async () => {
        const { status, json } = await call(COOK, 'GET', '?limit=5');

        expect(status).toBe(200);
        expect(importListResponseSchema.parse(json).imports).toHaveLength(1);
        expect(imports.listHeaders).toHaveBeenCalledWith(COOK, undefined, 6);
    });

    it('GET /import/to-check-count is the count and is not shadowed by :importId', async () => {
        const { status, json } = await call(COOK, 'GET', '/to-check-count');

        expect(status).toBe(200);
        expect(importToCheckCountResponseSchema.parse(json)).toEqual({ count: 7 });
        expect(lines.countToCheck).toHaveBeenCalledWith(COOK);
    });

    it('PUT /import/:id/items answers 200 with the view', async () => {
        const { status, json } = await call(COOK, 'PUT', `/${IMPORT_ID}/items`, { items: [{ ordinal: 1, recipe }] });

        expect(status).toBe(200);
        expect(importViewSchema.parse(json).id).toBe(IMPORT_ID);
    });

    it('GET /import/:id answers 200 with one page of items', async () => {
        const { status, json } = await call(COOK, 'GET', `/${IMPORT_ID}?after=0&limit=2`);

        expect(status).toBe(200);
        expect(importViewSchema.parse(json).items).toHaveLength(1);
        expect(items.findPage).toHaveBeenCalledWith(IMPORT_ID, 0, 3);
    });

    it('DELETE /import/:id answers 204 with no body', async () => {
        const { status, json } = await call(COOK, 'DELETE', `/${IMPORT_ID}`);

        expect(status).toBe(204);
        expect(json).toBeUndefined();
        expect(imports.deleteHeader).toHaveBeenCalledWith(COOK, IMPORT_ID);
    });

    it('⛔ POST /import/:id/advance answers 200, never 201, with the view', async () => {
        const { status, json } = await call(COOK, 'POST', `/${IMPORT_ID}/advance`, {});

        expect(status).toBe(200);
        expect(importViewSchema.parse(json).id).toBe(IMPORT_ID);
        expect(imports.touch).toHaveBeenCalledWith(IMPORT_ID);
    });

    it.each(['advance', 'leave'])('POST /import/:id/%s with no body at all answers 200', async (route) => {
        const { status } = await call(COOK, 'POST', `/${IMPORT_ID}/${route}`);

        expect(status).toBe(200);
    });

    it('GET /import/:id/steps/:ordinal answers 200 with the step', async () => {
        const { status, json } = await call(COOK, 'GET', `/${IMPORT_ID}/steps/0`);

        expect(status).toBe(200);
        expect(importStepResponseSchema.parse(json).ordinal).toBe(0);
        expect(items.findItem).toHaveBeenCalledWith(IMPORT_ID, 0);
    });

    it('POST /import/:id/cursor answers 200 with the view', async () => {
        const { status, json } = await call(COOK, 'POST', `/${IMPORT_ID}/cursor`, {
            from: 0,
            move: { action: 'next' },
        });

        expect(status).toBe(200);
        expect(importViewSchema.parse(json).id).toBe(IMPORT_ID);
    });

    it('PUT /import/:id/items/:ordinal/pick answers 200 with the pick', async () => {
        const { status, json } = await call(COOK, 'PUT', `/${IMPORT_ID}/items/0/pick`, {
            lineIndex: 0,
            foodIndex: 0,
            against: 'a-digest-that-moved',
            pick: { kind: 'asWritten' },
        });

        expect(status).toBe(200);
        expect(importPickResponseSchema.parse(json).applied).toBe(false);
    });

    it('POST /import/:id/items/:ordinal answers 200 with the step', async () => {
        const { status, json } = await call(COOK, 'POST', `/${IMPORT_ID}/items/0`, { visibility: 'private' });

        expect(status).toBe(200);
        expect(importStepResponseSchema.parse(json).ordinal).toBe(0);
        expect(items.recordChoices).toHaveBeenCalledWith(IMPORT_ID, 0, { visibility: 'private' });
    });

    it('POST /import/:id/choices answers 200 with the view', async () => {
        const { status, json } = await call(COOK, 'POST', `/${IMPORT_ID}/choices`, {
            items: [{ ordinal: 0, visibility: 'private' }],
        });

        expect(status).toBe(200);
        expect(importViewSchema.parse(json).id).toBe(IMPORT_ID);
    });

    it('POST /import/:id/leave answers 200 with the view', async () => {
        const { status, json } = await call(COOK, 'POST', `/${IMPORT_ID}/leave`, {});

        expect(status).toBe(200);
        expect(importViewSchema.parse(json).id).toBe(IMPORT_ID);
        expect(imports.closeReview).toHaveBeenCalledWith(COOK, IMPORT_ID);
    });

    it('GET /import/:id/flagged answers 200', async () => {
        const { status, json } = await call(COOK, 'GET', `/${IMPORT_ID}/flagged?limit=3`);

        expect(status).toBe(200);
        expect(importFlaggedResponseSchema.parse(json)).toEqual({ lines: [], nextAfter: null });
    });

    it('GET /import/:id/to-check answers 200', async () => {
        const { status, json } = await call(COOK, 'GET', `/${IMPORT_ID}/to-check`);

        expect(status).toBe(200);
        expect(importToCheckResponseSchema.parse(json)).toEqual({ lines: [], nextAfter: null });
    });
});

describe('⛔ a stranger gets a 404, exactly as for an absent import', () => {
    const body = {
        put: { items: [{ ordinal: 1, recipe }] },
        cursor: { from: 0, move: { action: 'next' } },
        pick: { lineIndex: 0, foodIndex: 0, against: 'jd', pick: { kind: 'asWritten' } },
        choices: { items: [{ ordinal: 0, visibility: 'private' }] },
    };

    it.each([
        ['PUT', '/items', body.put],
        ['GET', '', undefined],
        ['DELETE', '', undefined],
        ['POST', '/advance', {}],
        ['GET', '/steps/0', undefined],
        ['POST', '/cursor', body.cursor],
        ['PUT', '/items/0/pick', body.pick],
        ['POST', '/items/0', { visibility: 'private' }],
        ['POST', '/choices', body.choices],
        ['POST', '/leave', {}],
        ['GET', '/flagged', undefined],
        ['GET', '/to-check', undefined],
    ])('%s %s', async (method, suffix, payload) => {
        const stranger = await call(STRANGER, method, `/${IMPORT_ID}${suffix}`, payload);
        const absent = await call(COOK, method, `/${ABSENT_ID}${suffix}`, payload);

        expect(stranger.status).toBe(404);
        expect(absent.status).toBe(404);
        expect(stranger.json).toMatchObject({ code: 'IMPORT_NOT_FOUND' });
    });

    it('POST /import with an id another cook holds is a 404', async () => {
        const { status } = await call(STRANGER, 'POST', '', {
            id: IMPORT_ID,
            expectedTotal: 1,
            matchMode: 'keepAsWritten',
            visibility: 'private',
            items: [{ ordinal: 0, recipe }],
        });

        expect(status).toBe(404);
    });
});

describe('a request the contract refuses is a 400 and reaches no store', () => {
    it.each([
        ['POST /import with a key the client invented', 'POST', '', { id: IMPORT_ID, boundBy: 'x' }],
        [
            'POST /import with no items',
            'POST',
            '',
            { id: IMPORT_ID, expectedTotal: 1, matchMode: 'keepAsWritten', visibility: 'private' },
        ],
        ['PUT items with an empty list', 'PUT', `/${IMPORT_ID}/items`, { items: [] }],
        ['advance with a body key', 'POST', `/${IMPORT_ID}/advance`, { userId: COOK }],
        ['cursor with an unknown action', 'POST', `/${IMPORT_ID}/cursor`, { from: 0, move: { action: 'teleport' } }],
        ['pick with no decision', 'PUT', `/${IMPORT_ID}/items/0/pick`, { lineIndex: 0, foodIndex: 0, against: 'jd' }],
        ['choices that say nothing', 'POST', `/${IMPORT_ID}/items/0`, {}],
        ['batch choices with an empty list', 'POST', `/${IMPORT_ID}/choices`, { items: [] }],
        ['leave with a body key', 'POST', `/${IMPORT_ID}/leave`, { force: true }],
    ])('%s', async (_name, method, path, payload) => {
        const { status } = await call(COOK, method, path, payload);

        expect(status).toBe(400);
        expect(imports.insertHeader).not.toHaveBeenCalled();
        expect(items.upsertItems).not.toHaveBeenCalled();
        expect(items.recordChoices).not.toHaveBeenCalled();
        expect(items.recordChoicesBatch).not.toHaveBeenCalled();
        expect(imports.moveCursor).not.toHaveBeenCalled();
        expect(imports.touch).not.toHaveBeenCalled();
        expect(imports.closeReview).not.toHaveBeenCalled();
    });

    it.each([
        ['a non-UUID import id', `/not-a-uuid`],
        ['a non-UUID import id on a child route', `/not-a-uuid/flagged`],
        ['a negative ordinal', `/${IMPORT_ID}/steps/-1`],
        ['a fractional ordinal', `/${IMPORT_ID}/steps/1.5`],
        ['an ordinal past int4', `/${IMPORT_ID}/steps/2147483648`],
        ['a page size of 0', `/${IMPORT_ID}?limit=0`],
        ['a non-numeric cursor', `/${IMPORT_ID}?after=abc`],
    ])('GET with %s', async (_name, path) => {
        const { status } = await call(COOK, 'GET', path);

        expect(status).toBe(400);
        expect(imports.findHeader).not.toHaveBeenCalled();
    });
});

describe('the body parser refuses with the published envelope', () => {
    it('⛔ answers a 150 kB body on POST /import with 413 PAYLOAD_TOO_LARGE', async () => {
        const { status, json } = await call(
            COOK,
            'POST',
            '',
            JSON.stringify({ id: IMPORT_ID, padding: 'a'.repeat(150_000) }),
        );

        expect(status).toBe(413);
        expect(apiErrorSchema.parse(json).code).toBe('PAYLOAD_TOO_LARGE');
        expect(imports.insertHeader).not.toHaveBeenCalled();
    });

    // Nest maps the parser's `SyntaxError` to its own 400, so malformed JSON never reaches the parser link: it is the
    // envelope's `BAD_REQUEST`. What reaches the link is the parser's http-errors that are not a SyntaxError.
    it('answers malformed JSON with 400 in the published envelope', async () => {
        const { status, json } = await call(COOK, 'POST', '', 'not json {');

        expect(status).toBe(400);
        expect(apiErrorSchema.parse(json).code).toBe('BAD_REQUEST');
        expect(imports.insertHeader).not.toHaveBeenCalled();
    });

    it('⛔ answers an unsupported content-encoding with 415 UNSUPPORTED_MEDIA_TYPE, not a 500', async () => {
        const response = await asPrincipal(COOK, () =>
            fetch(`${booted.baseUrl}${BASE}`, {
                method: 'POST',
                headers: {
                    authorization: bearerFor(COOK),
                    'content-type': 'application/json',
                    'content-encoding': 'x-unknown',
                },
                body: '{"title":"MARKER-encoded-body"}',
            }),
        );
        const text = await response.text();

        expect(response.status).toBe(415);
        expect(apiErrorSchema.parse(JSON.parse(text)).code).toBe('UNSUPPORTED_MEDIA_TYPE');
        expect(text).not.toContain('MARKER-encoded-body');
        expect(imports.insertHeader).not.toHaveBeenCalled();
    });
});

describe('every route needs a verified caller', () => {
    const ROUTES: ReadonlyArray<readonly [method: string, path: string]> = [
        ['POST', ''],
        ['GET', ''],
        ['GET', '/to-check-count'],
        ['PUT', `/${IMPORT_ID}/items`],
        ['GET', `/${IMPORT_ID}`],
        ['DELETE', `/${IMPORT_ID}`],
        ['POST', `/${IMPORT_ID}/advance`],
        ['GET', `/${IMPORT_ID}/steps/0`],
        ['POST', `/${IMPORT_ID}/cursor`],
        ['PUT', `/${IMPORT_ID}/items/0/pick`],
        ['POST', `/${IMPORT_ID}/items/0`],
        ['POST', `/${IMPORT_ID}/choices`],
        ['POST', `/${IMPORT_ID}/leave`],
        ['GET', `/${IMPORT_ID}/flagged`],
        ['GET', `/${IMPORT_ID}/to-check`],
    ];

    it.each(ROUTES)('%s %s answers 401 with no token', async (method, path) => {
        const response = await fetch(`${booted.baseUrl}${BASE}${path}`, {
            method,
            headers: { 'content-type': 'application/json' },
            ...(method === 'GET' || method === 'DELETE' ? {} : { body: '{}' }),
        });

        expect(response.status).toBe(401);
    });
});
