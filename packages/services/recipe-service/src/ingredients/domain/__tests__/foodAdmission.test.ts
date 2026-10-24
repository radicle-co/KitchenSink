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
import { admittedRefOf, admitResolvedRef, isAdmission, resolvedHandleOf } from '../foodAdmission.js';

const NAME = canonicalIngredientName('beef brisket');

function found(overrides: Partial<Extract<FoodRefAnswer, { outcome: 'found' }>> = {}): FoodRefAnswer {
    return { outcome: 'found', name: NAME, status: 'RESOLVED', isPrivate: false, rootId: 'food-1', ...overrides };
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
        const admission = admitResolvedRef(found(), 'user-1');

        expect(isAdmission(admission)).toBe(true);
        expect(
            isAdmission(admission) && {
                ref: admittedRefOf(admission),
                food: admission.food,
                name: admission.name,
                ownerId: admission.ownerId,
            },
        ).toStrictEqual({
            ref: { kind: 'root', id: 'food-1' },
            food: { rootId: 'food-1' },
            name: 'beef brisket',
            ownerId: null,
        });
    });

    it('⛔ binds the LIVE end of food’s forward: a food forwarded to another root binds that root (curated U9)', () => {
        const admission = admitResolvedRef(found({ rootId: 'food-2' }), 'user-1');

        expect(isAdmission(admission) && admittedRefOf(admission)).toStrictEqual({ kind: 'root', id: 'food-2' });
    });

    it('admits a variant — asked as one, or reached by a forward — as the VARIANT, under its root (curated U9)', () => {
        const flat = { id: 'V-flat', parts: [{ attribute: 'cut', text: 'flat' }] };
        const admission = admitResolvedRef(found({ rootId: 'R-brisket', variant: flat }), 'user-1');

        expect(
            isAdmission(admission) && { ref: admittedRefOf(admission), food: admission.food, owner: admission.ownerId },
        ).toStrictEqual({
            ref: { kind: 'variant', id: 'V-flat' },
            food: { rootId: 'R-brisket', variant: flat },
            owner: null,
        });
    });

    it('⛔ refuses a variant food calls private — only a root can be a cook’s own (food_lookups_owner_needs_a_root)', () => {
        const flat = { id: 'V-flat', parts: [{ attribute: 'cut', text: 'flat' }] };

        expect(isAdmission(admitResolvedRef(found({ rootId: 'R', variant: flat, isPrivate: true }), 'user-1'))).toBe(
            false,
        );
    });

    it('admits a private food with the CALLER as its owner — the resolver only shows it to its author', () => {
        const admission = admitResolvedRef(found({ isPrivate: true }), 'user-1');

        expect(isAdmission(admission) && admission.ownerId).toBe('user-1');
    });

    it('⛔ refuses a private food when there is no caller to record as its owner', () => {
        expect(isAdmission(admitResolvedRef(found({ isPrivate: true }), undefined))).toBe(false);
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
            expect(isAdmission(admitResolvedRef(answer, 'user-1')), JSON.stringify(answer)).toBe(false);
        }
    });
});

describe('resolvedHandleOf — only a food-service fact about THIS failure frees it', () => {
    it('frees a pending failure when food answers RESOLVED about the failure’s own handle', () => {
        const handle = resolvedHandleOf(pendingFailure(), {
            kind: 'handle',
            foodId: 'food-9',
            answer: found({ rootId: 'food-9' }),
        });

        expect(handle?.unresolvedFoodId).toBe('failure-1');
        expect(handle === undefined ? undefined : admittedRefOf(handle.admission)).toStrictEqual({
            kind: 'root',
            id: 'food-9',
        });
    });

    it('frees a failure when food resolved the failure’s own phrase', () => {
        const arm = pendingFailure({ reasonCode: 'no_source_has_it', status: 'NOT_FOUND', foodHandleId: null });

        const handle = resolvedHandleOf(arm, {
            kind: 'name',
            normalizedKey: 'beef brisket',
            foodId: 'food-3',
            answer: found({ rootId: 'food-3' }),
        });

        expect(handle === undefined ? undefined : admittedRefOf(handle.admission).id).toBe('food-3');
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
