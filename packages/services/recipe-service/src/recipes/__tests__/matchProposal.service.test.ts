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

import { lineDigest, parseStoredLineDigest } from '@kitchensink/recipe-core/parsing/parse-key';
import { verificationDeliveryBoundSeconds } from '@kitchensink/recipe-core/resolution/verification-delivery';
import { verificationKey } from '@kitchensink/recipe-core/resolution/verification-key';
import { verifiedLineIdentityOfMessage } from '@kitchensink/recipe-core/resolution/verification-message';

import { CallerToken } from '../../auth/CallerToken.js';
import type { Principal } from '../../auth/principal.js';
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
import { matchJudgementDigestOf } from '../domain/matchProposal.js';
import { MatchProposalService, type MatchProposalLimits } from '../matchProposal.service.js';
import type { ParseJobRecord } from '../parseJobs.service.js';
import { isRecipeDomainError } from '../recipe.error.js';

const OWNER = '01JMATCHPROPOSALOWNER00001';
const JOB = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
const CALLER = CallerToken.fromAuthorizationHeader('Bearer cook-token');

/** The verified cook, as the auth middleware hands it over. */
const principal = (userId: string, overrides: Partial<Principal> = {}): Principal => ({
    userId,
    sub: `clerk_${userId}`,
    scopes: [],
    permissions: [],
    roles: [],
    principalKind: 'real',
    containment: 'enforce',
    ...overrides,
});
const COOK = principal(OWNER);

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

/** A found answer, narrowed, so a case can override one of its fields. */
function foundRecord(name: string, rootId: string): Extract<FoodRefAnswer, { outcome: 'found' }> {
    const answer = found(name, rootId);

    if (answer.outcome !== 'found') {
        throw new Error('unreachable');
    }

    return answer;
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
    // The store reads each line's digest NOW from the job record, so a suite that edits a line is seen as one.
    const matches = inMemoryParseJobMatches(new Map([[JOB, OWNER]]), (_jobId, lineIndex) => {
        const line = job?.lines.find((candidate) => candidate.lineIndex === lineIndex);

        return line === undefined ? undefined : parseStoredLineDigest(line.lineDigest);
    });
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

/**
 * The verdict key the save path computes for "2 cups whole milk" kept on `foodId`. The unit is the cook's word, `cups`
 * from the parse's `statedMeasure`, because that is what the editor saves (`pastedLineMeasureOf`, ADR-0071).
 */
const milkKey = (foodId: string): string =>
    verificationKey(
        {
            sourceLine: '2 cups whole milk',
            foodRefId: foodId,
            quantityLow: 2,
            quantityHigh: null,
            unit: 'cups',
            statedMeasure: null,
        },
        sha256Hex,
    );

/** A stored, CURRENT row for the default job's one line: the judgement its parse yields now, its review owed. */
function currentMilkRow() {
    const digest = lineDigest('2 cups whole milk', sha256Hex);

    return {
        lineIndex: 0,
        foodIndex: 0,
        lineDigest: digest,
        judgementDigest: matchJudgementDigestOf(
            {
                lineDigest: digest,
                line: {
                    sourceLine: '2 cups whole milk',
                    quantity: { kind: 'exact', value: 2 },
                    unit: 'cup',
                    statedMeasure: '2 cups',
                },
                foodIndex: 0,
                phrase: 'whole milk',
            },
            sha256Hex,
        ),
        proposal: { matchedBy: 'lexical', food: { kind: 'root', id: 'F-whole' }, rung: 'head', margin: 0.2 },
        candidates: [{ kind: 'root', id: 'F-whole', rung: 'head' }],
        verificationKey: milkKey('F-whole'),
        review: 'owed',
    } as const;
}

describe('MatchProposalService.propose — whose job, and which jobs', () => {
    it('⛔ answers PARSE_JOB_NOT_FOUND for a stranger, and writes nothing', async () => {
        const { service, matches, queue } = setup();

        await expect(service.propose(principal('01JSTRANGER0000000000000001'), CALLER, JOB)).rejects.toSatisfy(
            (error) => isRecipeDomainError(error) && error.code === 'PARSE_JOB_NOT_FOUND',
        );
        expect(matches.rows.size).toBe(0);
        expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('⛔ answers PARSE_JOB_EXPIRED once the TTL passed', async () => {
        const { service, matches } = setup({ job: makeParseJobRecord({ expiresAt: new Date(Date.now() - 1_000) }) });

        await expect(service.propose(COOK, CALLER, JOB)).rejects.toSatisfy(
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

        await service.propose(COOK, CALLER, JOB);

        expect(matches.rows.size).toBe(0);
    });

    it('⛔ proposes NOTHING while the operator has the catalog switched off — a no-match then would stick', async () => {
        const { service, matches, chain } = setup({ enabled: false });

        await service.propose(COOK, CALLER, JOB);

        expect(matches.rows.size).toBe(0);
        expect(chain.curated).not.toHaveBeenCalled();
    });
});

describe('MatchProposalService.propose — the proposal and its message', () => {
    it('stores the lexical proposal with its candidates, and sends ONE parse-job verification', async () => {
        const { service, matches, queue, chain } = setup();

        await service.propose(COOK, CALLER, JOB);

        // AS the cook: the chain gets the caller and the owner.
        expect(chain.lexical).toHaveBeenCalledWith(expect.objectContaining({ phrase: 'whole milk' }), {
            userId: OWNER,
            caller: CALLER,
        });
        const [row] = matches.rows.values();

        expect(row).toMatchObject({
            lineIndex: 0,
            foodIndex: 0,
            // The line's stored digest, carried onto the row so a later edit is seen as stale.
            lineDigest: lineDigest('2 cups whole milk', sha256Hex),
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
            // The cook's word, as the editor saves it (`pastedLineMeasureOf`), so the kept line's key is this one.
            unit: 'cups',
            evidenceKind: 'unattributed',
            shortlist: [],
            requestedAt: expect.any(String),
        });
    });

    it('⛔ stores a RUNG-LESS lexical proposal with no rung, keeping its margin and candidates', async () => {
        // Moved here from the by-name path (ADR-0071): a food older than this service, or a rung this build cannot read,
        // sends hits with no rung. The proposal and its shortlist are facts about the scores; only the rung is absent.
        const { service, matches, queue } = setup({
            world: {
                lexical: [
                    { food: { kind: 'root', id: 'F-whole' }, rung: undefined },
                    { food: { kind: 'root', id: 'F-crackers' }, rung: undefined },
                ],
            },
        });

        await service.propose(COOK, CALLER, JOB);

        const [row] = matches.rows.values();

        expect(row).toMatchObject({
            proposal: { matchedBy: 'lexical', food: { kind: 'root', id: 'F-whole' }, rung: null, margin: 0.2 },
            candidates: [
                { kind: 'root', id: 'F-whole', rung: null },
                { kind: 'root', id: 'F-crackers', rung: null },
            ],
        });
        expect(queue.enqueue).toHaveBeenCalledTimes(1);
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

        await service.propose(COOK, CALLER, JOB);

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

        await service.propose(COOK, CALLER, JOB);

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

        await service.propose(COOK, CALLER, JOB);

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

        await service.propose(COOK, CALLER, JOB);

        expect(queue.enqueue.mock.calls[0]?.[0]?.[0]?.privateFood).toBe(true);
    });

    it('drops a proposal food no longer shows the cook — the candidates remain, and nothing is asked', async () => {
        const { service, matches, queue } = setup({
            answers: { 'root:F-crackers': found('Milk crackers', 'F-crackers') },
        });

        await service.propose(COOK, CALLER, JOB);

        const [row] = matches.rows.values();

        expect(row?.proposal).toBeNull();
        expect(row?.candidates.map((candidate) => candidate.id)).toStrictEqual(['F-crackers']);
        expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('stores NO MATCH for a phrase with no candidates, and asks nothing', async () => {
        const { service, matches, queue } = setup({ world: { lexical: [] } });

        await service.propose(COOK, CALLER, JOB);

        expect([...matches.rows.values()]).toMatchObject([{ proposal: null, candidates: [], verificationKey: null }]);
        expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('⛔ REFUSES to ask about an over-cap line: the proposal is stored with no key, never truncated', async () => {
        const long = `2 cups whole milk ${'x'.repeat(400)}`;
        const { service, matches, queue } = setup({
            job: makeParseJobRecord({ lines: [makeParseJobLine({ sourceLine: long })] }),
        });

        await service.propose(COOK, CALLER, JOB);

        const [row] = matches.rows.values();

        expect(row?.proposal?.food.id).toBe('F-whole');
        expect(row?.verificationKey).toBeNull();
        // F10: the refusal is PERSISTED, so the job view never re-runs the policy to find it.
        expect(row?.review).toBe('refused');
        expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('⛔ persists `refused` for a request the queue CONTRACT refuses, sends nothing, and never tries again', async () => {
        // A stated unit longer than the queue's 64-character bound: the editor saves it, the consumer refuses it. The
        // request is undeliverable, so it is parked as refused (logged at error) rather than claimed, failed and
        // released on every poll.
        const unit = 'x'.repeat(70);
        const { service, matches, queue } = setup({
            job: makeParseJobRecord({
                lines: [
                    makeParseJobLine({
                        sourceLine: `2 ${unit} whole milk`,
                        proposal: makeStoredProposal({ raw: `2 ${unit} whole milk`, statedMeasure: `2 ${unit}` }),
                    }),
                ],
            }),
        });

        await service.propose(COOK, CALLER, JOB);
        await service.propose(COOK, CALLER, JOB);

        const [row] = matches.rows.values();

        expect(row).toMatchObject({ review: 'refused', verificationKey: null, enqueuedAt: null });
        expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('stores nothing to review for a proposal food cannot name — no key, no review, and nothing sent', async () => {
        const { service, matches, queue } = setup({
            answers: {
                'root:F-whole': { ...foundRecord('Milk, whole', 'F-whole'), name: undefined },
                'root:F-crackers': found('Milk crackers', 'F-crackers'),
            },
        });

        await service.propose(COOK, CALLER, JOB);

        expect([...matches.rows.values()][0]).toMatchObject({ verificationKey: null, review: null });
        expect(queue.enqueue).not.toHaveBeenCalled();
    });
});

/**
 * The stored key IS the worker's key (ADR-0071). The gate's verdict lands under the key the WORKER derives from the
 * message (`verifiedLineIdentityOfMessage`), and the job view reads it back through the key the ROW stored. The row's
 * key is therefore derived from the exact message that is sent, so the two cannot diverge.
 */
describe('MatchProposalService.propose — the stored key is the key of the message it sends', () => {
    it('⛔ stores, for every proposal it sends, the key the message itself derives', async () => {
        const { service, matches, queue } = setup({
            job: makeParseJobRecord({
                lines: [
                    makeParseJobLine(),
                    makeParseJobLine({
                        lineIndex: 1,
                        sourceLine: '2 tbsp salt and pepper',
                        proposal: makeStoredProposal({
                            raw: '2 tbsp salt and pepper',
                            quantity: { kind: 'exact', value: 2 },
                            unit: 'tablespoon',
                            statedMeasure: '2 tbsp',
                            foods: [
                                { name: 'salt', prep: null },
                                { name: 'pepper', prep: null },
                            ],
                        }),
                    }),
                ],
            }),
        });

        await service.propose(COOK, CALLER, JOB);

        const messages = queue.enqueue.mock.calls.flatMap((call) => [...call[0]]);
        const rows = [...matches.rows.values()];

        expect(messages).toHaveLength(3);
        for (const message of messages) {
            const origin = message.origin?.kind === 'parseJob' ? message.origin : undefined;
            const row = rows.find((candidate) => {
                return candidate.lineIndex === origin?.lineIndex && candidate.foodIndex === origin.foodIndex;
            });

            expect(row?.verificationKey).toBe(verificationKey(verifiedLineIdentityOfMessage(message), sha256Hex));
        }
    });

    it('⛔ sends nothing for a stored row whose key is not the key of the message it would send', async () => {
        const { service, matches, queue } = setup();

        await matches.saveMatches(JOB, [{ ...currentMilkRow(), verificationKey: 'v2:not-the-message-key' }]);

        await service.propose(COOK, CALLER, JOB);

        expect(queue.enqueue).not.toHaveBeenCalled();
    });
});

describe('MatchProposalService.propose — an outage is never a stored no-match', () => {
    it('⛔ writes NO row when a tier could not look — the next call retries', async () => {
        const { service, matches } = setup({ world: { lexical: 'unavailable' } });

        await service.propose(COOK, CALLER, JOB);

        expect(matches.rows.size).toBe(0);
    });

    it('⛔ writes NO row when food could not be asked about the proposal', async () => {
        const { service, matches } = setup({ answers: { 'root:F-whole': { outcome: 'unreachable' } } });

        await service.propose(COOK, CALLER, JOB);

        expect(matches.rows.size).toBe(0);
    });
});

describe('MatchProposalService.propose — idempotent, and paid once', () => {
    it('⛔ a second call for the same lines runs no tier and sends nothing', async () => {
        const { service, chain, queue } = setup();

        await service.propose(COOK, CALLER, JOB);
        chain.lexical.mockClear();
        queue.enqueue.mockClear();
        await service.propose(COOK, CALLER, JOB);

        expect(chain.lexical).not.toHaveBeenCalled();
        expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('re-matches a line whose text was EDITED, and asks about the new proposal', async () => {
        const lines = [makeParseJobLine()];
        const { service, chain, queue } = setup({ job: makeParseJobRecord({ lines }) });

        await service.propose(COOK, CALLER, JOB);
        lines.splice(0, 1, makeParseJobLine({ lineDigest: 'digest-edited' }));
        chain.lexical.mockClear();
        queue.enqueue.mockClear();
        await service.propose(COOK, CALLER, JOB);

        expect(chain.lexical).toHaveBeenCalledTimes(1);
        expect(queue.enqueue).toHaveBeenCalledTimes(1);
    });

    it('⛔ re-matches a line REPARSED with the same text into another food — the judgement moved', async () => {
        const lines = [makeParseJobLine()];
        const { service, chain, matches } = setup({ job: makeParseJobRecord({ lines }) });

        await service.propose(COOK, CALLER, JOB);
        // Same text, same digest; the parse now reads another food.
        lines.splice(0, 1, makeParseJobLine({ proposal: makeStoredProposal({ foods: [{ name: 'skim milk', prep: null }] }) }));
        chain.lexical.mockClear();
        await service.propose(COOK, CALLER, JOB);

        expect(chain.lexical).toHaveBeenCalledWith(expect.objectContaining({ phrase: 'skim milk' }), expect.anything());
        expect(matches.rows.size).toBe(1);
    });

    it('⛔ claims each review for the digest and key it was computed for, under the queue’s delivery bound', async () => {
        const { service, matches } = setup();
        const claim = vi.spyOn(matches, 'claimEnqueue');

        await service.propose(COOK, CALLER, JOB);

        expect(claim).toHaveBeenCalledWith(
            JOB,
            [
                {
                    lineIndex: 0,
                    foodIndex: 0,
                    lineDigest: lineDigest('2 cups whole milk', sha256Hex),
                    verificationKey: milkKey('F-whole'),
                },
            ],
            verificationDeliveryBoundSeconds(),
        );
    });

    it('⛔ sends again a review claimed longer ago than the delivery bound — the request was lost', async () => {
        const { service, matches, queue } = setup();

        await matches.saveMatches(JOB, [currentMilkRow()]);
        const [key, row] = [...matches.rows.entries()][0] ?? [];

        if (key === undefined || row === undefined) {
            throw new Error('no row');
        }

        matches.rows.set(key, {
            ...row,
            enqueuedAt: new Date(Date.now() - (verificationDeliveryBoundSeconds() + 60) * 1_000),
        });
        await service.propose(COOK, CALLER, JOB);

        expect(queue.enqueue).toHaveBeenCalledTimes(1);
    });

    it('sends nothing for a review claimed inside the delivery bound — it is still in flight', async () => {
        const { service, matches, queue } = setup();

        await matches.saveMatches(JOB, [currentMilkRow()]);
        const [key, row] = [...matches.rows.entries()][0] ?? [];

        if (key === undefined || row === undefined) {
            throw new Error('no row');
        }

        matches.rows.set(key, { ...row, enqueuedAt: new Date(Date.now() - 60_000) });
        await service.propose(COOK, CALLER, JOB);

        expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('⛔ asks NOTHING when a verdict for the proposal is already on record', async () => {
        const verdicts = fakeLineVerificationsDal(new Map([[milkKey('F-whole'), 'verified']]));
        const { service, matches, queue } = setup({ verdicts });

        await service.propose(COOK, CALLER, JOB);

        expect(queue.enqueue).not.toHaveBeenCalled();
        expect([...matches.rows.values()][0]?.enqueuedAt).toBeNull();
    });

    it('⛔ releases the claim when the send fails, so the next call sends it — and the request still succeeds', async () => {
        const { service, matches, queue } = setup();

        queue.enqueue.mockRejectedValueOnce(new Error('SQS down'));
        await service.propose(COOK, CALLER, JOB);

        expect([...matches.rows.values()][0]?.enqueuedAt).toBeNull();

        await service.propose(COOK, CALLER, JOB);

        expect(queue.enqueue).toHaveBeenCalledTimes(2);
        expect([...matches.rows.values()][0]?.enqueuedAt).not.toBeNull();
    });
});

describe('MatchProposalService.propose — ADR-0040 containment', () => {
    it('⛔ stores a TEST principal’s proposals on an enforcing stage, but sends the review gate nothing', async () => {
        // The review spends ADR-0024's shared production pool, which a test principal is contained from, exactly as
        // the save path's verification producer is. The proposals are the cook's own rows.
        const { service, matches, queue } = setup();

        await service.propose({ ...COOK, principalKind: 'test', containment: 'enforce' }, CALLER, JOB);

        expect(matches.rows.size).toBe(1);
        expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('still sends for a test principal on a stage that does not contain', async () => {
        const { service, queue } = setup();

        await service.propose({ ...COOK, principalKind: 'test', containment: 'off' }, CALLER, JOB);

        expect(queue.enqueue).toHaveBeenCalledTimes(1);
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

        await service.propose(COOK, CALLER, JOB);

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

        await service.propose(COOK, CALLER, JOB);

        expect(matches.rows.size).toBe(5);
    });
});
