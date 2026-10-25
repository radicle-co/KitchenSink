/**
 * `MatchProposalService` — the paste matcher's orchestration (ADR-0071), against fakes for every port.
 *
 * What each case guards, and the failure it is written against:
 *
 *  - **Owner-only, live jobs.** A stranger's job is one 404 with an absent one; an expired job is a 409, like retry.
 *  - **Proposals, never binds, as the cook.** The chain runs AS the caller and its answer is stored as a proposal. The
 *    lexical shortlist runs for EVERY proposal, because the candidates and the "a default applies" fact come from it.
 *  - **An outage is never stored as "no match".** A tier that could not look, a food service that could not be asked,
 *    or a switched-off catalog writes no row, so the next call retries; a stored no-match is never recomputed.
 *  - **One message per proposal, paid once.** The verdict key equals what the save path computes for a kept line; a
 *    verdict already on record, or a row already sent, sends nothing; a send is claimed, and a failed one released.
 *  - **The work is bounded.** A long paste is matched over several calls, never in one unbounded request.
 */
import { describe, expect, it, vi } from 'vitest';

import { verificationKey } from '@kitchensink/recipe-core/resolution/verification-key';

import { CallerToken } from '../../auth/CallerToken.js';
import { sha256Hex } from '../../common/sha256.js';
import type { FoodRef } from '../../database/schema/foodLookupArm.js';
import type { FoodRefAnswer } from '../../ingredients/domain/foodRefAnswer.js';
import { canonicalIngredientName } from '../../ingredients/domain/ingredientName.js';
import type { FoodRefsGateway } from '../../ingredients/foodRefs.gateway.js';
import type { RankedCandidate, ResolutionTier } from '../../ingredients/resolution/resolutionCascade.js';
import { fakeLineVerificationsDal } from '../__fixtures__/lineVerificationsDal.fixture.js';
import {
    inMemoryParseJobMatches,
    makeParseJobLine,
    makeParseJobRecord,
    makeStoredProposal,
} from '../__fixtures__/parseJobMatches.fixture.js';
import { fakeVerificationQueue } from '../__fixtures__/verificationQueue.fixture.js';
import type { LineVerificationsDal } from '../dal/lineVerifications.dal.js';
import { MatchProposalService, type MatchProposalLimits } from '../matchProposal.service.js';
import type { ParseJobRecord } from '../parseJobs.service.js';
import { isRecipeDomainError } from '../recipe.error.js';

const OWNER = '01JMATCHPROPOSALOWNER00001';
const JOB = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
const CALLER = CallerToken.fromAuthorizationHeader('Bearer cook-token');

/** What each tier holds for the phrase it is asked about. */
interface World {
    curated?: FoodRef;
    memo?: FoodRef;
    /** `'unavailable'` makes the lexical tier throw, as it does on a down catalog. */
    lexical?: readonly RankedCandidate[] | 'unavailable';
}

/** Stub tiers in the proposal chain's order, reading `world` at call time. */
function tiersOver(world: World) {
    const curated = vi.fn(async () =>
        world.curated === undefined
            ? ({ kind: 'pass', tier: 'curated', reason: 'none' } as const)
            : ({ kind: 'resolved', tier: 'curated', food: world.curated, evidence: 'curated' } as const),
    );
    const memo = vi.fn(async () =>
        world.memo === undefined
            ? ({ kind: 'pass', tier: 'memo', reason: 'none' } as const)
            : ({ kind: 'resolved', tier: 'memo', food: world.memo, evidence: 'memo' } as const),
    );
    const lexical = vi.fn(async () => {
        if (world.lexical === 'unavailable') {
            throw new Error('catalog unavailable');
        }

        const [top] = world.lexical ?? [];

        return top === undefined
            ? ({ kind: 'pass', tier: 'lexical', reason: 'none' } as const)
            : ({
                  kind: 'resolved',
                  tier: 'lexical',
                  food: top.food,
                  evidence: 'lexical',
                  rung: top.rung,
                  confidence: 0.2,
                  candidates: world.lexical === undefined ? [] : [...world.lexical],
              } as const);
    });
    const tiers: readonly ResolutionTier[] = [
        { id: 'curated', resolve: curated },
        { id: 'memo', resolve: memo },
        { id: 'lexical', resolve: lexical },
    ];

    return { tiers, curated, memo, lexical };
}

/** A found answer naming a root, or a variant of `rootId`. */
function found(name: string, rootId: string, variantId?: string, isPrivate = false): FoodRefAnswer {
    return {
        outcome: 'found',
        name: canonicalIngredientName(name),
        status: 'RESOLVED',
        isPrivate,
        rootId,
        ...(variantId === undefined ? {} : { variant: { id: variantId, parts: [{ attribute: 'cut', text: 'flat' }] } }),
    };
}

/** A refs gateway answering from a table; unlisted refs are `absent`. */
function refsAnswering(answers: Record<string, FoodRefAnswer>) {
    const resolve = vi.fn(async (_caller: unknown, refs: readonly FoodRef[]) => ({
        answers: new Map(
            refs.map((ref) => [`${ref.kind}:${ref.id}`, answers[`${ref.kind}:${ref.id}`] ?? { outcome: 'absent' }]),
        ),
        degraded: false,
    }));

    return { gateway: { resolve } as unknown as FoodRefsGateway, resolve };
}

const MILK_RANKED: readonly RankedCandidate[] = [
    { food: { kind: 'root', id: 'F-whole' }, rung: 'head' },
    { food: { kind: 'root', id: 'F-crackers' }, rung: 'tokenSet' },
];

interface Setup {
    readonly job?: ParseJobRecord | undefined;
    readonly world?: World;
    readonly answers?: Record<string, FoodRefAnswer>;
    readonly verdicts?: LineVerificationsDal;
    readonly enabled?: boolean;
    readonly limits?: MatchProposalLimits;
}

function setup(options: Setup = {}) {
    const job = 'job' in options ? options.job : makeParseJobRecord();
    const matches = inMemoryParseJobMatches(new Map([[JOB, OWNER]]));
    const chain = tiersOver(options.world ?? { lexical: MILK_RANKED });
    const refs = refsAnswering(
        options.answers ?? {
            'root:F-whole': found('Milk, whole', 'F-whole'),
            'root:F-crackers': found('Milk crackers', 'F-crackers'),
        },
    );
    const queue = fakeVerificationQueue();
    const getJob = vi.fn(async (ownerId: string) => (ownerId === OWNER ? job : undefined));
    const service = new MatchProposalService(
        { getJob },
        matches,
        chain.tiers,
        { enabled: options.enabled ?? true },
        refs.gateway,
        queue,
        options.verdicts ?? fakeLineVerificationsDal(),
        options.limits,
    );

    return { service, matches, chain, refs, queue, getJob };
}

/** The verdict key the save path computes for "2 cups whole milk" kept on `foodId`. */
const milkKey = (foodId: string): string =>
    verificationKey(
        {
            sourceLine: '2 cups whole milk',
            foodRefId: foodId,
            quantityLow: 2,
            quantityHigh: null,
            unit: 'cup',
            statedMeasure: null,
        },
        sha256Hex,
    );

describe('MatchProposalService.propose — whose job, and which jobs', () => {
    it('⛔ answers PARSE_JOB_NOT_FOUND for a stranger, and writes nothing', async () => {
        const { service, matches, queue } = setup();

        await expect(service.propose('01JSTRANGER0000000000000001', CALLER, JOB)).rejects.toSatisfy(
            (error) => isRecipeDomainError(error) && error.code === 'PARSE_JOB_NOT_FOUND',
        );
        expect(matches.rows.size).toBe(0);
        expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('⛔ answers PARSE_JOB_EXPIRED once the TTL passed', async () => {
        const { service, matches } = setup({ job: makeParseJobRecord({ expiresAt: new Date(Date.now() - 1_000) }) });

        await expect(service.propose(OWNER, CALLER, JOB)).rejects.toSatisfy(
            (error) => isRecipeDomainError(error) && error.code === 'PARSE_JOB_EXPIRED',
        );
        expect(matches.rows.size).toBe(0);
    });

    it('matches only PARSED lines with a proposal — pending, withdrawn and unparseable lines wait or are done', async () => {
        const { service, matches } = setup({
            job: makeParseJobRecord({
                lines: [
                    makeParseJobLine({ lineIndex: 0, status: 'pending', proposal: null }),
                    makeParseJobLine({ lineIndex: 1, status: 'withdrawn', proposal: null }),
                    makeParseJobLine({ lineIndex: 2, status: 'unparseable', proposal: null }),
                ],
            }),
        });

        await service.propose(OWNER, CALLER, JOB);

        expect(matches.rows.size).toBe(0);
    });

    it('⛔ proposes NOTHING while the operator has the catalog switched off — a no-match then would stick', async () => {
        const { service, matches, chain } = setup({ enabled: false });

        await service.propose(OWNER, CALLER, JOB);

        expect(matches.rows.size).toBe(0);
        expect(chain.curated).not.toHaveBeenCalled();
    });
});

describe('MatchProposalService.propose — the proposal and its message', () => {
    it('stores the lexical proposal with its candidates, and sends ONE parse-job verification', async () => {
        const { service, matches, queue, chain } = setup();

        await service.propose(OWNER, CALLER, JOB);

        // AS the cook: the chain gets the caller and the owner.
        expect(chain.lexical).toHaveBeenCalledWith(expect.objectContaining({ phrase: 'whole milk' }), {
            userId: OWNER,
            caller: CALLER,
        });
        const [row] = matches.rows.values();

        expect(row).toMatchObject({
            lineIndex: 0,
            foodIndex: 0,
            lineDigest: 'digest-0',
            proposal: { matchedBy: 'lexical', food: { kind: 'root', id: 'F-whole' }, rung: 'head', margin: 0.2 },
            candidates: [
                { kind: 'root', id: 'F-whole', rung: 'head' },
                { kind: 'root', id: 'F-crackers', rung: 'tokenSet' },
            ],
            verificationKey: milkKey('F-whole'),
        });
        expect(row?.enqueuedAt).not.toBeNull();
        expect(queue.enqueue).toHaveBeenCalledTimes(1);

        const [message] = queue.enqueue.mock.calls[0]?.[0] ?? [];

        expect(message).toStrictEqual({
            origin: { kind: 'parseJob', jobId: JOB, lineIndex: 0, foodIndex: 0 },
            sourceLine: '2 cups whole milk',
            foodId: 'F-whole',
            candidateFoodName: 'Milk, whole',
            quantityLow: 2,
            quantityHigh: null,
            unit: 'cup',
            evidenceKind: 'unattributed',
            shortlist: [],
            requestedAt: expect.any(String),
        });
    });

    it('keys a SECOND food of a line with no measure, as the editor saves it', async () => {
        const { service, queue } = setup({
            job: makeParseJobRecord({
                lines: [
                    makeParseJobLine({
                        sourceLine: 'salt and pepper',
                        proposal: makeStoredProposal({
                            raw: 'salt and pepper',
                            quantity: { kind: 'absent' },
                            unit: null,
                            statedMeasure: null,
                            foods: [
                                { name: 'salt', prep: null },
                                { name: 'pepper', prep: null },
                            ],
                        }),
                    }),
                ],
            }),
        });

        await service.propose(OWNER, CALLER, JOB);

        const messages = queue.enqueue.mock.calls[0]?.[0] ?? [];

        expect(messages.map((message) => message.origin)).toStrictEqual([
            { kind: 'parseJob', jobId: JOB, lineIndex: 0, foodIndex: 0 },
            { kind: 'parseJob', jobId: JOB, lineIndex: 0, foodIndex: 1 },
        ]);
        expect(messages[1]).toMatchObject({ quantityLow: null, quantityHigh: null, unit: null });
    });

    it('⛔ runs the lexical shortlist even when a CURATED mapping answered — the candidates and the default come from it', async () => {
        const { service, matches, chain } = setup({
            world: {
                curated: { kind: 'root', id: 'F-whole' },
                lexical: [...MILK_RANKED, { food: { kind: 'root', id: 'F-default' }, rung: 'default' }],
            },
            answers: { 'root:F-whole': found('Milk, whole', 'F-whole') },
        });

        await service.propose(OWNER, CALLER, JOB);

        expect(chain.lexical).toHaveBeenCalledTimes(1);
        const [row] = matches.rows.values();

        expect(row?.proposal?.matchedBy).toBe('curated');
        expect(row?.candidates.map((candidate) => candidate.id)).toStrictEqual(['F-whole', 'F-crackers', 'F-default']);
    });

    it('⛔ stores the proposal at its FORWARD END, and keys the verdict there — where the kept line will be bound', async () => {
        const { service, matches, queue } = setup({
            world: { memo: { kind: 'root', id: 'F-retired' }, lexical: [] },
            answers: { 'root:F-retired': found('Beef brisket', 'R-brisket', 'V-flat') },
        });

        await service.propose(OWNER, CALLER, JOB);

        const [row] = matches.rows.values();

        expect(row?.proposal?.food).toStrictEqual({ kind: 'variant', id: 'V-flat' });
        expect(queue.enqueue.mock.calls[0]?.[0]?.[0]).toMatchObject({
            foodVariantId: 'V-flat',
            candidateFoodName: 'Beef brisket (flat)',
        });
    });

    it('marks a proposal of the cook’s own PRIVATE food, so the worker writes no memo for it', async () => {
        const { service, queue } = setup({
            answers: { 'root:F-whole': found('Gran’s milk', 'F-whole', undefined, true) },
        });

        await service.propose(OWNER, CALLER, JOB);

        expect(queue.enqueue.mock.calls[0]?.[0]?.[0]?.privateFood).toBe(true);
    });

    it('drops a proposal food no longer shows the cook — the candidates remain, and nothing is asked', async () => {
        const { service, matches, queue } = setup({
            answers: { 'root:F-crackers': found('Milk crackers', 'F-crackers') },
        });

        await service.propose(OWNER, CALLER, JOB);

        const [row] = matches.rows.values();

        expect(row?.proposal).toBeNull();
        expect(row?.candidates.map((candidate) => candidate.id)).toStrictEqual(['F-crackers']);
        expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('stores NO MATCH for a phrase with no candidates, and asks nothing', async () => {
        const { service, matches, queue } = setup({ world: { lexical: [] } });

        await service.propose(OWNER, CALLER, JOB);

        expect([...matches.rows.values()]).toMatchObject([{ proposal: null, candidates: [], verificationKey: null }]);
        expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('⛔ REFUSES to ask about an over-cap line: the proposal is stored with no key, never truncated', async () => {
        const long = `2 cups whole milk ${'x'.repeat(400)}`;
        const { service, matches, queue } = setup({
            job: makeParseJobRecord({ lines: [makeParseJobLine({ sourceLine: long })] }),
        });

        await service.propose(OWNER, CALLER, JOB);

        const [row] = matches.rows.values();

        expect(row?.proposal?.food.id).toBe('F-whole');
        expect(row?.verificationKey).toBeNull();
        expect(queue.enqueue).not.toHaveBeenCalled();
    });
});

describe('MatchProposalService.propose — an outage is never a stored no-match', () => {
    it('⛔ writes NO row when a tier could not look — the next call retries', async () => {
        const { service, matches } = setup({ world: { lexical: 'unavailable' } });

        await service.propose(OWNER, CALLER, JOB);

        expect(matches.rows.size).toBe(0);
    });

    it('⛔ writes NO row when food could not be asked about the proposal', async () => {
        const { service, matches } = setup({ answers: { 'root:F-whole': { outcome: 'unreachable' } } });

        await service.propose(OWNER, CALLER, JOB);

        expect(matches.rows.size).toBe(0);
    });
});

describe('MatchProposalService.propose — idempotent, and paid once', () => {
    it('⛔ a second call for the same lines runs no tier and sends nothing', async () => {
        const { service, chain, queue } = setup();

        await service.propose(OWNER, CALLER, JOB);
        chain.lexical.mockClear();
        queue.enqueue.mockClear();
        await service.propose(OWNER, CALLER, JOB);

        expect(chain.lexical).not.toHaveBeenCalled();
        expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('re-matches a line whose text was EDITED, and asks about the new proposal', async () => {
        const lines = [makeParseJobLine()];
        const { service, chain, queue } = setup({ job: makeParseJobRecord({ lines }) });

        await service.propose(OWNER, CALLER, JOB);
        lines.splice(0, 1, makeParseJobLine({ lineDigest: 'digest-edited' }));
        chain.lexical.mockClear();
        queue.enqueue.mockClear();
        await service.propose(OWNER, CALLER, JOB);

        expect(chain.lexical).toHaveBeenCalledTimes(1);
        expect(queue.enqueue).toHaveBeenCalledTimes(1);
    });

    it('⛔ asks NOTHING when a verdict for the proposal is already on record', async () => {
        const verdicts = fakeLineVerificationsDal(new Map([[milkKey('F-whole'), 'verified']]));
        const { service, matches, queue } = setup({ verdicts });

        await service.propose(OWNER, CALLER, JOB);

        expect(queue.enqueue).not.toHaveBeenCalled();
        expect([...matches.rows.values()][0]?.enqueuedAt).toBeNull();
    });

    it('⛔ releases the claim when the send fails, so the next call sends it — and the request still succeeds', async () => {
        const { service, matches, queue } = setup();

        queue.enqueue.mockRejectedValueOnce(new Error('SQS down'));
        await service.propose(OWNER, CALLER, JOB);

        expect([...matches.rows.values()][0]?.enqueuedAt).toBeNull();

        await service.propose(OWNER, CALLER, JOB);

        expect(queue.enqueue).toHaveBeenCalledTimes(2);
        expect([...matches.rows.values()][0]?.enqueuedAt).not.toBeNull();
    });
});

describe('MatchProposalService.propose — bounded work', () => {
    it('⛔ stops matching once its budget is spent, and leaves the rest for the next call', async () => {
        const lines = Array.from({ length: 6 }, (_, index) =>
            makeParseJobLine({ lineIndex: index, lineDigest: `digest-${String(index)}` }),
        );
        const { service, matches } = setup({
            job: makeParseJobRecord({ lines }),
            limits: { concurrency: 2, budgetMs: 0 },
        });

        await service.propose(OWNER, CALLER, JOB);

        expect(matches.rows.size).toBe(0);
    });

    it('matches a long paste over waves of the configured width', async () => {
        const lines = Array.from({ length: 5 }, (_, index) =>
            makeParseJobLine({ lineIndex: index, lineDigest: `digest-${String(index)}` }),
        );
        const { service, matches } = setup({
            job: makeParseJobRecord({ lines }),
            limits: { concurrency: 2, budgetMs: 60_000 },
        });

        await service.propose(OWNER, CALLER, JOB);

        expect(matches.rows.size).toBe(5);
    });
});
