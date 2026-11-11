/**
 * The bulk import's services wired by Nest's real injector, with every store and outside collaborator MOCKED
 * (`docs/CODING_STANDARDS.md` §7.1a), and every answer parsed against the PUBLISHED contract (`@kitchensink/schema-recipe`)
 * the way an installed client parses it.
 *
 * The route (controller, module, DTOs) lands in its own slice, so this tier crosses the seams that exist now:
 *
 *  - **The injector.** The five import providers resolve every token they ask for: a wrong token, a missing `@Inject`, or a
 *    constructor that grew a parameter fails `compile()` here, which no unit test can see.
 *  - **The wire shape across real collaborators.** The step goes through the REAL `ImportLineView` and the REAL paste
 *    projection (`projectMatch`), so the line the wizard receives is what the published schema accepts, including the row the
 *    import saves (migration 0067: name, shown words, note) and a review the spend ceiling refused this month
 *    (`reviewBudgetSpent`, owner ruling 2026-10-26).
 *  - **The allowance asks one flat limit.** The view reads the ledger through `stateOf(db, user, 'bulk')`: no tier rides it.
 *  - **What Publish needs holds an item, through every service at once** (ADR-0072 §3 as amended 2026-11-11). An advance
 *    holds an item whose file states no cuisine and never calls the create path, the view names `needsCuisine` in a shape
 *    the published contract accepts, the step shows the cuisine as `null`, and the cook's cuisine reaches the item.
 *
 * Whether the DATABASE keeps the claims right is the LOCAL e2e tier's (`tests/e2e/import/`).
 */
import 'reflect-metadata';

import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { importStepResponseSchema, importViewSchema } from '@kitchensink/schema-recipe';

import { CallerToken } from '../../../src/auth/CallerToken.js';
import { ImportAllowanceDal } from '../../../src/common/dal/importAllowance.dal.js';
import { DrizzleProvider } from '../../../src/database/database.module.js';
import { FoodLookupsDal } from '../../../src/ingredients/dal/foodLookups.dal.js';
import { FoodRefsGateway } from '../../../src/ingredients/foodRefs.gateway.js';
import { IngredientsService } from '../../../src/ingredients/ingredients.service.js';
import {
    IMPORT_ID,
    USER,
    makeHeader,
    makeItem,
    makeLine,
    makeListedItem,
    makePrincipal,
} from '../../../src/import/__fixtures__/importFixtures.js';
import { DEFAULT_IMPORT_ADVANCE_LIMITS } from '../../../src/import/domain/importLimits.js';
import { ImportService } from '../../../src/import/import.service.js';
import {
    IMPORT_ADVANCE_LIMITS,
    RECIPE_IMPORT_ITEMS_DAL,
    RECIPE_IMPORT_LINES_DAL,
    RECIPE_IMPORTS_DAL,
} from '../../../src/import/import.tokens.js';
import { ImportAdvanceService } from '../../../src/import/importAdvance.service.js';
import { ImportLineView } from '../../../src/import/importLineView.js';
import { ImportStepService } from '../../../src/import/importStep.service.js';
import { ImportViewBuilder } from '../../../src/import/importView.builder.js';
import { PRIVATE_SLOTS } from '../../../src/import/privateSlots.port.js';
import { UNLIMITED_PRIVATE_SLOTS } from '../../../src/import/__fixtures__/importFixtures.js';
import { IngredientRebindService } from '../../../src/recipes/ingredientRebind.service.js';
import { MatchProposalService, PARSE_JOB_MATCHES_DAL } from '../../../src/recipes/matchProposal.service.js';
import { ParseJobsService } from '../../../src/recipes/parseJobs.service.js';
import { RecipesService } from '../../../src/recipes/recipes.service.js';
import { RECIPE_LINE_VERIFICATIONS_DAL } from '../../../src/recipes/recipes.tokens.js';

const CALLER = CallerToken.fromAuthorizationHeader('Bearer cook-token');
const COOK = makePrincipal();
const DB = { marker: 'the drizzle client' };
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
    deferItem: vi.fn(),
    holdItem: vi.fn(),
};
const lines = {
    findForItem: vi.fn(),
    findLinkedForItem: vi.fn(),
    findLine: vi.fn(),
    recordPick: vi.fn(),
    findLinkedIngredient: vi.fn(),
    listFlaggable: vi.fn(),
    listToCheck: vi.fn(),
    countToCheck: vi.fn(),
    setSavedKeys: vi.fn(),
};
const allowance = { stateOf: vi.fn(), admit: vi.fn() };
const recipes = { create: vi.fn() };
const verdicts = { findBandsByKeys: vi.fn(), findExhaustedKeys: vi.fn(), findBudgetSpentKeys: vi.fn() };
const refs = { resolve: vi.fn() };

async function compile() {
    const module = await Test.createTestingModule({
        providers: [
            ImportViewBuilder,
            ImportLineView,
            ImportService,
            ImportStepService,
            ImportAdvanceService,
            { provide: RECIPE_IMPORTS_DAL, useValue: imports },
            { provide: RECIPE_IMPORT_ITEMS_DAL, useValue: items },
            { provide: RECIPE_IMPORT_LINES_DAL, useValue: lines },
            { provide: ImportAllowanceDal, useValue: allowance },
            { provide: DrizzleProvider, useValue: DB },
            { provide: PRIVATE_SLOTS, useValue: UNLIMITED_PRIVATE_SLOTS },
            { provide: IMPORT_ADVANCE_LIMITS, useValue: DEFAULT_IMPORT_ADVANCE_LIMITS },
            { provide: RECIPE_LINE_VERIFICATIONS_DAL, useValue: verdicts },
            { provide: FoodRefsGateway, useValue: refs },
            { provide: FoodLookupsDal, useValue: { findByIds: vi.fn(async () => new Map()) } },
            { provide: ParseJobsService, useValue: { createPrepaid: vi.fn(), retry: vi.fn() } },
            { provide: PARSE_JOB_MATCHES_DAL, useValue: { findForJob: vi.fn(async () => []) } },
            { provide: MatchProposalService, useValue: { proposeForJobs: vi.fn() } },
            { provide: IngredientsService, useValue: { addByRef: vi.fn(), createFreeform: vi.fn() } },
            { provide: RecipesService, useValue: recipes },
            { provide: IngredientRebindService, useValue: { rebind: vi.fn() } },
        ],
    }).compile();

    return {
        service: module.get(ImportService),
        steps: module.get(ImportStepService),
        advancer: module.get(ImportAdvanceService),
    };
}

beforeEach(() => {
    for (const double of [imports, items, lines, allowance, verdicts, refs, recipes]) {
        for (const fn of Object.values(double)) {
            fn.mockReset();
        }
    }

    const header = makeHeader();

    imports.findHeader.mockResolvedValue(header);
    imports.countsByStage.mockResolvedValue({ total: 1, received: 0, parsing: 0, matched: 1, saved: 0 });
    imports.verdictFingerprint.mockResolvedValue({ count: 0, latest: null });
    imports.countUnsavedPrivate.mockResolvedValue(0);
    items.findPage.mockResolvedValue([makeListedItem({ stage: 'matched', matchedAt: new Date() })]);
    items.findItem.mockResolvedValue(makeItem({ stage: 'matched', matchedAt: new Date() }));
    items.payUnpaid.mockResolvedValue({ kind: 'nothing' });
    items.findNeedingJob.mockResolvedValue([]);
    items.findParsing.mockResolvedValue([]);
    items.findSaveCandidates.mockResolvedValue([]);
    items.holdItem.mockResolvedValue(true);
    lines.findLinkedForItem.mockResolvedValue(new Map());
    allowance.stateOf.mockResolvedValue(ALLOWANCE);
    verdicts.findBandsByKeys.mockResolvedValue(new Map());
    verdicts.findExhaustedKeys.mockResolvedValue(new Set());
    verdicts.findBudgetSpentKeys.mockResolvedValue(new Set());
    refs.resolve.mockImplementation(async (_caller: unknown, asked: readonly { kind: string; id: string }[]) => ({
        answers: new Map(
            asked.map((ref) => [
                `${ref.kind}:${ref.id}`,
                { outcome: 'found', name: 'Whole milk', status: 'RESOLVED', isPrivate: false, rootId: ref.id },
            ]),
        ),
        degraded: false,
    }));
});

describe('the import services under the real injector', () => {
    it('resolves every provider the five services ask for', async () => {
        const { service, steps, advancer } = await compile();

        expect([service, steps, advancer].every((resolved) => resolved !== undefined)).toBe(true);
    });

    // Rewritten 2026-11-11: it pinned ONE flat limit. Bulk is 200 a day on Free and 1,000 on a paid plan (owner ruling), so
    // the view reads the allowance under the caller's plan.
    it('a view parses against the published contract, and its allowance is read under the caller’s plan', async () => {
        const { service } = await compile();
        const view = await service.getView(COOK, IMPORT_ID, {});

        expect(importViewSchema.parse(view)).toEqual(view);
        expect(view.allowance).toEqual(ALLOWANCE);
        expect(allowance.stateOf).toHaveBeenCalledWith(DB, USER, { channel: 'bulk', isPremium: false });

        await service.getView(makePrincipal({ roles: ['vip'] }), IMPORT_ID, {});

        expect(allowance.stateOf).toHaveBeenLastCalledWith(DB, USER, { channel: 'bulk', isPremium: true });
    });

    it('an advance with nothing to do answers the view, which parses', async () => {
        const { advancer } = await compile();
        const view = await advancer.advance(COOK, CALLER, IMPORT_ID);

        expect(importViewSchema.parse(view)).toEqual(view);
        expect(items.payUnpaid).toHaveBeenCalledWith(USER, IMPORT_ID, {
            limit: DEFAULT_IMPORT_ADVANCE_LIMITS.payBatch,
            isPremium: false,
        });
        // ADR-0072 §9's purge clock moves on every advance, through the real injector's wiring.
        expect(imports.touch).toHaveBeenCalledWith(IMPORT_ID);
    });

    it('⛔ the step carries the row the import saves through the real line view, and parses', async () => {
        lines.findForItem.mockResolvedValue([
            makeLine({
                id: 'L0',
                phrase: '9 inch pie pastry',
                name: 'pie pastry',
                displayText: 'my pie pastry',
                note: '9 inch',
                unit: '',
                quantity: '1',
            }),
        ]);
        const { steps } = await compile();
        const step = await steps.step(COOK, CALLER, IMPORT_ID, 0);

        expect(importStepResponseSchema.parse(step)).toEqual(step);
        expect(step.lines[0]).toMatchObject({
            phrase: '9 inch pie pastry',
            name: 'pie pastry',
            displayText: 'my pie pastry',
            note: '9 inch',
            match: { proposed: { kind: 'root', id: 'F-whole', name: 'Whole milk' } },
        });
    });

    it('⛔ a review the ceiling refused this month reaches the wizard as a choice with when it comes back, never "checking"', async () => {
        lines.findForItem.mockResolvedValue([makeLine({ id: 'L0' })]);
        verdicts.findBudgetSpentKeys.mockResolvedValue(new Set(['v1:proposal']));
        const { steps } = await compile();
        const step = await steps.step(COOK, CALLER, IMPORT_ID, 0);

        expect(importStepResponseSchema.parse(step)).toEqual(step);
        expect(step.lines[0]?.match).toMatchObject({ state: 'needsChoice', reason: 'reviewBudgetSpent' });
        expect(step.lines[0]?.match).toHaveProperty('reviewResetsAt');
    });

    describe('⛔ what Publish needs (ADR-0072 §3 as amended 2026-11-11)', () => {
        const noCuisine = makeItem({
            stage: 'matched',
            matchedAt: new Date(Date.now() - 60_000),
            allowanceSpentAt: new Date(),
            statementKind: 'authored',
            decisionRev: 4,
            payload: { title: 'Soup', ingredientLines: ['2 cups milk'], steps: [{ instruction: 'Heat.' }] },
        });

        it('an advance holds an item whose file states no cuisine: no create call, no deferral', async () => {
            items.findSaveCandidates.mockResolvedValue([noCuisine]);
            const { advancer } = await compile();

            await advancer.advance(COOK, CALLER, IMPORT_ID);

            expect(items.holdItem).toHaveBeenCalledWith(IMPORT_ID, 0, 4);
            expect(recipes.create).not.toHaveBeenCalled();
            expect(items.deferItem).not.toHaveBeenCalled();
        });

        it('the view names the gap in a shape the published contract accepts', async () => {
            items.findPage.mockResolvedValue([
                makeListedItem({
                    stage: 'matched',
                    matchedAt: new Date(),
                    statementKind: 'authored',
                    publishFacts: { fileCuisine: null, ingredientLineCount: 1, stepCount: 1 },
                }),
            ]);
            const { service } = await compile();
            const view = await service.getView(COOK, IMPORT_ID, {});

            expect(importViewSchema.parse(view)).toEqual(view);
            expect(view.items[0]?.issue).toEqual({ reason: 'needsCuisine' });
        });

        it("the step shows no cuisine, and the cook's cuisine reaches the item as a decision", async () => {
            items.findItem.mockResolvedValue(noCuisine);
            items.recordChoices.mockResolvedValue('ok');
            lines.findForItem.mockResolvedValue([]);
            const { steps } = await compile();
            const step = await steps.step(COOK, CALLER, IMPORT_ID, 0);

            expect(importStepResponseSchema.parse(step)).toEqual(step);
            expect(step.cuisine).toBeNull();

            await steps.recordChoices(COOK, CALLER, IMPORT_ID, 0, { cuisine: 'Thai' });

            expect(items.recordChoices).toHaveBeenCalledWith(IMPORT_ID, 0, { cuisine: 'Thai' });
        });
    });
});
