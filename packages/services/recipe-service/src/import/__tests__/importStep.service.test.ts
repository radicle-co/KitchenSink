/**
 * `ImportStepService` — one item with its match lines (the wizard step), the cook's picks, and the two worklists: the lines
 * the import bound that may need a second look (“flagged”), and the lines saved as written that wait for the cook (“to check”)
 * (ADR-0072 §6, §7, §10). Over fakes for every port.
 *
 * What each case guards:
 *
 *  - **A pick on an UNSAVED item is recorded against the judgement the cook saw**; a stale one is `applied: false` with the
 *    fresh step (neither an error nor silent).
 *  - **A pick on a SAVED line rebinds the draft as `cook`** through the ONE rebind command (so the version, the correction and
 *    the visibility rules apply), and the pick is recorded only AFTER the rebind succeeded: recording first would hide a line
 *    from the to-check list that was never rebound.
 *  - **“Keep as written” is acceptance, not an unbind.** On a line that is already as written it records the acceptance; on a
 *    line the import bound it is a validation failure (unbinding is the editor's).
 *  - **Flagged is DERIVED**: a `clear` line is not listed, a page may be short only when `nextAfter` says more follow, and the
 *    scan is bounded.
 *  - **The to-check count is the library-wide count of lines still waiting.**
 */
import { describe, expect, it, vi } from 'vitest';

import { RecipeErrorCode } from '@kitchensink/recipe-core';

import { CallerToken } from '../../auth/CallerToken.js';
import { actingPrincipalOf } from '../../auth/principal.js';
import { isRecipeDomainError } from '../../recipes/recipe.error.js';
import {
    importFlaggedResponseSchema,
    importStepResponseSchema,
    importToCheckResponseSchema,
} from '../../recipes/import.schema.js';
import type { ParseProposalMatch } from '../../recipes/parseJobs.schema.js';
import { encodeLineCursor } from '../domain/importPaging.js';
import {
    IMPORT_ID,
    makeHeader,
    makeItem,
    makeLine,
    makePrincipal,
    makeRecipeResponse,
    USER,
} from '../__fixtures__/importFixtures.js';
import type { ImportLineView } from '../importLineView.js';
import { ImportStepService } from '../importStep.service.js';
import type { ListedLine } from '../dal/recipeImportLines.dal.js';

const CALLER = CallerToken.fromAuthorizationHeader('Bearer cook-token');
const COOK = makePrincipal();
const RECIPE_ID = '66666666-6666-4666-8666-0000000000a1';
const MATCH: ParseProposalMatch = {
    state: 'checking',
    reason: 'awaitingReview',
    proposed: { kind: 'root', id: 'F-whole', name: 'Milk, whole' },
    candidates: [{ kind: 'root', id: 'F-whole', name: 'Milk, whole', isDefault: false }],
};
const SAVED = makeItem({
    stage: 'saved',
    savedAt: new Date(),
    matchedAt: new Date(),
    allowanceSpentAt: new Date(),
    recipeId: RECIPE_ID,
    statementKind: 'authored',
});

const listedLine = (lineIndex: number, overrides: Partial<ListedLine> = {}): ListedLine => ({
    line: makeLine({ id: `L${String(lineIndex)}`, lineIndex, judgementDigest: `jd-${String(lineIndex)}` }),
    title: 'Soup',
    ingredientId: `ING-${String(lineIndex)}`,
    recipeId: RECIPE_ID,
    sortOrder: lineIndex,
    boundBy: 'autoBest',
    foodLookupId: `LK-${String(lineIndex)}`,
    savedVerificationKey: `v1:saved-${String(lineIndex)}`,
    ...overrides,
});

function build(
    options: {
        readonly header?: ReturnType<typeof makeHeader> | undefined;
        readonly item?: ReturnType<typeof makeItem> | undefined;
        readonly lines?: ReturnType<typeof makeLine>[];
        readonly linked?: Map<
            string,
            { boundBy: 'autoBest' | 'cook' | null; recipeId?: string; sortOrder?: number; foodLookupId?: string }
        >;
        readonly pick?: 'applied' | 'stale' | 'missing' | 'saved';
        readonly line?: ReturnType<typeof makeLine> | undefined;
        readonly linkedIngredient?:
            { recipeId: string; sortOrder: number; boundBy: 'autoBest' | 'cook' | null } | undefined;
        readonly flaggable?: ListedLine[][];
        readonly toCheck?: ListedLine[];
        readonly flags?: Map<
            string,
            {
                bound: { kind: 'root'; id: string; name: string | null };
                flag: { state: 'clear' } | { state: 'checking' } | { state: 'flagged'; suggestion: null };
            }
        >;
        readonly choices?: 'ok' | 'saved' | 'missing';
        readonly count?: number;
        readonly version?: number;
    } = {},
) {
    const header = 'header' in options ? options.header : makeHeader();
    const item = 'item' in options ? options.item : makeItem({ stage: 'matched', matchedAt: new Date() });
    const lines = options.lines ?? [makeLine({ id: 'L0' })];
    const imports = { findHeader: vi.fn(async () => header) };
    const itemsDal = {
        findItem: vi.fn(async () => item),
        recordChoices: vi.fn(async () => options.choices ?? 'ok'),
    };
    const flaggable = [...(options.flaggable ?? [])];
    const linesDal = {
        findForItem: vi.fn(async () => lines),
        findLinkedForItem: vi.fn(
            async () =>
                new Map(
                    [...(options.linked ?? new Map()).entries()].map(([id, linked]) => [
                        id,
                        { ingredientId: 'I', recipeId: RECIPE_ID, sortOrder: 0, foodLookupId: 'LK', ...linked },
                    ]),
                ),
        ),
        findLine: vi.fn(async () => ('line' in options ? options.line : lines[0])),
        recordPick: vi.fn(async (..._args: unknown[]) => options.pick ?? 'applied'),
        findLinkedIngredient: vi.fn(async () =>
            'linkedIngredient' in options
                ? options.linkedIngredient === undefined
                    ? undefined
                    : {
                          ingredientId: 'I',
                          foodLookupId: 'LK',
                          recipeVersion: options.version ?? 4,
                          ...options.linkedIngredient,
                      }
                : undefined,
        ),
        listFlaggable: vi.fn(async () => flaggable.shift() ?? []),
        listToCheck: vi.fn(async () => options.toCheck ?? []),
        countToCheck: vi.fn(async () => options.count ?? 0),
    };
    const lineView = {
        matchesOf: vi.fn<ImportLineView['matchesOf']>(
            async (_acting, _caller, rows): Promise<ReadonlyMap<string, ParseProposalMatch | null>> =>
                new Map(rows.map((row) => [row.id, MATCH] as const)),
        ),
        flagsOf: vi.fn<ImportLineView['flagsOf']>(async () => options.flags ?? new Map()),
    };
    const rebind = {
        rebind: vi.fn(
            async (_principal: unknown, _recipeId: string, _position: number, _body: unknown, _caller: unknown) =>
                makeRecipeResponse(),
        ),
    };
    const service = new ImportStepService(imports, itemsDal, linesDal, lineView, rebind);

    return { service, imports, itemsDal, linesDal, lineView, rebind };
}

const codeOf = async (promise: Promise<unknown>): Promise<unknown> => {
    const error: unknown = await promise.catch((thrown: unknown) => thrown);

    return isRecipeDomainError(error)
        ? error.code
        : (error as { getResponse?: () => { code: string } }).getResponse?.().code;
};

// The route's request deadline reaches every read the line view makes (verdicts and food), as the paste route's does, so a
// stalled table cannot hold a request past the client's timeout.
describe('ImportStepService — the request deadline reaches the line view', () => {
    const deadline = new AbortController().signal;

    it('on the step: both the match read and the flag read', async () => {
        const { service, lineView } = build();

        await service.step(COOK, CALLER, IMPORT_ID, 0, deadline);

        expect(lineView.matchesOf.mock.calls[0]?.[3]).toBe(deadline);
        expect(lineView.flagsOf.mock.calls[0]?.[3]).toBe(deadline);
    });

    it('on the to-check list', async () => {
        const { service, lineView } = build({ toCheck: [] });

        await service.toCheck(COOK, CALLER, IMPORT_ID, { limit: 5 }, deadline);

        expect(lineView.matchesOf.mock.calls[0]?.[3]).toBe(deadline);
    });

    it('on the flagged list: the flag scan and the match read', async () => {
        const { service, lineView } = build();

        await service.flagged(COOK, CALLER, IMPORT_ID, { limit: 5 }, deadline);

        expect(lineView.flagsOf.mock.calls[0]?.[3]).toBe(deadline);
        expect(lineView.matchesOf.mock.calls[0]?.[3]).toBe(deadline);
    });
});

describe('ImportStepService.step', () => {
    it('shows an unsaved item’s lines with their match, measure and judgement, and no flag or origin', async () => {
        const { service } = build({
            lines: [makeLine({ id: 'L0', preparation: 'chopped', quantity: '2', quantityHigh: '3' })],
        });
        const step = await service.step(COOK, CALLER, IMPORT_ID, 0, undefined);

        expect(importStepResponseSchema.parse(step)).toEqual(step);
        expect(step).toMatchObject({
            ordinal: 0,
            title: 'Soup',
            stage: 'matched',
            lines: [
                {
                    lineIndex: 0,
                    foodIndex: 0,
                    sourceLine: '2 cups whole milk',
                    phrase: 'whole milk',
                    measure: { quantity: { kind: 'range', low: 2, high: 3 }, unit: 'cup', preparation: 'chopped' },
                    judgementDigest: 'jd-0',
                    match: MATCH,
                    flag: null,
                    pick: null,
                    boundBy: null,
                },
            ],
        });
    });

    it('⛔ shows the row the import saves: its name, and the shown words and note only when the parse gave them', async () => {
        const { service } = build({
            lines: [
                makeLine({ id: 'L0', phrase: 'large eggs', name: 'eggs', unit: 'large', quantity: '3' }),
                makeLine({
                    id: 'L1',
                    lineIndex: 1,
                    phrase: '9 inch pie pastry',
                    name: 'pie pastry',
                    displayText: 'my pie pastry',
                    note: '9 inch',
                }),
            ],
        });
        const step = await service.step(COOK, CALLER, IMPORT_ID, 0, undefined);

        expect(importStepResponseSchema.parse(step)).toEqual(step);
        expect(step.lines[0]).toMatchObject({ phrase: 'large eggs', name: 'eggs', measure: { unit: 'large' } });
        expect(step.lines[0]).not.toHaveProperty('displayText');
        expect(step.lines[0]).not.toHaveProperty('note');
        expect(step.lines[1]).toMatchObject({ name: 'pie pastry', displayText: 'my pie pastry', note: '9 inch' });
    });

    it('reads a source that stated no amount as an absent quantity, never a fabricated 1', async () => {
        const { service } = build({ lines: [makeLine({ id: 'L0', quantity: null, quantityHigh: null, unit: '' })] });
        const step = await service.step(COOK, CALLER, IMPORT_ID, 0, undefined);

        expect(step.lines[0]?.measure).toEqual({ quantity: { kind: 'absent' }, unit: '' });
    });

    it('shows the cook’s pick', async () => {
        const { service } = build({
            lines: [
                makeLine({ id: 'L0', pickedFoodId: 'F-skim', pickedAgainstDigest: 'jd-0' }),
                makeLine({ id: 'L1', lineIndex: 1, pickedFoodVariantId: 'V1', pickedAgainstDigest: 'jd-0' }),
                makeLine({ id: 'L2', lineIndex: 2, pickedAsWritten: true, pickedAgainstDigest: 'jd-0' }),
            ],
        });
        const step = await service.step(COOK, CALLER, IMPORT_ID, 0, undefined);

        expect(step.lines.map((line) => line.pick)).toEqual([
            { kind: 'food', id: 'F-skim' },
            { kind: 'variant', id: 'V1' },
            { kind: 'asWritten' },
        ]);
    });

    it('⛔ shows a saved item’s origin and flag for the lines the import bound, and none for a line kept as written', async () => {
        const flag = {
            bound: { kind: 'root' as const, id: 'F-whole', name: 'Milk, whole' },
            flag: { state: 'checking' as const },
        };
        const { service, lineView } = build({
            item: SAVED,
            lines: [makeLine({ id: 'L0' }), makeLine({ id: 'L1', lineIndex: 1 }), makeLine({ id: 'L2', lineIndex: 2 })],
            linked: new Map([
                ['L0', { boundBy: 'autoBest' }],
                ['L1', { boundBy: null }],
                ['L2', { boundBy: 'cook' }],
            ]),
            flags: new Map([['L0', flag]]),
        });
        const step = await service.step(COOK, CALLER, IMPORT_ID, 0, undefined);

        expect(step.lines.map((line) => [line.boundBy, line.flag])).toEqual([
            ['autoBest', { state: 'checking' }],
            [null, null],
            ['cook', null],
        ]);
        // Only the import-bound line is asked about: the cook's own and the as-written ones have nothing to flag.
        expect(vi.mocked(lineView.flagsOf).mock.calls[0]?.[2].map((row: ListedLine) => row.line.id)).toEqual(['L0']);
    });

    it('passes a match food could not name through as null', async () => {
        const { service, lineView } = build();

        lineView.matchesOf.mockResolvedValueOnce(new Map([['L0', null]]));

        expect((await service.step(COOK, CALLER, IMPORT_ID, 0, undefined)).lines[0]?.match).toBeNull();
    });

    it('⛔ is not found for a stranger’s import and for an item that never arrived', async () => {
        expect(await codeOf(build({ header: undefined }).service.step(COOK, CALLER, IMPORT_ID, 0, undefined))).toBe(
            RecipeErrorCode.IMPORT_NOT_FOUND,
        );
        expect(await codeOf(build({ item: undefined }).service.step(COOK, CALLER, IMPORT_ID, 0, undefined))).toBe(
            RecipeErrorCode.IMPORT_NOT_FOUND,
        );
    });
});

describe('ImportStepService.step — the cuisine the save will use (ADR-0072 §3 as amended 2026-11-11)', () => {
    const matched = (overrides: Parameters<typeof makeItem>[0]) =>
        makeItem({ stage: 'matched', matchedAt: new Date(), ...overrides });

    it("shows the file's cuisine when the cook gave none", async () => {
        const step = await build({ item: matched({ payload: { title: 'Soup', cuisine: 'French' } }) }).service.step(
            COOK,
            CALLER,
            IMPORT_ID,
            0,
            undefined,
        );

        expect(step.cuisine).toBe('French');
    });

    it("shows the cook's cuisine over the file's", async () => {
        const step = await build({
            item: matched({ cuisine: 'Thai', payload: { title: 'Soup', cuisine: 'French' } }),
        }).service.step(COOK, CALLER, IMPORT_ID, 0, undefined);

        expect(step.cuisine).toBe('Thai');
    });

    it('⛔ shows null when neither gave one: the wizard asks the cook, and nothing is made up', async () => {
        const step = await build({ item: matched({ payload: { title: 'Soup' } }) }).service.step(
            COOK,
            CALLER,
            IMPORT_ID,
            0,
            undefined,
        );

        expect(step.cuisine).toBeNull();
    });
});

describe('ImportStepService.recordChoices', () => {
    it('records the choices and answers the step', async () => {
        const { service, itemsDal } = build();
        const step = await service.recordChoices(COOK, CALLER, IMPORT_ID, 0, { visibility: 'private' }, undefined);

        expect(itemsDal.recordChoices).toHaveBeenCalledWith(IMPORT_ID, 0, { visibility: 'private' });
        expect(step.ordinal).toBe(0);
    });

    it('passes a cuisine to the item as a decision of the cook', async () => {
        const { service, itemsDal } = build();

        await service.recordChoices(COOK, CALLER, IMPORT_ID, 0, { cuisine: 'Thai' }, undefined);

        expect(itemsDal.recordChoices).toHaveBeenCalledWith(IMPORT_ID, 0, { cuisine: 'Thai' });
    });

    it('maps a saved item to IMPORT_ITEM_ALREADY_SAVED and a missing one to not found', async () => {
        expect(
            await codeOf(
                build({ choices: 'saved' }).service.recordChoices(
                    COOK,
                    CALLER,
                    IMPORT_ID,
                    0,
                    { visibility: 'public' },
                    undefined,
                ),
            ),
        ).toBe(RecipeErrorCode.IMPORT_ITEM_ALREADY_SAVED);
        expect(
            await codeOf(
                build({ choices: 'missing' }).service.recordChoices(
                    COOK,
                    CALLER,
                    IMPORT_ID,
                    0,
                    {
                        visibility: 'public',
                    },
                    undefined,
                ),
            ),
        ).toBe(RecipeErrorCode.IMPORT_NOT_FOUND);
    });
});

describe('ImportStepService.pick — an unsaved item', () => {
    const food = { lineIndex: 0, foodIndex: 0, against: 'jd-0', pick: { kind: 'food' as const, id: 'F-skim' } };

    it('records the pick against the judgement the cook saw and answers applied with the step', async () => {
        const { service, linesDal, rebind } = build();
        const answer = await service.pick(COOK, CALLER, IMPORT_ID, 0, food, undefined);

        // An item that is not saved yet: the write is fenced against a racing save (`onlyUnsaved`).
        expect(linesDal.recordPick).toHaveBeenCalledWith(
            USER,
            IMPORT_ID,
            0,
            0,
            0,
            'jd-0',
            { kind: 'food', id: 'F-skim' },
            { onlyUnsaved: true },
        );
        expect(answer.applied).toBe(true);
        expect(importStepResponseSchema.parse(answer.step)).toEqual(answer.step);
        expect(rebind.rebind).not.toHaveBeenCalled();
    });

    it('⛔ answers a stale pick as applied: false with the FRESH step (neither an error nor silent)', async () => {
        const { service } = build({ pick: 'stale' });
        const answer = await service.pick(COOK, CALLER, IMPORT_ID, 0, food, undefined);

        expect(answer.applied).toBe(false);
        expect(answer.step.ordinal).toBe(0);
    });

    it('is not found for a line the caller does not have', async () => {
        expect(await codeOf(build({ pick: 'missing' }).service.pick(COOK, CALLER, IMPORT_ID, 0, food, undefined))).toBe(
            RecipeErrorCode.IMPORT_NOT_FOUND,
        );
    });
});

describe('ImportStepService.pick — a SAVED line rebinds the draft as the cook', () => {
    const saved = (extra: Parameters<typeof build>[0] = {}) =>
        build({
            item: SAVED,
            line: makeLine({ id: 'L0', judgementDigest: 'jd-0' }),
            linkedIngredient: { recipeId: RECIPE_ID, sortOrder: 3, boundBy: 'autoBest' },
            ...extra,
        });
    const request = (pick: { kind: 'food'; id: string } | { kind: 'variant'; id: string } | { kind: 'asWritten' }) => ({
        lineIndex: 0,
        foodIndex: 0,
        against: 'jd-0',
        pick,
    });

    it('⛔ rebinds the ingredient at its position to the picked FOOD through the one rebind command, at the draft’s current version', async () => {
        const { service, rebind } = saved({ version: 7 });

        const answer = await service.pick(
            COOK,
            CALLER,
            IMPORT_ID,
            0,
            request({ kind: 'food', id: 'F-skim' }),
            undefined,
        );

        // The version is the one read WITH the line's position (`findLinkedIngredient`), never a second read.
        expect(rebind.rebind).toHaveBeenCalledWith(
            COOK,
            RECIPE_ID,
            3,
            { expectedVersion: 7, target: { kind: 'catalogFood', foodId: 'F-skim' } },
            CALLER,
        );
        expect(answer.applied).toBe(true);
    });

    it('rebinds a picked VARIANT through the variant door', async () => {
        const { service, rebind } = saved();

        await service.pick(COOK, CALLER, IMPORT_ID, 0, request({ kind: 'variant', id: 'V-flat' }), undefined);

        expect(rebind.rebind.mock.calls[0]?.[3]).toEqual({
            expectedVersion: 4,
            target: { kind: 'catalogVariant', foodVariantId: 'V-flat' },
        });
    });

    it('⛔ a pick that finds its item SAVED at the write is not lost: it rebinds the draft as the cook and is recorded after', async () => {
        // The step read the item as `matched`; a save committed before the pick's own locked write, which answers `saved`.
        const { service, rebind, linesDal } = build({
            item: makeItem({ stage: 'matched', matchedAt: new Date() }),
            line: makeLine({ id: 'L0', judgementDigest: 'jd-0' }),
            pick: 'saved',
            linkedIngredient: { recipeId: RECIPE_ID, sortOrder: 3, boundBy: 'autoBest' },
            // What the answer's step shows for the line once the draft is rebound.
            linked: new Map([['L0', { boundBy: 'cook' as const }]]),
        });

        const answer = await service.pick(
            COOK,
            CALLER,
            IMPORT_ID,
            0,
            request({ kind: 'food', id: 'F-skim' }),
            undefined,
        );

        expect(rebind.rebind).toHaveBeenCalledOnce();
        expect(answer.applied).toBe(true);
        // The step is built for the item AS IT NOW IS (saved), so the rebound line reports who bound it.
        expect(answer.step.lines[0]?.boundBy).toBe('cook');
        expect(linesDal.recordPick).toHaveBeenLastCalledWith(
            USER,
            IMPORT_ID,
            0,
            0,
            0,
            'jd-0',
            { kind: 'food', id: 'F-skim' },
            { onlyUnsaved: false },
        );
    });

    it('⛔ records the pick only AFTER the rebind succeeded, and not at all when it failed', async () => {
        const ok = saved();

        await ok.service.pick(COOK, CALLER, IMPORT_ID, 0, request({ kind: 'food', id: 'F-skim' }), undefined);
        expect(ok.rebind.rebind.mock.invocationCallOrder[0]).toBeLessThan(
            ok.linesDal.recordPick.mock.invocationCallOrder[0] ?? Number.NaN,
        );

        const failing = saved();

        failing.rebind.rebind.mockRejectedValue(new Error('food is down'));
        await expect(
            failing.service.pick(COOK, CALLER, IMPORT_ID, 0, request({ kind: 'food', id: 'F-skim' }), undefined),
        ).rejects.toThrow('food is down');
        expect(failing.linesDal.recordPick).not.toHaveBeenCalled();
    });

    it('⛔ a stale judgement digest rebinds nothing and records nothing', async () => {
        const { service, rebind, linesDal } = saved({ line: makeLine({ id: 'L0', judgementDigest: 'jd-NEW' }) });
        const answer = await service.pick(
            COOK,
            CALLER,
            IMPORT_ID,
            0,
            request({ kind: 'food', id: 'F-skim' }),
            undefined,
        );

        expect(answer.applied).toBe(false);
        expect(rebind.rebind).not.toHaveBeenCalled();
        expect(linesDal.recordPick).not.toHaveBeenCalled();
    });

    it('records “keep this line as written” on a line that already is as written: acceptance, no rebind', async () => {
        const { service, rebind, linesDal } = saved({
            linkedIngredient: { recipeId: RECIPE_ID, sortOrder: 3, boundBy: null },
        });
        const answer = await service.pick(COOK, CALLER, IMPORT_ID, 0, request({ kind: 'asWritten' }), undefined);

        expect(answer.applied).toBe(true);
        expect(rebind.rebind).not.toHaveBeenCalled();
        // Recorded AFTER the work on a saved draft: there is no save left to fence.
        expect(linesDal.recordPick).toHaveBeenCalledWith(
            USER,
            IMPORT_ID,
            0,
            0,
            0,
            'jd-0',
            { kind: 'asWritten' },
            { onlyUnsaved: false },
        );
    });

    it('⛔ refuses “as written” on a line the import BOUND: unbinding belongs to the editor, and nothing is written', async () => {
        const { service, rebind, linesDal } = saved();
        const failure = await service
            .pick(COOK, CALLER, IMPORT_ID, 0, request({ kind: 'asWritten' }), undefined)
            .catch((thrown: unknown) => thrown);

        expect((failure as { getResponse: () => { code: string } }).getResponse().code).toBe('VALIDATION_FAILED');
        expect(rebind.rebind).not.toHaveBeenCalled();
        expect(linesDal.recordPick).not.toHaveBeenCalled();
    });

    it('is not found when the draft was deleted or the line was edited out of the link', async () => {
        const { service } = saved({ linkedIngredient: undefined });

        expect(
            await codeOf(service.pick(COOK, CALLER, IMPORT_ID, 0, request({ kind: 'food', id: 'F-skim' }), undefined)),
        ).toBe(RecipeErrorCode.RECIPE_NOT_FOUND);
    });
});

describe('ImportStepService.flagged', () => {
    const flaggedRead = (state: 'clear' | 'checking' | 'flagged') => ({
        bound: { kind: 'root' as const, id: 'F-whole', name: 'Milk, whole' },
        flag: state === 'flagged' ? { state, suggestion: null } : { state },
    });

    it('lists only the lines that are not clear, with the food they are bound to and the match view', async () => {
        const rows = [listedLine(0), listedLine(1), listedLine(2)];
        const { service } = build({
            flaggable: [rows],
            flags: new Map([
                ['L0', flaggedRead('clear')],
                ['L1', flaggedRead('flagged')],
                ['L2', flaggedRead('checking')],
            ]),
        });
        const page = await service.flagged(COOK, CALLER, IMPORT_ID, { limit: 10 }, undefined);

        expect(importFlaggedResponseSchema.parse(page)).toEqual(page);
        expect(page.lines.map((line) => [line.lineIndex, line.flag.state])).toEqual([
            [1, 'flagged'],
            [2, 'checking'],
        ]);
        expect(page.lines[0]).toMatchObject({
            ordinal: 0,
            title: 'Soup',
            sourceLine: '2 cups whole milk',
            recipeId: RECIPE_ID,
            bound: { kind: 'root', id: 'F-whole', name: 'Milk, whole' },
            boundBy: 'autoBest',
            judgementDigest: 'jd-1',
            match: MATCH,
        });
        expect(page.nextAfter).toBeNull();
    });

    it('⛔ fills the page by scanning on past a run of clear lines, and a short page is only the end when nextAfter is null', async () => {
        // A full scan of agreeing lines, then a short one (fewer than the scan size means the end of the data).
        const first = Array.from({ length: 100 }, (_unused, index) => listedLine(index));
        const second = [listedLine(100), listedLine(101)];
        const { service, linesDal } = build({
            flaggable: [first, second],
            flags: new Map([
                ...first.map((row) => [row.line.id, flaggedRead('clear')] as const),
                ['L100', flaggedRead('flagged')],
                ['L101', flaggedRead('flagged')],
            ]),
        });
        const page = await service.flagged(COOK, CALLER, IMPORT_ID, { limit: 2 }, undefined);

        expect(page.lines.map((line) => line.lineIndex)).toEqual([100, 101]);
        expect(page.nextAfter).toBeNull();
        expect(linesDal.listFlaggable).toHaveBeenCalledTimes(2);
    });

    it('stops at the page size and continues AFTER the last returned line (nothing scanned past it is skipped)', async () => {
        const rows = [listedLine(0), listedLine(1), listedLine(2)];
        const { service } = build({
            flaggable: [rows],
            flags: new Map(rows.map((row) => [row.line.id, flaggedRead('flagged')] as const)),
        });
        const page = await service.flagged(COOK, CALLER, IMPORT_ID, { limit: 2 }, undefined);

        expect(page.lines.map((line) => line.lineIndex)).toEqual([0, 1]);
        expect(page.nextAfter).toBe(encodeLineCursor({ ordinal: 0, lineIndex: 1, foodIndex: 0 }));
    });

    it('⛔ bounds the scan: a library of agreeing lines returns a short page WITH a cursor, never an unbounded request', async () => {
        const batch = (start: number) => Array.from({ length: 100 }, (_unused, index) => listedLine(start + index));
        const all = [batch(0), batch(100), batch(200), batch(300), batch(400), batch(500)];
        const { service, linesDal } = build({
            flaggable: all,
            flags: new Map(all.flat().map((row) => [row.line.id, flaggedRead('clear')] as const)),
        });
        const page = await service.flagged(COOK, CALLER, IMPORT_ID, { limit: 5 }, undefined);

        expect(page.lines).toEqual([]);
        expect(linesDal.listFlaggable).toHaveBeenCalledTimes(5);
        expect(page.nextAfter).toBe(encodeLineCursor({ ordinal: 0, lineIndex: 499, foodIndex: 0 }));
    });

    it('drops a line whose binding no longer names a food (it has no read)', async () => {
        const { service } = build({ flaggable: [[listedLine(0)]], flags: new Map() });

        expect((await service.flagged(COOK, CALLER, IMPORT_ID, {}, undefined)).lines).toEqual([]);
    });

    it('⛔ refuses a cursor it did not issue, and is not found for a stranger’s import', async () => {
        const failure = await build()
            .service.flagged(COOK, CALLER, IMPORT_ID, { after: 'junk' }, undefined)
            .catch((thrown: unknown) => thrown);

        expect((failure as { getResponse: () => { code: string } }).getResponse().code).toBe('VALIDATION_FAILED');
        expect(await codeOf(build({ header: undefined }).service.flagged(COOK, CALLER, IMPORT_ID, {}, undefined))).toBe(
            RecipeErrorCode.IMPORT_NOT_FOUND,
        );
    });
});

describe('ImportStepService.toCheck', () => {
    it('lists the lines saved as written that wait, each with its match so the cook can pick', async () => {
        const rows = [listedLine(0, { boundBy: null }), listedLine(1, { boundBy: null })];
        const { service, linesDal } = build({ toCheck: rows });
        const page = await service.toCheck(COOK, CALLER, IMPORT_ID, { limit: 5 }, undefined);

        expect(importToCheckResponseSchema.parse(page)).toEqual(page);
        expect(page.lines.map((line) => line.lineIndex)).toEqual([0, 1]);
        expect(page.lines[0]).toMatchObject({
            ordinal: 0,
            title: 'Soup',
            sourceLine: '2 cups whole milk',
            judgementDigest: 'jd-0',
            match: MATCH,
        });
        expect(page.nextAfter).toBeNull();
        expect(linesDal.listToCheck).toHaveBeenCalledWith(USER, IMPORT_ID, undefined, 6);
    });

    it('sets nextAfter exactly when more follow', async () => {
        const rows = [0, 1, 2].map((index) => listedLine(index, { boundBy: null }));
        const page = await build({ toCheck: rows }).service.toCheck(COOK, CALLER, IMPORT_ID, { limit: 2 }, undefined);

        expect(page.lines).toHaveLength(2);
        expect(page.nextAfter).toBe(encodeLineCursor({ ordinal: 0, lineIndex: 1, foodIndex: 0 }));
    });
});

describe('ImportStepService.toCheckCount', () => {
    it('is the library-wide count of lines still waiting for the caller', async () => {
        const { service, linesDal } = build({ count: 7 });

        expect(await service.toCheckCount(COOK)).toEqual({ count: 7 });
        expect(linesDal.countToCheck).toHaveBeenCalledWith(USER);
    });
});

describe('acting principal', () => {
    it('is the verified caller’s slice, so a contained test principal’s reviews read as never sent', async () => {
        const contained = makePrincipal({ principalKind: 'test', containment: 'enforce' });
        const { service, lineView } = build();

        await service.step(contained, CALLER, IMPORT_ID, 0, undefined);

        expect(lineView.matchesOf.mock.calls[0]?.[0]).toEqual(actingPrincipalOf(contained));
    });
});
