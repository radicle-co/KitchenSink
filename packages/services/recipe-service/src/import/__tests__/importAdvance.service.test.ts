/**
 * `ImportAdvanceService` — one bounded step of a bulk import, as the cook (ADR-0072 §2, §3, §7, §8, §9, §10), over fakes for
 * every port and an in-memory item store that restates the repository's compare-and-swap rules (the LOCAL e2e is their
 * authority).
 *
 * The order inside a call is the claim: PAY (the allowance, once per item), then give each paid item a PARSE JOB under a
 * derived id, then MATCH the jobs that finished and take their SNAPSHOT, then SAVE what is ready. Nothing runs between calls.
 *
 * What each group guards:
 *
 *  - **Paying and parsing are idempotent.** An item that already paid is never charged again; an item that already holds a job
 *    never gets a second; a job id is derived, so a retry after a crash finds the same job.
 *  - **Nothing binds without the cook's decision or a confident match**, and nothing binds at all once the AI budget is spent.
 *  - **A save happens once.** The claim rides the recipe's own transaction, and the loser of a race is treated as done.
 *  - **One item's trouble does not stop the others** (a food outage, a refused visibility, a missing statement).
 *  - **A call is bounded** by its deadline and its ceilings.
 */
import { HttpException, HttpStatus } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { RecipeSourceType, RecipeVisibility, type IngredientQuantity } from '@kitchensink/recipe-core';

import { CallerToken } from '../../auth/CallerToken.js';
import { sha256Hex } from '../../common/sha256.js';
import {
    makeParseJobLine,
    makeParseJobRecord,
    makeStoredProposal,
} from '../../recipes/__fixtures__/parseJobMatches.fixture.js';
import type { Role } from '@kitchensink/clerk-verify';

import type { ParseProposalMatch } from '../../recipes/parseJobs.schema.js';
import { foodNotAdmissible, privateSlotsFull, publishRequirementsUnmet } from '../../recipes/recipe.error.js';
import type { RecipesService } from '../../recipes/recipes.service.js';
import type { ImportItem, PayOutcome } from '../dal/recipeImportItems.dal.js';
import { ImportItemAlreadyClaimedError, ImportItemChangedError } from '../dal/recipeImportItems.errors.js';
import type { ImportLine } from '../dal/recipeImportLines.dal.js';
import { DEFAULT_IMPORT_ADVANCE_LIMITS, type ImportAdvanceLimits } from '../domain/importLimits.js';
import { importJobIdOf } from '../domain/importJobId.js';
import { ImportAdvanceService } from '../importAdvance.service.js';
import type { PrivateSlotsPort } from '../privateSlots.port.js';
import {
    IMPORT_ID,
    makeCurrentMatch,
    makeHeader,
    makeItem,
    makeLine,
    makePrincipal,
    UNLIMITED_PRIVATE_SLOTS,
    USER,
} from '../__fixtures__/importFixtures.js';

const CALLER = CallerToken.fromAuthorizationHeader('Bearer cook-token');
const COOK = makePrincipal();
const VIEW = { id: IMPORT_ID } as never;
const FAKE_TX = { tx: true } as never;

/** The first call to `create`, typed, or a failure when there was none. */
function firstCreate(recipes: { create: { mock: { calls: readonly (readonly unknown[])[] } } }): {
    dto: { ingredients: Record<string, unknown>[]; visibility: string };
    imported: { lineOrigins: { boundBy?: unknown }[] };
} {
    const call = recipes.create.mock.calls[0];

    if (call === undefined) {
        throw new Error('create was not called');
    }

    // The import ALWAYS passes the fourth argument. A made-up default here would let a test of "no origins" pass even if the
    // service stopped passing `imported`, so a missing one is a failure.
    if (call.length <= 3) {
        throw new Error('create was called without the import options (the fourth argument)');
    }

    return { dto: call[1] as never, imported: call[3] as never };
}

/** Run the save's `afterWrite` the way the create path does, inside its (fake) transaction. */
async function runAfterWrite(
    imported: { afterWrite?: (tx: never, saved: never) => Promise<void> } | undefined,
    saved: unknown = { recipeId: 'R-new', ingredients: [], identities: new Map() },
): Promise<void> {
    if (imported?.afterWrite !== undefined) {
        await imported.afterWrite(FAKE_TX, saved as never);
    }
}

const BOOK = { statementKind: 'source', sourceKind: 'book', citation: 'Joy, p. 12' } as const;

/** A recipe as the file states it: everything Publish needs, a cuisine included, unless a test takes it away. */
const recipe = (lines: readonly string[] = ['2 cups whole milk'], title = 'Soup') => ({
    title,
    cuisine: 'French',
    ingredientLines: lines,
    steps: [{ instruction: 'Mix.', timerSeconds: 30 }],
});

/** A match view for a snapshot line. */
const view = (patch: Partial<ParseProposalMatch> = {}): ParseProposalMatch => ({
    state: 'confident',
    reason: 'exactName',
    proposed: { kind: 'root', id: 'F-whole', name: 'Milk, whole' },
    candidates: [
        { kind: 'root', id: 'F-whole', name: 'Milk, whole', isDefault: false },
        { kind: 'root', id: 'F-table', name: 'Table salt', isDefault: true },
    ],
    ...patch,
});

/** An in-memory item store restating the repository's compare-and-swap rules. */
function itemStore(initial: readonly ImportItem[]) {
    const items = new Map(initial.map((item) => [item.ordinal, item] as const));

    const set = (ordinal: number, patch: Partial<ImportItem>): void => {
        const held = items.get(ordinal);

        if (held !== undefined) {
            items.set(ordinal, { ...held, ...patch });
        }
    };

    const calls = { snapshot: [] as { ordinal: number; lines: readonly unknown[] }[], claim: [] as number[] };
    const store = {
        items,
        calls,
        payUnpaid: vi.fn(async (_user: string, _importId: string, request: { limit: number }): Promise<PayOutcome> => {
            const unpaid = [...items.values()]
                .filter((item) => item.stage === 'received' && item.allowanceSpentAt === null && hasLines(item))
                .sort((a, b) => a.ordinal - b.ordinal)
                .slice(0, request.limit);

            for (const item of unpaid) {
                set(item.ordinal, { allowanceSpentAt: new Date() });
            }

            return unpaid.length === 0
                ? ({ kind: 'nothing' } as const)
                : ({ kind: 'paid', ordinals: unpaid.map((item) => item.ordinal) } as const);
        }),
        findNeedingJob: vi.fn(async (_importId: string, limit: number) =>
            [...items.values()]
                .filter(
                    (item) =>
                        (item.stage === 'received' || item.stage === 'parsing') &&
                        item.parseJobId === null &&
                        (item.allowanceSpentAt !== null || !hasLines(item)),
                )
                .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime() || a.ordinal - b.ordinal)
                .slice(0, limit),
        ),
        findParsing: vi.fn(async (_importId: string, limit: number) =>
            [...items.values()]
                .filter((item) => item.stage === 'parsing' && item.parseJobId !== null)
                .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime() || a.ordinal - b.ordinal)
                .slice(0, limit)
                .map((item) => ({ ...item, payload: null })),
        ),
        findSaveCandidates: vi.fn(async (_importId: string, limit: number) =>
            [...items.values()]
                .filter(
                    (item) =>
                        item.stage === 'matched' && item.statementKind !== null && item.heldAtRev !== item.decisionRev,
                )
                .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime() || a.ordinal - b.ordinal)
                .slice(0, limit),
        ),
        deferItem: vi.fn(async (_importId: string, ordinal: number) => {
            set(ordinal, { updatedAt: new Date(Date.now() + 1) });
        }),
        holdItem: vi.fn(async (_importId: string, ordinal: number, decisionRev: number) => {
            if (items.get(ordinal)?.decisionRev !== decisionRev) {
                return false;
            }

            set(ordinal, { heldAtRev: decisionRev });

            return true;
        }),
        /** What `recordChoices` does to the fence: the cook's decision moves the revision past any hold. */
        decide: (ordinal: number, patch: Partial<ImportItem>) => {
            set(ordinal, { ...patch, decisionRev: (items.get(ordinal)?.decisionRev ?? 0) + 1 });
        },
        attachJob: vi.fn(async (_importId: string, ordinal: number, generation: number, jobId: string) => {
            const held = items.get(ordinal);

            if (held === undefined || held.parseGeneration !== generation || held.allowanceSpentAt === null) {
                return false;
            }

            set(ordinal, { parseJobId: jobId, stage: 'parsing' });

            return true;
        }),
        detachExpiredJob: vi.fn(async (_importId: string, ordinal: number, generation: number) => {
            const held = items.get(ordinal);

            if (held === undefined || held.parseGeneration !== generation || held.stage !== 'parsing') {
                return false;
            }

            set(ordinal, { parseGeneration: generation + 1, parseJobId: null });

            return true;
        }),
        markMatchedWithoutLines: vi.fn(async (_importId: string, ordinal: number) => {
            set(ordinal, { stage: 'matched', matchedAt: new Date() });

            return true;
        }),
        snapshot: vi.fn(async (_importId: string, ordinal: number, lines: readonly unknown[]) => {
            if (items.get(ordinal)?.stage !== 'parsing') {
                return false;
            }

            calls.snapshot.push({ ordinal, lines });
            set(ordinal, { stage: 'matched', matchedAt: new Date(Date.now() - 60_000) });

            return true;
        }),
        claimSave: vi.fn(
            async (_tx: unknown, _importId: string, ordinal: number, recipeId: string, decisionRev: number) => {
                if (items.get(ordinal)?.stage !== 'matched') {
                    throw new ImportItemAlreadyClaimedError(ordinal);
                }

                // The fence: a decision written after the save read the item moved the revision.
                if (items.get(ordinal)?.decisionRev !== decisionRev) {
                    throw new ImportItemChangedError(ordinal);
                }

                calls.claim.push(ordinal);
                set(ordinal, { stage: 'saved', savedAt: new Date(), recipeId, payload: null });
            },
        ),
    };

    return store;
}

function hasLines(item: ImportItem): boolean {
    const lines = (item.payload as { ingredientLines?: unknown[] } | null)?.ingredientLines;

    return Array.isArray(lines) && lines.length > 0;
}

/** A received item, with its payload. */
const received = (ordinal: number, lines?: readonly string[], patch: Partial<ImportItem> = {}) =>
    makeItem({ ordinal, title: `Recipe ${String(ordinal)}`, payload: recipe(lines), ...patch });

/** A matched item with a statement, ready to be judged for saving. */
const matched = (ordinal: number, patch: Partial<ImportItem> = {}) =>
    makeItem({
        ordinal,
        title: `Recipe ${String(ordinal)}`,
        payload: recipe(['2 cups whole milk']),
        stage: 'matched',
        allowanceSpentAt: new Date(),
        matchedAt: new Date(Date.now() - 60_000),
        statementKind: 'authored',
        ...patch,
    });

interface World {
    readonly header?: Parameters<typeof makeHeader>[0];
    readonly items?: readonly ImportItem[];
    /** Snapshot lines by item ordinal. */
    readonly lines?: Record<number, readonly ImportLine[]>;
    /** The match view of a line, by line id. `null` is food being down. */
    readonly matches?: Record<string, ParseProposalMatch | null>;
    readonly jobs?: Record<string, ReturnType<typeof makeParseJobRecord>>;
    readonly proposed?: (
        jobIds: readonly string[],
    ) => readonly { jobId: string; kind: 'ok' | 'missing' | 'expired' | 'skipped'; matchesComplete?: boolean }[];
    readonly slots?: PrivateSlotsPort;
    readonly create?: (...args: Parameters<RecipesService['create']>) => Promise<unknown>;
    readonly addByRef?: (...args: unknown[]) => Promise<unknown>;
    readonly limits?: Partial<ImportAdvanceLimits>;
    /** The cook's plan roles, read from the signed token (`isPremiumPrincipal`). None is a free cook. */
    readonly roles?: readonly Role[];
}

function build(world: World = {}) {
    const header = makeHeader({ ...(world.header ?? {}) });
    const store = itemStore(world.items ?? []);
    const imports = { findHeader: vi.fn(async () => header), touch: vi.fn(async (_importId: string) => undefined) };
    const lines = {
        findForItem: vi.fn(async (_importId: string, ordinal: number) => [...(world.lines?.[ordinal] ?? [])]),
        setSavedKeys: vi.fn(async (_tx: unknown, _entries: readonly { id: string; key: string }[]) => undefined),
    };
    const parseJobs = {
        createPrepaid: vi.fn(
            async (_user: string, _lines: readonly string[], jobId?: string) => ({ id: jobId ?? 'none' }) as never,
        ),
        retry: vi.fn(async (_user: string, _jobId: string) => ({}) as never),
    };
    const matchStore = {
        findForJob: vi.fn(async (_user: string, jobId: string) => {
            const job = world.jobs?.[jobId];

            return job === undefined
                ? []
                : job.lines.flatMap((line) =>
                      (line.proposal === null ? [] : (line.proposal as { foods: { name: string }[] }).foods).map(
                          (food, foodIndex) => {
                              const parse = line.proposal as {
                                  quantity: IngredientQuantity;
                                  unit: string | null;
                                  statedMeasure: string | null;
                              };

                              return makeCurrentMatch(
                                  line.lineIndex,
                                  foodIndex,
                                  line.sourceLine,
                                  food.name,
                                  {},
                                  {
                                      quantity: parse.quantity,
                                      unit: parse.unit,
                                      statedMeasure: parse.statedMeasure,
                                  },
                              );
                          },
                      ),
                  );
        }),
    };
    const matcher = {
        proposeForJobs: vi.fn(async (_acting: unknown, _caller: unknown, jobIds: readonly string[]) =>
            world.proposed !== undefined
                ? world.proposed(jobIds).map((entry) =>
                      entry.kind === 'ok'
                          ? {
                                ...entry,
                                record: world.jobs?.[entry.jobId] as never,
                                matchesComplete: entry.matchesComplete ?? true,
                            }
                          : entry,
                  )
                : jobIds.map((jobId) => ({
                      jobId,
                      kind: 'ok' as const,
                      record: world.jobs?.[jobId] as never,
                      matchesComplete: true,
                  })),
        ),
    };
    const lineView = {
        matchesOf: vi.fn(
            async (
                _acting: unknown,
                _caller: unknown,
                rows: readonly ImportLine[],
            ): Promise<ReadonlyMap<string, ParseProposalMatch | null>> =>
                new Map(
                    rows.map(
                        (row) =>
                            [
                                row.id,
                                world.matches !== undefined && row.id in world.matches
                                    ? (world.matches[row.id] ?? null)
                                    : view(),
                            ] as const,
                    ),
                ),
        ),
    };
    let lookupCounter = 0;
    const ingredients = {
        addByRef: vi.fn(
            world.addByRef ??
                (async (_caller: unknown, ref: { id: string }) => ({ id: `LK-${ref.id}`, foodId: ref.id }) as never),
        ),
        createFreeform: vi.fn(async (name: string) => ({ id: `FREE-${String(++lookupCounter)}-${name}` }) as never),
    };
    const recipes = {
        create: vi.fn(
            world.create ??
                (async (
                    _principal: unknown,
                    _dto: unknown,
                    _caller: unknown,
                    imported?: { afterWrite?: (tx: unknown, saved: unknown) => Promise<void> },
                ) => {
                    await runAfterWrite(imported, {
                        recipeId: 'R-new',
                        ingredients: [],
                        identities: new Map(),
                    });

                    return { id: 'R-new' } as never;
                }),
        ),
    };
    const builder = { build: vi.fn(async () => VIEW) };
    const limits: ImportAdvanceLimits = { ...DEFAULT_IMPORT_ADVANCE_LIMITS, ...(world.limits ?? {}) };
    const service = new ImportAdvanceService(
        imports as never,
        store as never,
        lines as never,
        parseJobs as never,
        matchStore as never,
        matcher as never,
        lineView as never,
        ingredients as never,
        recipes as never,
        world.slots ?? UNLIMITED_PRIVATE_SLOTS,
        builder as never,
        limits,
    );
    const principal = world.roles === undefined ? COOK : makePrincipal({ roles: [...world.roles] });

    return {
        service,
        store,
        imports,
        lines,
        parseJobs,
        matchStore,
        matcher,
        lineView,
        ingredients,
        recipes,
        builder,
        principal,
    };
}

const run = (world: World = {}) => {
    const built = build(world);

    return { ...built, answered: built.service.advance(built.principal, CALLER, IMPORT_ID) };
};

describe('ImportAdvanceService — paying and giving each item its parse job', () => {
    it('pays the next unpaid items under the bulk channel, up to the batch ceiling', async () => {
        const { answered, store } = run({ items: [received(0), received(1)] });

        await answered;

        expect(store.payUnpaid).toHaveBeenCalledWith(USER, IMPORT_ID, {
            limit: DEFAULT_IMPORT_ADVANCE_LIMITS.payBatch,
            isPremium: false,
        });
    });

    // REWRITTEN twice: owner ruling 2026-11-11 puts bulk at 200 a day on Free and 1,000 on a paid plan, so the cook's plan
    // reaches the allowance again. Superusers and VIPs count as paid, read through the ONE policy (`isPremiumPrincipal`).
    it.each([
        ['a Premium cook', ['premium'] as const, true],
        ['⛔ a superuser on Free billing', ['superuser'] as const, true],
        ['⛔ a VIP on Free billing', ['vip'] as const, true],
        ['an admin, who is not a paid plan', ['admin'] as const, false],
        ['a free cook', [] as const, false],
    ] satisfies readonly (readonly [string, readonly Role[], boolean])[])(
        '%s pays under the plan it holds',
        async (_name, roles, isPremium) => {
            const { answered, store } = run({ items: [received(0)], roles });

            await answered;

            expect(store.payUnpaid.mock.calls[0]?.[2]).toStrictEqual({
                limit: DEFAULT_IMPORT_ADVANCE_LIMITS.payBatch,
                isPremium,
            });
        },
    );

    it('⛔ creates each paid item’s job under the DERIVED id, from the TRIMMED lines, and names it on the item', async () => {
        const { answered, parseJobs, store } = run({ items: [received(3, ['  2 cups whole milk  ', '1 tsp salt'])] });

        await answered;

        const jobId = importJobIdOf(IMPORT_ID, 3, 0, sha256Hex);

        expect(parseJobs.createPrepaid).toHaveBeenCalledWith(USER, ['2 cups whole milk', '1 tsp salt'], jobId);
        expect(store.attachJob).toHaveBeenCalledWith(IMPORT_ID, 3, 0, jobId);
        expect(store.items.get(3)).toMatchObject({ stage: 'parsing', parseJobId: jobId });
    });

    it('⛔ never gives an item that already holds a job a second one, and never charges a paid item again', async () => {
        const existing = received(0, undefined, {
            stage: 'parsing',
            allowanceSpentAt: new Date(),
            parseJobId: importJobIdOf(IMPORT_ID, 0, 0, sha256Hex),
        });
        const { answered, parseJobs, store } = run({ items: [existing] });

        await answered;

        expect(parseJobs.createPrepaid).not.toHaveBeenCalled();
        expect(store.payUnpaid).toHaveBeenCalledOnce();
        expect([...store.items.values()].filter((item) => item.allowanceSpentAt === null)).toHaveLength(0);
    });

    it('gives a paid item whose job expired a NEW job under the next generation, without charging it again', async () => {
        const jobId = importJobIdOf(IMPORT_ID, 0, 0, sha256Hex);
        const item = received(0, undefined, { stage: 'parsing', allowanceSpentAt: new Date(), parseJobId: jobId });
        const { answered, parseJobs, store } = run({
            items: [item],
            proposed: (ids) => ids.map((id) => ({ jobId: id, kind: 'expired' as const })),
        });

        await answered;

        expect(store.detachExpiredJob).toHaveBeenCalledWith(IMPORT_ID, 0, 0);

        // The next call (the client polls) creates the replacement under generation 1.
        await build({ items: [{ ...item, parseGeneration: 1, parseJobId: null }] }).service.advance(
            COOK,
            CALLER,
            IMPORT_ID,
        );
        expect(parseJobs.createPrepaid).not.toHaveBeenCalled();
    });

    it('creates the replacement job under the bumped generation', async () => {
        const second = build({
            items: [
                received(0, undefined, {
                    stage: 'parsing',
                    allowanceSpentAt: new Date(),
                    parseGeneration: 1,
                    parseJobId: null,
                }),
            ],
        });

        await second.service.advance(COOK, CALLER, IMPORT_ID);

        expect(second.parseJobs.createPrepaid).toHaveBeenCalledWith(
            USER,
            expect.any(Array),
            importJobIdOf(IMPORT_ID, 0, 1, sha256Hex),
        );
    });

    it('⛔ matches a recipe with NO ingredient lines at once and never charges it', async () => {
        const { answered, parseJobs, store } = run({ items: [received(0, [])] });

        await answered;

        expect(store.markMatchedWithoutLines).toHaveBeenCalledWith(IMPORT_ID, 0);
        expect(parseJobs.createPrepaid).not.toHaveBeenCalled();
    });

    it('leaves an unpaid item alone when the allowance is spent (the view explains the wait)', async () => {
        const { answered, parseJobs, store } = run({ items: [received(0)] });

        store.payUnpaid.mockResolvedValueOnce({ kind: 'refused', resetsAt: new Date() });
        await answered;

        expect(parseJobs.createPrepaid).not.toHaveBeenCalled();
        expect(store.items.get(0)?.stage).toBe('received');
    });

    it('⛔ answers 200 with the view when the allowance is reached: it does the work it can still pay for', async () => {
        const { answered, store, builder } = run({ items: [received(0), received(1)] });

        store.payUnpaid.mockResolvedValueOnce({ kind: 'paid', ordinals: [0] });

        expect(await answered).toBe(VIEW);
        expect(builder.build).toHaveBeenCalledOnce();
    });

    it('one item’s job that cannot be created does not stop the others', async () => {
        const { answered, parseJobs, store } = run({ items: [received(0), received(1)] });

        parseJobs.createPrepaid.mockRejectedValueOnce(new Error('queue down'));
        await answered;

        expect(store.items.get(0)?.stage).toBe('received');
        expect(store.items.get(1)?.stage).toBe('parsing');
    });
});

describe('ImportAdvanceService — matching the jobs that finished and taking the snapshot', () => {
    const job = (id: string, status: 'running' | 'complete' | 'partial' = 'complete') =>
        makeParseJobRecord({
            id,
            status,
            lines: [
                makeParseJobLine({ lineIndex: 0 }),
                makeParseJobLine({
                    lineIndex: 1,
                    sourceLine: '1 tsp salt and pepper',
                    proposal: makeStoredProposal({
                        raw: '1 tsp salt and pepper',
                        quantity: { kind: 'exact', value: 1 },
                        unit: 'teaspoon',
                        statedMeasure: '1 tsp',
                        foods: [
                            { name: 'salt', prep: null },
                            { name: 'pepper', prep: null },
                        ],
                    }),
                }),
                makeParseJobLine({ lineIndex: 2, sourceLine: 'FOR THE SAUCE', status: 'unparseable', proposal: null }),
            ],
        });
    const JOB = importJobIdOf(IMPORT_ID, 0, 0, sha256Hex);
    const parsing = () => received(0, undefined, { stage: 'parsing', allowanceSpentAt: new Date(), parseJobId: JOB });

    it('matches all the finished jobs in ONE call, up to the ceiling', async () => {
        const items = Array.from({ length: 30 }, (_unused, ordinal) =>
            received(ordinal, undefined, {
                stage: 'parsing',
                allowanceSpentAt: new Date(),
                parseJobId: importJobIdOf(IMPORT_ID, ordinal, 0, sha256Hex),
            }),
        );
        const { answered, matcher } = run({ items, jobs: {} });

        await answered;

        expect(matcher.proposeForJobs).toHaveBeenCalledOnce();
        expect(matcher.proposeForJobs.mock.calls[0]?.[2]).toHaveLength(DEFAULT_IMPORT_ADVANCE_LIMITS.matchJobs);
    });

    it('⛔ takes the snapshot of a COMPLETE job whose every food has a current match, one line per (line, food)', async () => {
        const { answered, store } = run({ items: [parsing()], jobs: { [JOB]: job(JOB) } });

        await answered;

        expect(store.calls.snapshot).toHaveLength(1);
        expect(
            store.calls.snapshot[0]?.lines.map(
                (line) => (line as { lineIndex: number; foodIndex: number; phrase: string }).phrase,
            ),
        ).toEqual(['whole milk', 'salt', 'pepper']);
        expect(store.items.get(0)?.stage).toBe('matched');
    });

    it('⛔ takes no snapshot while a food still lacks its match, or while the job still runs', async () => {
        const incomplete = run({
            items: [parsing()],
            jobs: { [JOB]: job(JOB) },
            proposed: (ids) => ids.map((id) => ({ jobId: id, kind: 'ok' as const, matchesComplete: false })),
        });

        await incomplete.answered;
        expect(incomplete.store.calls.snapshot).toHaveLength(0);

        const running = run({ items: [parsing()], jobs: { [JOB]: job(JOB, 'running') } });

        await running.answered;
        expect(running.store.calls.snapshot).toHaveLength(0);
        expect(running.parseJobs.retry).not.toHaveBeenCalled();
    });

    it('⛔ an item whose job has not landed goes to the back of the line, so a stuck job cannot hold back the ones behind it', async () => {
        // 25 jobs that never land fill the whole window; the 26th has finished.
        const stuck = Array.from({ length: 25 }, (_unused, ordinal) =>
            received(ordinal, undefined, {
                stage: 'parsing',
                allowanceSpentAt: new Date(),
                parseJobId: importJobIdOf(IMPORT_ID, ordinal, 0, sha256Hex),
            }),
        );
        const finished = received(25, undefined, {
            stage: 'parsing',
            allowanceSpentAt: new Date(),
            parseJobId: importJobIdOf(IMPORT_ID, 25, 0, sha256Hex),
        });
        const jobs = Object.fromEntries([
            ...stuck.map((item) => [item.parseJobId ?? '', job(item.parseJobId ?? '', 'running')] as const),
            [finished.parseJobId ?? '', job(finished.parseJobId ?? '')],
        ]);
        const first = run({ items: [...stuck, finished], jobs });

        await first.answered;
        expect(first.store.items.get(25)?.stage).toBe('parsing');
        expect(first.store.deferItem).toHaveBeenCalledTimes(25);

        // The same store, next call: the deferred ones are behind, so the finished job is now inside the window.
        await first.service.advance(first.principal, CALLER, IMPORT_ID);

        expect(first.store.items.get(25)?.stage).toBe('matched');
    });

    it('does not defer an item that was matched: it moved on, and has no place to go back to', async () => {
        const { answered, store } = run({ items: [parsing()], jobs: { [JOB]: job(JOB) } });

        await answered;

        expect(store.items.get(0)?.stage).toBe('matched');
        expect(store.deferItem).not.toHaveBeenCalledWith(IMPORT_ID, 0);
    });

    it('re-drives the lines that failed retryably, once per call (a partial job is waiting on a human’s retry)', async () => {
        const { answered, parseJobs } = run({ items: [parsing()], jobs: { [JOB]: job(JOB, 'partial') } });

        await answered;

        expect(parseJobs.retry).toHaveBeenCalledWith(USER, JOB);
    });

    it('⛔ lets go of a job that expired or vanished (the generation moves), and snapshots nothing', async () => {
        const gone = run({
            items: [parsing()],
            proposed: (ids) => ids.map((id) => ({ jobId: id, kind: 'missing' as const })),
        });

        await gone.answered;

        expect(gone.store.detachExpiredJob).toHaveBeenCalledWith(IMPORT_ID, 0, 0);
        expect(gone.store.calls.snapshot).toHaveLength(0);
    });

    it('does nothing for a job the batch skipped (the deadline passed before it was read)', async () => {
        const { answered, store } = run({
            items: [parsing()],
            proposed: (ids) => ids.map((id) => ({ jobId: id, kind: 'skipped' as const })),
        });

        await answered;

        expect(store.detachExpiredJob).not.toHaveBeenCalled();
        expect(store.calls.snapshot).toHaveLength(0);
    });
});

describe('ImportAdvanceService — saving what is ready', () => {
    const milk = makeLine({
        id: 'L-milk',
        lineIndex: 0,
        foodIndex: 0,
        sourceLine: '2 cups whole milk',
        phrase: 'whole milk',
        judgementDigest: 'jd-milk',
        quantity: '2',
        unit: 'cups',
    });
    const salt = makeLine({
        id: 'L-salt',
        lineIndex: 1,
        foodIndex: 0,
        sourceLine: '1 tsp salt and pepper',
        phrase: 'salt',
        name: 'salt',
        judgementDigest: 'jd-salt',
        quantity: '1',
        unit: 'tsp',
    });
    const pepper = makeLine({
        id: 'L-pepper',
        lineIndex: 1,
        foodIndex: 1,
        sourceLine: '1 tsp salt and pepper',
        phrase: 'pepper',
        name: 'pepper',
        judgementDigest: 'jd-pepper',
        quantity: null,
        unit: '',
    });
    const payloadLines = ['  2 cups whole milk ', '1 tsp salt and pepper', 'FOR THE SAUCE'];
    const item = () => matched(0, { payload: recipe(payloadLines), ...BOOK, visibility: 'private', decisionRev: 7 });
    const matches = {
        'L-milk': view(),
        'L-salt': view({ state: 'default', reason: 'defaultApplies', proposed: null }),
        'L-pepper': view({
            state: 'needsChoice',
            reason: 'noProposal',
            proposed: null,
            candidates: [{ kind: 'root', id: 'F-pepper', name: 'Pepper', isDefault: false }],
        }),
    };
    const world = (extra: World = {}): World => ({
        items: [item()],
        lines: { 0: [milk, salt, pepper] },
        matches,
        ...extra,
    });

    // Rewritten 2026-11-11: it pinned a DRAFT save. ADR-0072 §3 saves every item PUBLISHED, never as a draft, so it now pins
    // the published save and the file's cuisine it carries.
    it('⛔ saves a ready item as ONE PUBLISHED recipe through the create path with the provenance the statement sets', async () => {
        const { answered, recipes } = run(world());

        await answered;

        expect(recipes.create).toHaveBeenCalledOnce();

        const [principal, dto, caller, imported] = recipes.create.mock.calls[0] ?? [];

        expect(principal).toBe(COOK);
        expect(caller).toBe(CALLER);
        expect(dto).toMatchObject({
            title: 'Soup',
            status: 'published',
            cuisine: 'French',
            visibility: RecipeVisibility.PRIVATE,
            servings: 1,
            prepTimeMinutes: 0,
            cookTimeMinutes: 0,
            totalTimeMinutes: 0,
            steps: [{ instruction: 'Mix.', timerSeconds: 30 }],
        });
        expect(imported).toMatchObject({
            provenance: {
                sourceType: RecipeSourceType.IMPORTED_PHYSICAL,
                sourceUrl: null,
                sourceAttribution: 'Joy, p. 12',
            },
        });
    });

    it('⛔ binds the confident line as `exact`, the default as `default` (keepAsWritten), the open food and the heading as written', async () => {
        const { answered, recipes, ingredients } = run(world());

        await answered;

        const [, dto, , imported] = recipes.create.mock.calls[0] ?? [];

        expect(ingredients.addByRef.mock.calls.map((call) => (call[1] as { id: string }).id)).toEqual([
            'F-whole',
            'F-table',
        ]);
        expect(
            (dto as { ingredients: { ingredientId: string }[] }).ingredients.map((line) => line.ingredientId),
        ).toEqual([
            'LK-F-whole',
            'LK-F-table',
            expect.stringContaining('FREE-') as unknown as string,
            expect.stringContaining('FREE-') as unknown as string,
        ]);
        expect((imported as { lineOrigins: unknown[] }).lineOrigins).toEqual([
            { kind: 'set', boundBy: 'exact', importLineId: 'L-milk' },
            { kind: 'set', boundBy: 'default', importLineId: 'L-salt' },
            { kind: 'set', boundBy: null, importLineId: 'L-pepper' },
            { kind: 'set', boundBy: null, importLineId: null },
        ]);
    });

    it('declares each line as the file said it: the RAW line (untrimmed), the phrase, the saved measure, the preparation', async () => {
        const { answered, recipes } = run(world());

        await answered;

        const lines = firstCreate(recipes).dto.ingredients;

        expect(lines[0]).toMatchObject({
            quantity: { kind: 'exact', value: 2 },
            unit: 'cups',
            sourceLine: '  2 cups whole milk ',
            sourcePhrase: 'whole milk',
        });
        // The second food of the line states no amount; the heading, which parsed to nothing, is kept whole.
        expect(lines[2]).toMatchObject({
            quantity: { kind: 'absent' },
            sourceLine: '1 tsp salt and pepper',
            sourcePhrase: 'pepper',
        });
        expect(lines[2]).not.toHaveProperty('unit');
        expect(lines[3]).toMatchObject({ quantity: { kind: 'absent' }, sourceLine: 'FOR THE SAUCE' });
        expect(lines[3]).not.toHaveProperty('sourcePhrase');
    });

    it('names a line kept as written with its parsed phrase, and a heading with its text (declared, never converging)', async () => {
        const { answered, ingredients } = run(world());

        await answered;

        expect(ingredients.createFreeform.mock.calls.map((call) => call[0])).toEqual(['pepper', 'FOR THE SAUCE']);
    });

    it('⛔ saves the row the editor saves: the shown words and the note, and a line kept as written under its saved NAME', async () => {
        // Owner ruling 2026-11-08: the cook's words are the shown name and "(9 inch)" is a note. The snapshot keeps the row
        // `pastedLineRowOf` built (migration 0067); the phrase is what the match was asked, not what the line is called.
        const shown = { ...milk, displayText: 'farm-fresh whole milk', note: '1 quart jar' };
        const named = { ...pepper, name: 'cracked pepper' };
        const { answered, recipes, ingredients } = run(world({ lines: { 0: [shown, salt, named] } }));

        await answered;

        const lines = firstCreate(recipes).dto.ingredients;

        expect(lines[0]).toMatchObject({ displayText: 'farm-fresh whole milk', note: '1 quart jar' });
        expect(lines[1]).not.toHaveProperty('displayText');
        expect(lines[1]).not.toHaveProperty('note');
        expect(ingredients.createFreeform.mock.calls.map((call) => call[0])).toEqual([
            'cracked pepper',
            'FOR THE SAUCE',
        ]);
        // The phrase still travels as the line's source phrase: it is the memo's key grain.
        expect(lines[2]).toMatchObject({ sourcePhrase: 'pepper' });
    });

    it('⛔ claims the item and keys the saved lines INSIDE the recipe’s transaction, claim first', async () => {
        const rowFor = (id: string, lookup: string) => ({
            id: `ING-${id}`,
            recipeId: 'R-new',
            foodLookupId: lookup,
            quantity: '2',
            quantityHigh: null,
            unit: 'cups',
            sourceLine: '  2 cups whole milk ',
            statedQuantity: null,
            statedQuantityHigh: null,
            statedUnit: null,
            boundBy: 'exact',
            importLineId: id,
        });
        const { answered, store, lines } = run(
            world({
                create: async (_principal, _dto, _caller, imported) => {
                    await runAfterWrite(imported, {
                        recipeId: 'R-new',
                        ingredients: [rowFor('L-milk', 'LK-1')] as never,
                        identities: new Map([
                            [
                                'LK-1',
                                {
                                    arm: {
                                        kind: 'root',
                                        lookupId: 'LK-1',
                                        foodId: 'F-whole',
                                        foodOwnerId: null,
                                        createdAt: new Date(),
                                    },
                                },
                            ],
                        ]) as never,
                    });

                    return { id: 'R-new' };
                },
            }),
        );

        await answered;

        // The fence: the claim carries the revision of the item AS THE SAVE READ IT (see `decisionRev`), not a fresh read.
        expect(store.claimSave).toHaveBeenCalledWith(FAKE_TX, IMPORT_ID, 0, 'R-new', 7);
        expect(lines.setSavedKeys).toHaveBeenCalledOnce();
        expect(lines.setSavedKeys.mock.calls[0]?.[1]).toEqual([
            { id: 'L-milk', key: expect.stringMatching(/^v\d+:/u) as unknown as string },
        ]);
        expect(store.claimSave.mock.invocationCallOrder[0]).toBeLessThan(
            lines.setSavedKeys.mock.invocationCallOrder[0] ?? Number.NaN,
        );
    });

    it('⛔ treats the loser of a save race as done: its recipe rolled back with the failed claim, and nothing throws', async () => {
        const { answered } = run(
            world({
                create: async () => {
                    throw new ImportItemAlreadyClaimedError(0);
                },
            }),
        );

        await expect(answered).resolves.toBe(VIEW);
    });

    it('⛔ a decision written while the recipe is being built rolls the claim back: the item is NOT saved, and waits for the next call', async () => {
        const first = run(
            world({
                create: async (_principal, _dto, _caller, imported) => {
                    // The cook changes their statement while food is being asked: the fence moves before the claim.
                    const current = first.store.items.get(0);

                    if (current !== undefined) {
                        first.store.items.set(0, { ...current, decisionRev: current.decisionRev + 1 });
                    }

                    await runAfterWrite(imported);

                    return { id: 'R-new' };
                },
            }),
        );

        await first.answered;

        expect(first.store.claimSave).toHaveBeenCalled();
        expect(first.store.items.get(0)).toMatchObject({ stage: 'matched', recipeId: null });
        // It goes to the back of the line, like any item that could not save yet; it is not counted as saved.
        expect(first.store.deferItem).toHaveBeenCalledWith(IMPORT_ID, 0);
    });

    describe('what waits instead of saving', () => {
        it('an item with no statement', async () => {
            const { answered, recipes } = run(
                world({ items: [matched(0, { statementKind: null, visibility: 'private' })] }),
            );

            await answered;
            expect(recipes.create).not.toHaveBeenCalled();
        });

        it('⛔ an item whose visibility the policy refuses for its label: a book recipe asked to be public', async () => {
            const { answered, recipes } = run(world({ items: [matched(0, { ...BOOK, visibility: 'public' })] }));

            await answered;
            expect(recipes.create).not.toHaveBeenCalled();
        });

        it('⛔ an item with a line food could not name: it is decided later, never saved on a guess', async () => {
            const { answered, recipes } = run(world({ matches: { ...matches, 'L-milk': null } }));

            await answered;
            expect(recipes.create).not.toHaveBeenCalled();
        });

        it('an item food could not be asked to admit a food for (a 502 is a wait, not a failure of the call)', async () => {
            const { answered, recipes } = run(
                world({
                    addByRef: async () => {
                        throw new HttpException(
                            { code: 'SOURCE_UNAVAILABLE', message: 'down' },
                            HttpStatus.BAD_GATEWAY,
                        );
                    },
                }),
            );

            await expect(answered).resolves.toBe(VIEW);
            expect(recipes.create).not.toHaveBeenCalled();
        });

        it('a food that cannot back a line is kept AS WRITTEN rather than failing the item', async () => {
            const { answered, recipes } = run(
                world({
                    addByRef: async (_caller, ref) => {
                        if ((ref as { id: string }).id === 'F-table') {
                            throw foodNotAdmissible('F-table', 'absent');
                        }

                        return { id: 'LK-ok' };
                    },
                }),
            );

            await answered;

            const [, , , imported] = recipes.create.mock.calls[0] ?? [];

            expect((imported as { lineOrigins: unknown[] }).lineOrigins[1]).toEqual({
                kind: 'set',
                boundBy: null,
                importLineId: 'L-salt',
            });
        });

        it('⛔ a review-mode item the cook has not finished', async () => {
            const { answered, recipes } = run(world({ header: { matchMode: 'review' } }));

            await answered;
            expect(recipes.create).not.toHaveBeenCalled();
        });

        it('a keepAsWritten item still waiting on a line the gate is checking, until the wait has passed', async () => {
            const checking = { ...matches, 'L-pepper': view({ state: 'checking', reason: 'awaitingReview' }) };
            const fresh = run(
                world({ matches: checking, items: [item()].map((held) => ({ ...held, matchedAt: new Date() })) }),
            );

            await fresh.answered;
            expect(fresh.recipes.create).not.toHaveBeenCalled();

            const waited = run(world({ matches: checking }));

            await waited.answered;
            expect(waited.recipes.create).toHaveBeenCalledOnce();
        });
    });

    describe('⛔ nothing binds without the cook when the AI budget is spent', () => {
        const spent = Object.fromEntries(
            Object.entries(matches).map(([id, match]) => [
                id,
                { ...match, state: 'needsChoice' as const, reason: 'reviewBudgetSpent', proposed: null },
            ]),
        );

        it.each(['keepAsWritten', 'bindBest', 'review'] as const)(
            'saves every line as written in %s mode (review once closed)',
            async (matchMode) => {
                const { answered, recipes, ingredients } = run(
                    world({
                        matches: spent,
                        header: { matchMode, ...(matchMode === 'review' ? { reviewClosedAt: new Date() } : {}) },
                    }),
                );

                await answered;

                expect(ingredients.addByRef).not.toHaveBeenCalled();
                expect(firstCreate(recipes).imported.lineOrigins.map((origin) => origin.boundBy)).toEqual([
                    null,
                    null,
                    null,
                    null,
                ]);
            },
        );

        it('lets the cook’s own pick bind', async () => {
            const picked = [{ ...milk, pickedFoodId: 'F-skim', pickedAgainstDigest: 'jd-milk' }, salt, pepper];
            const { answered, recipes, ingredients } = run(world({ matches: spent, lines: { 0: picked } }));

            await answered;

            expect(ingredients.addByRef.mock.calls.map((call) => call[1])).toEqual([{ kind: 'root', id: 'F-skim' }]);
            expect(firstCreate(recipes).imported.lineOrigins[0]).toEqual({
                kind: 'set',
                boundBy: 'cook',
                importLineId: 'L-milk',
            });
        });
    });

    it('binds a cook-picked VARIANT through the ref the pick named', async () => {
        const picked = [{ ...milk, pickedFoodVariantId: 'V-flat', pickedAgainstDigest: 'jd-milk' }, salt, pepper];
        const { answered, ingredients } = run(world({ lines: { 0: picked } }));

        await answered;

        expect(ingredients.addByRef.mock.calls[0]?.[1]).toEqual({ kind: 'variant', id: 'V-flat' });
    });

    describe('⛔ what Publish needs: a gap holds the item for the cook (ADR-0072 §3 as amended 2026-11-11)', () => {
        const noCuisine = () =>
            matched(0, { payload: { ...recipe(payloadLines), cuisine: undefined }, decisionRev: 7 });

        it("saves the cook's cuisine over the file's", async () => {
            const { answered, recipes } = run(world({ items: [{ ...item(), cuisine: 'Thai' }] }));

            await answered;

            expect(recipes.create.mock.calls[0]?.[1]).toMatchObject({ status: 'published', cuisine: 'Thai' });
        });

        it('⛔ holds an item with no cuisine at the revision it read: no create, no match read, no deferral', async () => {
            const { answered, recipes, store, lineView } = run(world({ items: [noCuisine()] }));

            await answered;

            expect(recipes.create).not.toHaveBeenCalled();
            // Held before the costly part: the match read asks food and the review gate.
            expect(lineView.matchesOf).not.toHaveBeenCalled();
            expect(store.holdItem).toHaveBeenCalledWith(IMPORT_ID, 0, 7);
            expect(store.deferItem).not.toHaveBeenCalled();
        });

        it('holds a recipe with no step, and one with no ingredient line, the same way', async () => {
            const noSteps = run(world({ items: [matched(0, { payload: { ...recipe(payloadLines), steps: [] } })] }));
            const noLines = run(world({ items: [matched(0, { payload: recipe([]) })], lines: { 0: [] } }));

            await Promise.all([noSteps.answered, noLines.answered]);

            expect(noSteps.recipes.create).not.toHaveBeenCalled();
            expect(noSteps.store.holdItem).toHaveBeenCalledOnce();
            expect(noLines.recipes.create).not.toHaveBeenCalled();
            expect(noLines.store.holdItem).toHaveBeenCalledOnce();
        });

        it('⛔ never re-queues a held item: the next calls do not look at it, until a decision of the cook releases it', async () => {
            const built = build(world({ items: [noCuisine()] }));
            const advance = () => built.service.advance(built.principal, CALLER, IMPORT_ID);

            await advance();
            await advance();
            await advance();

            // Looked at ONCE, then left alone: a removed hold would examine it on every call.
            expect(built.store.holdItem).toHaveBeenCalledOnce();
            expect(built.lineView.matchesOf).not.toHaveBeenCalled();
            expect(built.recipes.create).not.toHaveBeenCalled();
            expect(built.store.items.get(0)?.stage).toBe('matched');

            // The cook gives a cuisine in the wizard: a decision, so the revision moves past the hold.
            built.store.decide(0, { cuisine: 'Mexican' });
            await advance();

            expect(built.recipes.create).toHaveBeenCalledOnce();
            expect(built.recipes.create.mock.calls[0]?.[1]).toMatchObject({ status: 'published', cuisine: 'Mexican' });
            expect(built.store.items.get(0)?.stage).toBe('saved');
        });

        it('saves a public-domain web import with no cuisine, which Publish does not ask of it', async () => {
            const { answered, recipes, store } = run(
                world({
                    items: [
                        matched(0, {
                            payload: { ...recipe(payloadLines), cuisine: undefined },
                            statementKind: 'source',
                            sourceKind: 'public_web',
                            citation: 'https://example.org/r',
                            visibility: 'public',
                        }),
                    ],
                }),
            );

            await answered;

            expect(store.holdItem).not.toHaveBeenCalled();
            expect(recipes.create).toHaveBeenCalledOnce();
            expect(recipes.create.mock.calls[0]?.[1]).not.toHaveProperty('cuisine');
        });

        it('⛔ holds an item the create path refuses as unpublishable too, and does not fail the call', async () => {
            const { answered, store } = run(
                world({
                    create: async () => {
                        throw publishRequirementsUnmet('A published recipe needs: cuisine.', ['cuisine']);
                    },
                }),
            );

            await expect(answered).resolves.toBe(VIEW);
            expect(store.holdItem).toHaveBeenCalledWith(IMPORT_ID, 0, 7);
            expect(store.deferItem).not.toHaveBeenCalled();
        });
    });

    describe('private slots (ADR-0073)', () => {
        const none: PrivateSlotsPort = { hasAvailable: async () => false };

        it('⛔ does not even try a PRIVATE save when no slot is free, and still saves the PUBLIC ones', async () => {
            const publicItem = matched(1, {
                statementKind: 'authored',
                visibility: 'public',
                payload: recipe(payloadLines),
            });
            const { answered, recipes } = run(
                world({
                    slots: none,
                    items: [item(), publicItem],
                    lines: { 0: [milk, salt, pepper], 1: [milk, salt, pepper] },
                }),
            );

            await answered;

            expect(recipes.create).toHaveBeenCalledOnce();
            expect(firstCreate(recipes).dto.visibility).toBe(RecipeVisibility.PUBLIC);
        });

        it('⛔ maps the save path’s PRIVATE_SLOTS_FULL denial to a pause: no more private saves this call', async () => {
            const items = [item(), matched(1, { ...BOOK, visibility: 'private', payload: recipe(payloadLines) })];
            const { answered, recipes } = run(
                world({
                    items,
                    lines: { 0: [milk, salt, pepper], 1: [milk, salt, pepper] },
                    create: async () => {
                        throw privateSlotsFull(50, 50);
                    },
                }),
            );

            await expect(answered).resolves.toBe(VIEW);
            expect(recipes.create).toHaveBeenCalledOnce();
        });
    });

    describe('bounds', () => {
        it('saves at most the ceiling in one call', async () => {
            const many = Array.from({ length: 9 }, (_unused, ordinal) =>
                matched(ordinal, { ...BOOK, visibility: 'private', payload: recipe(payloadLines) }),
            );
            const byItem = Object.fromEntries(many.map((held) => [held.ordinal, [milk, salt, pepper]]));
            const { answered, recipes } = run({ items: many, lines: byItem, matches });

            await answered;

            expect(recipes.create).toHaveBeenCalledTimes(DEFAULT_IMPORT_ADVANCE_LIMITS.saveBatch);
        });

        it('⛔ starts no save once the call’s deadline leaves too little time for one', async () => {
            let clock = 1_000_000;
            const many = [0, 1, 2].map((ordinal) =>
                matched(ordinal, { ...BOOK, visibility: 'private', payload: recipe(payloadLines) }),
            );
            const { answered, recipes } = run({
                items: many,
                lines: Object.fromEntries(many.map((held) => [held.ordinal, [milk, salt, pepper]])),
                matches,
                limits: { now: () => clock },
                create: async (...args) => {
                    clock += 7_000; // the first save is slow
                    await runAfterWrite(args[3], { recipeId: 'R', ingredients: [], identities: new Map() });

                    return { id: 'R' };
                },
            });

            await answered;

            expect(recipes.create).toHaveBeenCalledOnce();
        });
    });

    it('one item’s unexpected failure does not stop the next from saving', async () => {
        const many = [0, 1].map((ordinal) =>
            matched(ordinal, { ...BOOK, visibility: 'private', payload: recipe(payloadLines) }),
        );
        let calls = 0;
        const { answered, recipes } = run({
            items: many,
            lines: { 0: [milk, salt, pepper], 1: [milk, salt, pepper] },
            matches,
            create: async (...args) => {
                calls += 1;

                if (calls === 1) {
                    throw new Error('boom');
                }

                await runAfterWrite(args[3], { recipeId: 'R', ingredients: [], identities: new Map() });

                return { id: 'R' };
            },
        });

        await expect(answered).resolves.toBe(VIEW);
        expect(recipes.create).toHaveBeenCalledTimes(2);
    });
});

describe('ImportAdvanceService.advance — the whole step', () => {
    it('runs pay, parse, match and save in that order and answers the view the builder derives', async () => {
        const jobId = importJobIdOf(IMPORT_ID, 0, 0, sha256Hex);
        const job = makeParseJobRecord({ id: jobId, status: 'complete', lines: [makeParseJobLine({ lineIndex: 0 })] });
        const line = makeLine({ id: 'L-milk', sourceLine: '2 cups whole milk' });
        const { answered, store, parseJobs, matcher, recipes } = run({
            items: [received(0, ['2 cups whole milk'], { statementKind: 'authored', visibility: 'private' })],
            jobs: { [jobId]: job },
            lines: { 0: [line] },
            header: { visibility: 'public' },
        });

        expect(await answered).toBe(VIEW);

        const order = [
            store.payUnpaid,
            parseJobs.createPrepaid,
            matcher.proposeForJobs,
            store.snapshot,
            recipes.create,
        ].map((spy) => spy.mock.invocationCallOrder[0] ?? Number.NaN);

        expect(order).toEqual([...order].sort((a, b) => a - b));
    });

    it('is not found for a stranger’s import, and does no work', async () => {
        const { service, imports, store } = build({ items: [received(0)] });

        imports.findHeader.mockResolvedValueOnce(undefined as never);

        await expect(service.advance(COOK, CALLER, IMPORT_ID)).rejects.toMatchObject({ code: 'IMPORT_NOT_FOUND' });
        expect(store.payUnpaid).not.toHaveBeenCalled();
        expect(imports.touch).not.toHaveBeenCalled();
    });

    // Review finding 3 on #185-#188: ADR-0072 §9 purges an import 30 days after its last `advance`, but an advance that wrote
    // nothing (every item waiting on the cook's review) left `updated_at` where it was, so an import the cook was still
    // working through aged out from its last write instead.
    it('⛔ moves the activity clock on every advance, even one that writes nothing else', async () => {
        const { service, imports, recipes } = build({
            items: [matched(0, { stage: 'saved', savedAt: new Date(), recipeId: 'R' })],
        });

        await service.advance(COOK, CALLER, IMPORT_ID);

        expect(imports.touch).toHaveBeenCalledExactlyOnceWith(IMPORT_ID);
        expect(recipes.create).not.toHaveBeenCalled();
    });

    it('does nothing and answers the view for an import whose items are all saved', async () => {
        const { answered, store, recipes } = run({
            items: [matched(0, { stage: 'saved', savedAt: new Date(), recipeId: 'R' })],
        });

        expect(await answered).toBe(VIEW);
        expect(recipes.create).not.toHaveBeenCalled();
        expect(store.attachJob).not.toHaveBeenCalled();
    });
});
