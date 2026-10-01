/**
 * `foodAdmission` — the policy that decides whether a food may be BOUND to a recipe line (plan 002 R51, R13).
 *
 * Two proofs come out of it, and the rest of the service cannot build either one any other way:
 *  - a `FoodAdmission`, which the repository requires before it writes a bound lookup, so a bind that
 *    skipped the food-service check does not type-check (R51: verify before binding);
 *  - a `ResolvedHandle`, which the repository requires before it moves every line off a SHARED failure
 *    record, so only a food-service fact about that failure can free it — never one cook's personal cascade
 *    (R13, R20).
 */
import { describe, expect, it } from 'vitest';

import type { UnresolvedArm } from '../../../database/schema/foodLookupArm.js';
import { canonicalIngredientName } from '../ingredientName.js';
import type { FoodRefAnswer } from '../foodRefAnswer.js';
import { admitAuthoredFood, admitResolvedRef, isAdmission, openHandleOf, resolvedHandleOf } from '../foodAdmission.js';

const NAME = canonicalIngredientName('beef brisket');

function found(overrides: Partial<Extract<FoodRefAnswer, { outcome: 'found' }>> = {}): FoodRefAnswer {
    return { outcome: 'found', name: NAME, status: 'RESOLVED', isPrivate: false, ...overrides };
}

function pendingFailure(overrides: Partial<UnresolvedArm['failure']> = {}): UnresolvedArm {
    return {
        kind: 'unresolved',
        lookupId: 'lookup-1',
        createdAt: new Date('2026-09-30T00:00:00.000Z'),
        failure: {
            unresolvedFoodId: 'failure-1',
            name: 'beef brisket',
            normalizedKey: 'beef brisket',
            reasonCode: 'awaiting_source',
            status: 'PENDING',
            foodHandleId: 'food-9',
            tiersConsulted: [],
            tiersUnavailable: [],
            attempts: 1,
            settledLookupId: null,
            ...overrides,
        },
    };
}

describe('admitResolvedRef', () => {
    it('admits a resolved, named, shared food with no owner', () => {
        const admission = admitResolvedRef('food-1', found(), 'user-1');

        expect(isAdmission(admission)).toBe(true);
        expect(
            isAdmission(admission) && { foodId: admission.foodId, name: admission.name, ownerId: admission.ownerId },
        ).toStrictEqual({ foodId: 'food-1', name: 'beef brisket', ownerId: null });
    });

    it('admits a private food with the CALLER as its owner — the resolver only shows it to its author', () => {
        const admission = admitResolvedRef('food-1', found({ isPrivate: true }), 'user-1');

        expect(isAdmission(admission) && admission.ownerId).toBe('user-1');
    });

    it('⛔ refuses a private food when there is no caller to record as its owner', () => {
        expect(isAdmission(admitResolvedRef('food-1', found({ isPrivate: true }), undefined))).toBe(false);
    });

    it('⛔ refuses absent, unreachable, not-yet-resolved, withdrawn and nameless answers', () => {
        const refused: readonly FoodRefAnswer[] = [
            { outcome: 'absent' },
            { outcome: 'unreachable' },
            found({ status: 'PENDING' }),
            found({ status: 'WITHDRAWN' }),
            found({ name: undefined }),
        ];

        for (const answer of refused) {
            expect(isAdmission(admitResolvedRef('food-1', answer, 'user-1')), JSON.stringify(answer)).toBe(false);
        }
    });
});

describe('admitAuthoredFood — the forced fork (R13)', () => {
    it('admits the author’s new food with the author as owner', () => {
        const admission = admitAuthoredFood({ id: 'food-2', name: 'grandma’s spice mix' }, 'user-1');

        expect(isAdmission(admission) && { foodId: admission.foodId, ownerId: admission.ownerId }).toStrictEqual({
            foodId: 'food-2',
            ownerId: 'user-1',
        });
    });

    it('refuses a created food with no usable name', () => {
        expect(isAdmission(admitAuthoredFood({ id: 'food-2', name: '​' }, 'user-1'))).toBe(false);
    });
});

describe('openHandleOf — a failure’s pending food, while the failure is still open', () => {
    it.each([
        ['an open failure waiting on food', pendingFailure(), 'food-9'],
        [
            'an open failure with no handle',
            pendingFailure({ reasonCode: 'no_source_has_it', status: 'NOT_FOUND', foodHandleId: null }),
            undefined,
        ],
        ['a settled failure, which keeps its handle', pendingFailure({ settledLookupId: 'lookup-root' }), undefined],
        [
            'a declared name',
            pendingFailure({ reasonCode: 'author_declared', status: 'UNRESOLVED', foodHandleId: null }),
            undefined,
        ],
    ] as const)('%s', (_label, arm, expected) => {
        expect(openHandleOf(arm)).toBe(expected);
    });
});

describe('resolvedHandleOf — only a food-service fact about THIS failure frees it', () => {
    it('frees a pending failure when food answers RESOLVED about the failure’s own handle', () => {
        const handle = resolvedHandleOf(pendingFailure(), { kind: 'handle', foodId: 'food-9', answer: found() });

        expect(handle?.unresolvedFoodId).toBe('failure-1');
        expect(handle?.admission.foodId).toBe('food-9');
    });

    it('frees a failure when food resolved the failure’s own phrase', () => {
        const arm = pendingFailure({ reasonCode: 'no_source_has_it', status: 'NOT_FOUND', foodHandleId: null });

        expect(
            resolvedHandleOf(arm, { kind: 'name', normalizedKey: 'beef brisket', foodId: 'food-3', answer: found() })
                ?.admission.foodId,
        ).toBe('food-3');
    });

    it('⛔ refuses an answer about another food, another phrase, a private food, or an unresolved food', () => {
        expect(
            resolvedHandleOf(pendingFailure(), { kind: 'handle', foodId: 'food-8', answer: found() }),
        ).toBeUndefined();
        expect(
            resolvedHandleOf(pendingFailure(), {
                kind: 'name',
                normalizedKey: 'pork belly',
                foodId: 'food-3',
                answer: found(),
            }),
        ).toBeUndefined();
        expect(
            resolvedHandleOf(pendingFailure(), {
                kind: 'handle',
                foodId: 'food-9',
                answer: found({ isPrivate: true }),
            }),
        ).toBeUndefined();
        expect(
            resolvedHandleOf(pendingFailure(), {
                kind: 'handle',
                foodId: 'food-9',
                answer: found({ status: 'PENDING' }),
            }),
        ).toBeUndefined();
    });

    it('⛔ never frees a failure a settle already freed — a settle is final (plan 002 R13)', () => {
        const evidence = { kind: 'handle', foodId: 'food-9', answer: found() } as const;

        expect(resolvedHandleOf(pendingFailure({ settledLookupId: 'lookup-root' }), evidence)).toBeUndefined();
        // The positive control: the same failure and answer, not yet settled, is freed.
        expect(resolvedHandleOf(pendingFailure(), evidence)).toBeDefined();
    });

    it('⛔ never frees a cook’s DECLARED name — no source can adjudicate what they meant', () => {
        const declared = pendingFailure({ reasonCode: 'author_declared', status: 'UNRESOLVED', foodHandleId: null });

        expect(
            resolvedHandleOf(declared, {
                kind: 'name',
                normalizedKey: 'beef brisket',
                foodId: 'food-3',
                answer: found(),
            }),
        ).toBeUndefined();
    });
});
