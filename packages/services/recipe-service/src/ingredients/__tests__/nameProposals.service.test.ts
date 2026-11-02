/**
 * Unit tests for `NameProposalsService` — what the editor's add-by-name field is OFFERED for a typed phrase.
 *
 * The owner's rulings (2026-11-03, after devil's advocate M2) are the spec: the cook's own correction, a staff ruling,
 * two cooks agreeing and a memo another cook's save taught all PROPOSE and never bind. So the properties under test are:
 *
 *  - It binds nothing. The service is built from two collaborators, the settled tiers and the refs reader, and neither
 *    can write; a mutant that grew a write would need a third collaborator and fail the construction below.
 *  - Names come from food, as the caller, at read time (ADR-0045). A food food refuses, hides, or cannot answer about is
 *    DROPPED, never reported: the answer is always a list, so a missing proposal cannot be told from a concealed food.
 *  - One tier failing costs its own proposals only; the route never answers `5xx` for a read that has a fallback (the
 *    typeahead list under the field still works).
 *  - The caller reaches the tiers and the refs reader unchanged.
 */
import { describe, expect, it, vi } from 'vitest';

import type { FoodRef } from '../../database/schema/foodLookupArm.js';
import type { FoodRefAnswer } from '../domain/foodRefAnswer.js';
import type { FoodRefsGateway } from '../foodRefs.gateway.js';
import { NameProposalsService } from '../nameProposals.service.js';
import type { ResolutionTier, TierOutcome } from '../resolution/resolutionCascade.js';
import { CALLER_TOKEN as CALLER, makeCanonicalName } from '../__fixtures__/ingredients.fixtures.js';

const USER = '01JU10PROPOSE00000000000COOK';
const NAME = makeCanonicalName('milk');

const found = (
    rootId: string,
    name: string,
    extra: Partial<Extract<FoodRefAnswer, { outcome: 'found' }>> = {},
): FoodRefAnswer => ({
    outcome: 'found',
    name: makeCanonicalName(name),
    status: 'RESOLVED',
    isPrivate: false,
    rootId,
    ...extra,
});

const curatedTier = (
    food: FoodRef,
    mapping: { scope: 'author' | 'global'; origin: 'author' | 'curator' | 'corroboration' },
): ResolutionTier => ({
    id: 'curated',
    resolve: vi.fn(async (): Promise<TierOutcome> => ({
        kind: 'resolved',
        tier: 'curated',
        food,
        evidence: 'curated',
        mapping,
    })),
});

const memoTier = (food: FoodRef): ResolutionTier => ({
    id: 'memo',
    resolve: vi.fn(async (): Promise<TierOutcome> => ({
        kind: 'resolved',
        tier: 'memo',
        food,
        evidence: 'memo exact match',
    })),
});

const passingTier = (id: 'curated' | 'memo'): ResolutionTier => ({
    id,
    resolve: async (): Promise<TierOutcome> => ({ kind: 'pass', tier: id, reason: 'nothing' }),
});

function refsAnswering(answers: Readonly<Record<string, FoodRefAnswer>>): Pick<FoodRefsGateway, 'resolveForBind'> {
    return {
        resolveForBind: vi.fn(async (_caller, ref: FoodRef) => answers[ref.id] ?? { outcome: 'absent' as const }),
    };
}

describe('NameProposalsService.propose', () => {
    it('offers each settled source as a proposal, named by food, strongest source first', async () => {
        const service = new NameProposalsService(
            [
                curatedTier({ kind: 'root', id: 'FOOD-OWN' }, { scope: 'author', origin: 'author' }),
                memoTier({ kind: 'root', id: 'FOOD-MEMO' }),
            ],
            refsAnswering({
                'FOOD-OWN': found('FOOD-OWN', 'Whole milk'),
                'FOOD-MEMO': found('FOOD-MEMO', 'Skim milk'),
            }),
        );

        await expect(service.propose(CALLER, NAME, USER)).resolves.toStrictEqual({
            phrase: 'milk',
            proposals: [
                { kind: 'root', id: 'FOOD-OWN', name: 'Whole milk', source: 'ownCorrection' },
                { kind: 'root', id: 'FOOD-MEMO', name: 'Skim milk', source: 'remembered' },
            ],
        });
    });

    it('does NOT stop at the first source: the memo is offered even when a ruling also answered', async () => {
        const memo = memoTier({ kind: 'root', id: 'FOOD-MEMO' });
        const service = new NameProposalsService(
            [curatedTier({ kind: 'root', id: 'FOOD-RULED' }, { scope: 'global', origin: 'curator' }), memo],
            refsAnswering({
                'FOOD-RULED': found('FOOD-RULED', 'Whole milk'),
                'FOOD-MEMO': found('FOOD-MEMO', 'Skim milk'),
            }),
        );

        const answer = await service.propose(CALLER, NAME, USER);

        expect(memo.resolve).toHaveBeenCalledTimes(1);
        expect(answer.proposals.map((proposal) => proposal.source)).toStrictEqual(['staffRuling', 'remembered']);
    });

    it('names a variant by its live end, as food answered', async () => {
        const service = new NameProposalsService(
            [memoTier({ kind: 'variant', id: 'VAR-OLD' })],
            refsAnswering({
                'VAR-OLD': found('ROOT-1', 'Whole milk, organic', { variant: { id: 'VAR-LIVE', parts: [] } as never }),
            }),
        );

        const answer = await service.propose(CALLER, NAME, USER);

        expect(answer.proposals).toStrictEqual([
            { kind: 'variant', id: 'VAR-LIVE', name: 'Whole milk, organic', source: 'remembered' },
        ]);
    });

    it('drops a food food no longer shows, will not name, or cannot answer about, and answers 200 with the rest', async () => {
        const service = new NameProposalsService(
            [
                curatedTier({ kind: 'root', id: 'GONE' }, { scope: 'author', origin: 'author' }),
                memoTier({ kind: 'root', id: 'KEPT' }),
            ],
            refsAnswering({ KEPT: found('KEPT', 'Whole milk') }),
        );

        const answer = await service.propose(CALLER, NAME, USER);

        expect(answer.proposals.map((proposal) => proposal.id)).toStrictEqual(['KEPT']);
    });

    it.each([
        ['an unresolved food', found('F', 'Milk', { status: 'PENDING' })],
        ['a food with no usable name', found('F', 'Milk', { name: undefined })],
        ['an unreachable food service', { outcome: 'unreachable' } as FoodRefAnswer],
        ['a private food shown to nobody in particular', found('F', 'My milk', { isPrivate: true })],
    ])('answers an empty list, not an error, for %s when there is no caller to own it', async (_label, answer) => {
        const service = new NameProposalsService([memoTier({ kind: 'root', id: 'F' })], refsAnswering({ F: answer }));

        await expect(service.propose(CALLER, NAME, undefined)).resolves.toStrictEqual({
            phrase: 'milk',
            proposals: [],
        });
    });

    it('offers the caller their OWN private food, and asks food as the caller', async () => {
        const refs = refsAnswering({ MINE: found('MINE', 'My milk', { isPrivate: true }) });
        const service = new NameProposalsService(
            [curatedTier({ kind: 'root', id: 'MINE' }, { scope: 'author', origin: 'author' })],
            refs,
        );

        const answer = await service.propose(CALLER, NAME, USER);

        expect(answer.proposals).toStrictEqual([
            { kind: 'root', id: 'MINE', name: 'My milk', source: 'ownCorrection' },
        ]);
        expect(refs.resolveForBind).toHaveBeenCalledWith(CALLER, { kind: 'root', id: 'MINE' });
    });

    it('survives a tier whose read failed: its proposals are missing, the others still come', async () => {
        const broken: ResolutionTier = {
            id: 'curated',
            resolve: async () => {
                throw new Error('database down');
            },
        };
        const service = new NameProposalsService(
            [broken, memoTier({ kind: 'root', id: 'KEPT' })],
            refsAnswering({ KEPT: found('KEPT', 'Whole milk') }),
        );

        const answer = await service.propose(CALLER, NAME, USER);

        expect(answer.proposals.map((proposal) => proposal.source)).toStrictEqual(['remembered']);
    });

    it('answers an empty list when nothing is remembered', async () => {
        const service = new NameProposalsService([passingTier('curated'), passingTier('memo')], refsAnswering({}));

        await expect(service.propose(CALLER, NAME, USER)).resolves.toStrictEqual({ phrase: 'milk', proposals: [] });
    });

    it("hands the tiers the typed phrase and the caller, so a cook sees their own corrections and nobody else's", async () => {
        const curated = curatedTier({ kind: 'root', id: 'F' }, { scope: 'author', origin: 'author' });
        const service = new NameProposalsService([curated], refsAnswering({ F: found('F', 'Milk') }));

        await service.propose(CALLER, NAME, USER);

        expect(curated.resolve).toHaveBeenCalledWith(
            expect.objectContaining({ phrase: 'milk' }),
            expect.objectContaining({ userId: USER, caller: CALLER }),
        );
    });
});
