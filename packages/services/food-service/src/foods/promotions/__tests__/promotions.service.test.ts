/**
 * U12 — `PromotionsService` orchestration: detection is a NEVER-THROWS enhancement on the authored
 * write path; approval elects over the STORED candidate set and emits the audit signal; every refusal
 * is a typed outcome rather than a 500.
 */
import { describe, expect, it, vi } from 'vitest';

import { PromotionsService } from '../promotions.service.js';
import type { PromotionsDao } from '../../dao/promotions.dao.js';
import type { WorkerLogger } from '../../../worker/workerLogger.js';

const NOW = '2026-08-31T12:00:00.000Z';

const CANDIDATE_A = {
    foodId: '01JU12FOOD00000000000000AA',
    userId: '01JU12AUTHOR000000000000AA',
    createdAt: '2026-08-01T00:00:00.000Z',
    authorFirstSeenAt: '2026-06-01T00:00:00.000Z',
    macros: { calories: 100, proteinG: 10, carbsG: 20, fatG: 5 },
};
const CANDIDATE_B = {
    ...CANDIDATE_A,
    foodId: '01JU12FOOD00000000000000BB',
    userId: '01JU12AUTHOR000000000000BB',
    createdAt: '2026-08-02T00:00:00.000Z',
};

const PENDING_ROW = {
    id: '00000000-0000-4000-8000-000000000001',
    normalizedName: 'quinoa blend',
    candidateFoodIds: [CANDIDATE_A.foodId, CANDIDATE_B.foodId],
    dataFingerprint: 'f'.repeat(64),
    status: 'pending' as const,
    canonicalFoodId: null,
    createdAt: '2026-08-30T00:00:00.000Z',
    decidedAt: null,
};

function makeService(overrides: Partial<Record<keyof PromotionsDao, ReturnType<typeof vi.fn>>> = {}): {
    service: PromotionsService;
    dao: Record<string, ReturnType<typeof vi.fn>>;
    logs: ReturnType<typeof vi.fn>;
} {
    const dao = {
        candidacyFacts: vi.fn().mockResolvedValue({
            candidates: [CANDIDATE_A, CANDIDATE_B],
            rejectedFingerprints: [],
            nameAlreadyClaimed: false,
        }),
        enqueueCandidacy: vi.fn().mockResolvedValue(true),
        pending: vi.fn().mockResolvedValue([PENDING_ROW]),
        findById: vi.fn().mockResolvedValue(PENDING_ROW),
        electionFacts: vi.fn().mockResolvedValue([
            { foodId: CANDIDATE_A.foodId, createdAt: CANDIDATE_A.createdAt },
            { foodId: CANDIDATE_B.foodId, createdAt: CANDIDATE_B.createdAt },
        ]),
        approve: vi.fn().mockResolvedValue(true),
        reject: vi.fn().mockResolvedValue(true),
        ...overrides,
    };
    const logs = vi.fn();
    const logger = { info: logs, warn: logs, error: logs } as unknown as WorkerLogger;

    return {
        service: new PromotionsService(dao as unknown as PromotionsDao, logger, () => new Date(NOW)),
        dao,
        logs,
    };
}

describe('detectCandidacy — the write-path hook', () => {
    it('enqueues when the policy triggers', async () => {
        const { service, dao } = makeService();

        await service.detectCandidacy('quinoa blend');

        expect(dao['enqueueCandidacy']).toHaveBeenCalledWith(
            expect.objectContaining({
                normalizedName: 'quinoa blend',
                candidateFoodIds: [CANDIDATE_A.foodId, CANDIDATE_B.foodId],
            }),
        );
    });

    it('enqueues nothing when the policy does not trigger', async () => {
        const { service, dao } = makeService({
            candidacyFacts: vi.fn().mockResolvedValue({
                candidates: [CANDIDATE_A],
                rejectedFingerprints: [],
                nameAlreadyClaimed: false,
            }),
        });

        await service.detectCandidacy('quinoa blend');

        expect(dao['enqueueCandidacy']).not.toHaveBeenCalled();
    });

    it('⛔ NEVER throws — a detection failure must not fail the authored write it rides on', async () => {
        const { service, logs } = makeService({
            candidacyFacts: vi.fn().mockRejectedValue(new Error('db down')),
        });

        await expect(service.detectCandidacy('quinoa blend')).resolves.toBeUndefined();
        expect(logs).toHaveBeenCalled();
    });
});

describe('approve — phase 1 + the audit signal', () => {
    it('elects the OLDEST stored candidate and commits phase 1 with it', async () => {
        const { service, dao } = makeService();

        const outcome = await service.approve(PENDING_ROW.id);

        expect(outcome).toEqual({
            outcome: 'approved',
            canonicalFoodId: CANDIDATE_A.foodId,
            normalizedName: 'quinoa blend',
        });
        expect(dao['approve']).toHaveBeenCalledWith(PENDING_ROW.id, CANDIDATE_A.foodId);
    });

    it('emits the promotion audit signal, naming the binding and the contributing foods', async () => {
        const { service, logs } = makeService();

        await service.approve(PENDING_ROW.id);

        expect(logs).toHaveBeenCalledWith(
            expect.stringContaining('promotion'),
            expect.objectContaining({
                promotionId: PENDING_ROW.id,
                canonicalFoodId: CANDIDATE_A.foodId,
                contributingFoodIds: PENDING_ROW.candidateFoodIds,
            }),
        );
    });

    it('answers not_found for an unknown id', async () => {
        const { service } = makeService({ findById: vi.fn().mockResolvedValue(undefined) });

        expect(await service.approve(PENDING_ROW.id)).toEqual({ outcome: 'not_found' });
    });

    it('answers not_pending for an already-decided row — a double-approve is not an error', async () => {
        const { service } = makeService({
            findById: vi.fn().mockResolvedValue({ ...PENDING_ROW, status: 'approved' }),
        });

        expect(await service.approve(PENDING_ROW.id)).toEqual({ outcome: 'not_pending' });
    });

    it('answers not_promotable when NO stored candidate is still a live private food', async () => {
        const { service, dao } = makeService({ electionFacts: vi.fn().mockResolvedValue([]) });

        expect(await service.approve(PENDING_ROW.id)).toEqual({ outcome: 'not_promotable' });
        expect(dao['approve']).not.toHaveBeenCalled();
    });

    it('answers not_pending when the DAO loses the double-decision race', async () => {
        const { service } = makeService({ approve: vi.fn().mockResolvedValue(false) });

        expect(await service.approve(PENDING_ROW.id)).toEqual({ outcome: 'not_pending' });
    });
});

describe('reject', () => {
    it('rejects a pending row', async () => {
        const { service } = makeService();

        expect(await service.reject(PENDING_ROW.id)).toEqual({ outcome: 'rejected' });
    });

    it('answers not_pending when the row was already decided', async () => {
        const { service } = makeService({ reject: vi.fn().mockResolvedValue(false) });

        expect(await service.reject(PENDING_ROW.id)).toEqual({ outcome: 'not_pending' });
    });
});
