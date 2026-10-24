/**
 * `failureOutcome` — why a lookup failed, and what a later attempt may overwrite (plan 002 R1 to R3, R11).
 *
 * The reason table is the contract the `unresolved_foods` CHECKs pin in SQL: a pending reason carries food's
 * handle and a settled one never does, and the generated `status` follows the reason. The merge rule is R2 in
 * code: "we could not look" must never overwrite "we looked and found nothing".
 */
import { describe, expect, it } from 'vitest';

import type { FailureFacts } from '../../../database/schema/foodLookupArm.js';
import { declaredFailure, failureOf, mergeAttempt, type FoodAddAnswer, type NewFailure } from '../failureOutcome.js';

const base = { name: 'nutritional yeast', normalizedKey: 'nutritional yeast', sourcePhrase: null } as const;
const exhausted = { kind: 'exhausted', consulted: ['curated', 'memo'], unavailable: [] } as const;

function outcome(food: FoodAddAnswer, cascade: Parameters<typeof failureOf>[0]['cascade'] = exhausted): NewFailure {
    return failureOf({ ...base, cascade, food });
}

describe('failureOf — the reason table', () => {
    it('maps each of food’s answers to its reason, carrying the handle only while food is still working', () => {
        const rows: readonly (readonly [FoodAddAnswer, string, string | null])[] = [
            [{ kind: 'answered', foodId: 'f1', status: 'PENDING' }, 'awaiting_source', 'f1'],
            [{ kind: 'answered', foodId: 'f1', status: 'AWAITING_RETRY' }, 'awaiting_source', 'f1'],
            [{ kind: 'answered', foodId: 'f1', status: 'UNRESOLVED' }, 'several_candidates', 'f1'],
            [{ kind: 'answered', foodId: 'f1', status: 'NOT_FOUND' }, 'no_source_has_it', null],
            [{ kind: 'answered', foodId: 'f1', status: 'WITHDRAWN' }, 'no_source_has_it', null],
            [{ kind: 'answered', foodId: 'f1', status: 'FAILED' }, 'sources_errored', null],
            [{ kind: 'unreachable', detail: 'FoodServiceUnavailableError 503' }, 'sources_errored', null],
        ];

        for (const [food, reason, handle] of rows) {
            const failure = outcome(food);

            expect({ reason: failure.reasonCode, handle: failure.foodHandleId }, JSON.stringify(food)).toStrictEqual({
                reason,
                handle,
            });
        }
    });

    it('records the tiers the cascade consulted and found unavailable, whatever food said (R3)', () => {
        const failure = outcome(
            { kind: 'answered', foodId: 'f1', status: 'NOT_FOUND' },
            { kind: 'exhausted', consulted: ['curated', 'memo', 'lexical'], unavailable: ['memo'] },
        );

        expect([failure.tiersConsulted, failure.tiersUnavailable]).toStrictEqual([
            ['curated', 'memo', 'lexical'],
            ['memo'],
        ]);
    });

    it('when food was not asked, says whether the cascade could look (R2)', () => {
        expect(outcome({ kind: 'notAsked' }).reasonCode).toBe('cascade_exhausted');
        expect(
            outcome(
                { kind: 'notAsked' },
                { kind: 'exhausted', consulted: ['curated', 'lexical'], unavailable: ['lexical'] },
            ).reasonCode,
        ).toBe('cascade_unavailable');
        expect(outcome({ kind: 'notAsked' }, { kind: 'notRun' }).reasonCode).toBe('cascade_exhausted');
    });

    it('keeps an unreachable food service’s detail for operators, and no other reason carries one', () => {
        expect(outcome({ kind: 'unreachable', detail: 'timeout after 8000ms' }).detail).toBe('timeout after 8000ms');
        expect(outcome({ kind: 'answered', foodId: 'f1', status: 'NOT_FOUND' }).detail).toBeNull();
    });

    it('bounds the operator detail to what the column holds', () => {
        expect(outcome({ kind: 'unreachable', detail: 'x'.repeat(900) }).detail?.length).toBe(500);
    });
});

describe('declaredFailure', () => {
    it('is the cook’s own name, with no handle and no tiers', () => {
        expect(declaredFailure('grandma’s spice mix', 'grandma’s spice mix')).toStrictEqual({
            name: 'grandma’s spice mix',
            normalizedKey: 'grandma’s spice mix',
            sourcePhrase: null,
            reasonCode: 'author_declared',
            foodHandleId: null,
            tiersConsulted: [],
            tiersUnavailable: [],
            detail: null,
        });
    });
});

describe('mergeAttempt — R2 in code', () => {
    function existing(reasonCode: FailureFacts['reasonCode'], foodHandleId: string | null = null): FailureFacts {
        return {
            unresolvedFoodId: 'failure-1',
            name: 'nutritional yeast',
            normalizedKey: 'nutritional yeast',
            reasonCode,
            status: 'NOT_FOUND',
            foodHandleId,
            tiersConsulted: [],
            tiersUnavailable: [],
            attempts: 2,
            settledLookupId: null,
        };
    }

    const transient = outcome({ kind: 'unreachable', detail: 'down' });
    const informative = outcome({ kind: 'answered', foodId: 'f1', status: 'NOT_FOUND' });

    it('⛔ a transient outcome only counts the attempt; it never overwrites what is known', () => {
        expect(mergeAttempt(existing('no_source_has_it'), transient)).toStrictEqual({ kind: 'countAttempt' });
        expect(mergeAttempt(existing('awaiting_source', 'f9'), transient)).toStrictEqual({ kind: 'countAttempt' });
    });

    it('an informative outcome replaces a transient one, and a newer informative one replaces an older', () => {
        expect(mergeAttempt(existing('sources_errored'), informative)).toStrictEqual({
            kind: 'replace',
            failure: informative,
        });
        expect(mergeAttempt(existing('awaiting_source', 'f9'), informative)).toStrictEqual({
            kind: 'replace',
            failure: informative,
        });
    });

    it('a transient outcome replaces a transient one, so the latest outage is the one recorded', () => {
        expect(mergeAttempt(existing('sources_errored'), transient)).toStrictEqual({
            kind: 'replace',
            failure: transient,
        });
    });

    it('⛔ a declaration is never merged — it does not converge, so nothing retries it', () => {
        expect(mergeAttempt(existing('author_declared'), informative)).toStrictEqual({ kind: 'countAttempt' });
    });
});
