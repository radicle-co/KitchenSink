/**
 * `MatchProposalService.proposeForJobs` — matching several parse jobs in ONE bounded call, as the cook (ADR-0072 §2).
 *
 * A bulk import's `advance` matches the parsed lines of several recipes in one request, and the request has ONE budget. What
 * each case guards:
 *
 *  - **One deadline for the whole batch**, not one per job: a batch of five jobs must not be five requests' worth of work. The
 *    work that does not fit waits for the next `advance` and is reported as not complete.
 *  - **A job that cannot be matched does not fail the batch.** An expired or absent job (the TTL passed under an open wizard,
 *    or the import holds a job the caller does not own) is one entry in the answer, not a thrown error: the other jobs'
 *    matches are still wanted.
 *  - **`matchesComplete` is the importer's gate for taking a snapshot.** It is true only when every owed food of the job has a
 *    current match row, so a tier outage (which stores nothing, ADR-0071 rule 6) leaves the job incomplete rather than
 *    snapshotting a "no match" that was really an outage.
 *  - **`propose(jobId)` is unchanged**: it delegates, and still throws for a stranger's job and an expired one.
 */
import { describe, expect, it, vi } from 'vitest';

import { parseStoredLineDigest } from '@kitchensink/recipe-core/parsing/parse-key';

import { CallerToken } from '../../auth/CallerToken.js';
import { DeadlineExceededError } from '../../common/boundedBy.js';
import type { Principal } from '../../auth/principal.js';
import type { FoodRef } from '../../database/schema/foodLookupArm.js';
import type { FoodRefAnswer } from '../../ingredients/domain/foodRefAnswer.js';
import { canonicalIngredientName } from '../../ingredients/domain/ingredientName.js';
import type { FoodRefsGateway } from '../../ingredients/foodRefs.gateway.js';
import type { RankedCandidate, ResolutionTier } from '../../ingredients/resolution/resolutionCascade.js';
import { fakeLineVerificationsDal } from '../__fixtures__/lineVerificationsDal.fixture.js';
import { inMemoryParseJobMatches, makeParseJobRecord } from '../__fixtures__/parseJobMatches.fixture.js';
import { fakeVerificationQueue } from '../__fixtures__/verificationQueue.fixture.js';
import { DEFAULT_MATCH_PROPOSAL_LIMITS, MatchProposalService } from '../matchProposal.service.js';
import type { ParseJobRecord } from '../parseJobs.service.js';
import { isRecipeDomainError } from '../recipe.error.js';

const OWNER = '01JMATCHFORJOBSOWNER00001';
const STRANGER = '01JMATCHFORJOBSSTRANGER001';
const CALLER = CallerToken.fromAuthorizationHeader('Bearer cook-token');
const COOK: Principal = {
    userId: OWNER,
    sub: 'clerk_owner',
    scopes: [],
    permissions: [],
    roles: [],
    principalKind: 'real',
    containment: 'enforce',
};
const JOB_A = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3d0001';
const JOB_B = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3d0002';
const JOB_C = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3d0003';

const MILK: readonly RankedCandidate[] = [{ food: { kind: 'root', id: 'F-whole' }, rung: 'head' }];

const named = (name: string, rootId: string): FoodRefAnswer => ({
    outcome: 'found',
    name: canonicalIngredientName(name),
    status: 'RESOLVED',
    isPrivate: false,
    rootId,
});

interface World {
    readonly jobs: readonly (ParseJobRecord | undefined)[];
    readonly lexical?: 'unavailable' | readonly RankedCandidate[];
    readonly owner?: string;
    readonly now?: () => number;
    /** Called on each catalog search, so a case can move its fake clock the way a slow search would. */
    readonly onSearch?: () => void;
    readonly concurrency?: number;
    /** The catalog blend's switch (rule 4). On unless a case turns it off. */
    readonly catalogEnabled?: boolean;
}

function setup(world: World) {
    const records = new Map(world.jobs.flatMap((job) => (job === undefined ? [] : [[job.id, job] as const])));
    const owners = new Map([...records.keys()].map((id) => [id, world.owner ?? OWNER] as const));
    const matches = inMemoryParseJobMatches(owners, (jobId, lineIndex) => {
        const line = records.get(jobId)?.lines.find((candidate) => candidate.lineIndex === lineIndex);

        return line === undefined ? undefined : parseStoredLineDigest(line.lineDigest);
    });
    const lexical = vi.fn(async (_query?: unknown, _context?: unknown) => {
        world.onSearch?.();

        if (world.lexical === 'unavailable') {
            throw new Error('catalog unavailable');
        }

        const ranked = world.lexical ?? MILK;
        const [top] = ranked;

        return top === undefined
            ? ({ kind: 'pass', tier: 'lexical', reason: 'none' } as const)
            : ({
                  kind: 'resolved',
                  tier: 'lexical',
                  food: top.food,
                  evidence: 'lexical',
                  rung: top.rung,
                  confidence: 0.2,
                  candidates: [...ranked],
              } as const);
    });
    const tiers: readonly ResolutionTier[] = [{ id: 'lexical', resolve: lexical }];
    const resolve = vi.fn(async (_caller: unknown, refs: readonly FoodRef[]) => ({
        answers: new Map(refs.map((ref) => [`${ref.kind}:${ref.id}`, named('Milk, whole', ref.id)] as const)),
        degraded: false,
    }));
    const getJob = vi.fn(async (ownerId: string, jobId: string) =>
        ownerId === OWNER ? records.get(jobId) : undefined,
    );
    const queue = fakeVerificationQueue();
    const service = new MatchProposalService(
        { getJob },
        matches,
        tiers,
        { enabled: world.catalogEnabled ?? true, searchTimeoutMs: () => 600 },
        { resolve } as unknown as FoodRefsGateway,
        queue,
        fakeLineVerificationsDal(),
        {
            ...DEFAULT_MATCH_PROPOSAL_LIMITS,
            ...(world.now === undefined ? {} : { now: world.now }),
            ...(world.concurrency === undefined ? {} : { concurrency: world.concurrency }),
        },
        vi.fn(),
    );

    return { service, matches, lexical, resolve, getJob, queue };
}

const job = (id: string, overrides: Partial<ParseJobRecord> = {}) => makeParseJobRecord({ id, ...overrides });

describe('MatchProposalService.proposeForJobs', () => {
    it('matches every owed food of every job and says each job is complete', async () => {
        const { service, matches } = setup({ jobs: [job(JOB_A), job(JOB_B)] });

        const results = await service.proposeForJobs(COOK, CALLER, [JOB_A, JOB_B]);

        expect(
            results.map((result) => [result.jobId, result.kind, result.kind === 'ok' && result.matchesComplete]),
        ).toEqual([
            [JOB_A, 'ok', true],
            [JOB_B, 'ok', true],
        ]);
        expect([...matches.rows.values()].map((row) => row.jobId).sort()).toEqual([JOB_A, JOB_B]);
    });

    it('returns the job as it read it, so the caller needs no second read', async () => {
        const a = job(JOB_A);
        const { service } = setup({ jobs: [a] });
        const [result] = await service.proposeForJobs(COOK, CALLER, [JOB_A]);

        expect(result).toMatchObject({ kind: 'ok', record: a });
    });

    it('⛔ shares ONE batched food read across the jobs (one request for the whole batch)', async () => {
        const { service, resolve } = setup({ jobs: [job(JOB_A), job(JOB_B), job(JOB_C)] });

        await service.proposeForJobs(COOK, CALLER, [JOB_A, JOB_B, JOB_C]);

        expect(resolve).toHaveBeenCalledTimes(1);
    });

    describe('a job that cannot be matched does not fail the batch', () => {
        it('reports an expired job and still matches the rest', async () => {
            const expired = job(JOB_A, { expiresAt: new Date(Date.now() - 1_000) });
            const { service, matches } = setup({ jobs: [expired, job(JOB_B)] });

            const results = await service.proposeForJobs(COOK, CALLER, [JOB_A, JOB_B]);

            expect(results.map((result) => [result.jobId, result.kind])).toEqual([
                [JOB_A, 'expired'],
                [JOB_B, 'ok'],
            ]);
            expect([...matches.rows.values()].every((row) => row.jobId === JOB_B)).toBe(true);
        });

        it('reports an absent job, and a stranger’s job, the same way (one answer)', async () => {
            const { service } = setup({ jobs: [job(JOB_A), undefined] });
            const results = await service.proposeForJobs(COOK, CALLER, [JOB_A, JOB_B]);

            expect(results.map((result) => result.kind)).toEqual(['ok', 'missing']);

            const strangers = setup({ jobs: [job(JOB_A)] });

            expect(
                (await strangers.service.proposeForJobs({ ...COOK, userId: STRANGER }, CALLER, [JOB_A])).map(
                    (result) => result.kind,
                ),
            ).toEqual(['missing']);
        });
    });

    describe('matchesComplete is true only when every owed food has a stored match', () => {
        it('⛔ is false when a tier could not look, and nothing is stored (an outage is not a "no match")', async () => {
            const { service, matches } = setup({ jobs: [job(JOB_A)], lexical: 'unavailable' });
            const [result] = await service.proposeForJobs(COOK, CALLER, [JOB_A]);

            expect(result).toMatchObject({ kind: 'ok', matchesComplete: false });
            expect(matches.rows.size).toBe(0);
        });

        it('is true for a job with nothing owed (every food already has its match)', async () => {
            const { service, lexical } = setup({ jobs: [job(JOB_A)] });

            await service.proposeForJobs(COOK, CALLER, [JOB_A]);
            lexical.mockClear();

            const [again] = await service.proposeForJobs(COOK, CALLER, [JOB_A]);

            expect(again).toMatchObject({ kind: 'ok', matchesComplete: true });
            expect(lexical).not.toHaveBeenCalled();
        });

        // Review finding 2 on #185-#188: `owed` started as an empty list, so a job whose owed foods were never counted read as
        // "nothing owed" and so as complete, and the importer would snapshot a review with no matches in it.
        it('⛔ is false when the catalog is switched off, because nothing was matched (rule 4)', async () => {
            const { service, matches } = setup({ jobs: [job(JOB_A)], catalogEnabled: false });
            const [result] = await service.proposeForJobs(COOK, CALLER, [JOB_A]);

            expect(result).toMatchObject({ kind: 'ok', matchesComplete: false });
            expect(matches.rows.size).toBe(0);
        });

        it('⛔ is false for a job whose owed foods were never counted because the deadline passed first', async () => {
            const { service, matches } = setup({ jobs: [job(JOB_A), job(JOB_B)] });
            const read = matches.findForJob.bind(matches);

            vi.spyOn(matches, 'findForJob').mockImplementation(async (ownerId, jobId) => {
                if (jobId === JOB_B) {
                    throw new DeadlineExceededError();
                }

                return read(ownerId, jobId);
            });

            const results = await service.proposeForJobs(COOK, CALLER, [JOB_A, JOB_B]);

            expect(results.map((result) => [result.jobId, result.kind === 'ok' && result.matchesComplete])).toEqual([
                [JOB_A, false],
                [JOB_B, false],
            ]);
        });

        it('is true for a job with no parsed line yet (nothing is owed until a line lands)', async () => {
            const pending = job(JOB_A, {
                status: 'running',
                lines: [{ ...makeParseJobRecord().lines[0]!, status: 'pending', proposal: null }],
            });
            const { service } = setup({ jobs: [pending] });
            const [result] = await service.proposeForJobs(COOK, CALLER, [JOB_A]);

            expect(result).toMatchObject({ kind: 'ok', matchesComplete: true });
        });
    });

    describe('one deadline for the whole batch', () => {
        it('⛔ starts no wave once the batch has no time left, and reports the unmatched jobs incomplete', async () => {
            // The first search is slow: it moves the fake clock past the point where another wave could still finish.
            let clock = Date.now();
            const { service, lexical } = setup({
                jobs: [job(JOB_A), job(JOB_B), job(JOB_C)],
                concurrency: 1,
                now: () => clock,
                onSearch: () => {
                    clock += 2_000;
                },
            });

            const results = await service.proposeForJobs(COOK, CALLER, [JOB_A, JOB_B, JOB_C]);

            expect(lexical).toHaveBeenCalledTimes(1);
            expect(results.map((result) => result.kind === 'ok' && result.matchesComplete)).toEqual([
                true,
                false,
                false,
            ]);
        });
    });

    describe('propose(jobId) still delegates', () => {
        it('returns the job record', async () => {
            const a = job(JOB_A);
            const { service } = setup({ jobs: [a] });

            await expect(service.propose(COOK, CALLER, JOB_A)).resolves.toBe(a);
        });

        it('⛔ still throws PARSE_JOB_NOT_FOUND for an absent job and PARSE_JOB_EXPIRED for an expired one', async () => {
            const { service } = setup({ jobs: [job(JOB_A, { expiresAt: new Date(Date.now() - 1_000) })] });

            await expect(service.propose(COOK, CALLER, JOB_A)).rejects.toSatisfy(
                (error) => isRecipeDomainError(error) && error.code === 'PARSE_JOB_EXPIRED',
            );
            await expect(service.propose(COOK, CALLER, JOB_B)).rejects.toSatisfy(
                (error) => isRecipeDomainError(error) && error.code === 'PARSE_JOB_NOT_FOUND',
            );
        });
    });
});
