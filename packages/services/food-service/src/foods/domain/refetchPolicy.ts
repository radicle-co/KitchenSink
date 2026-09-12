/**
 * Which foods an operator's refetch (`POST /api/v1/foods/{id}/refetch`, FR-039) may queue for a fetch. The refetch
 * refuses by this rule, and the requeue's `409` reads it before it names the refetch route, so the requeue never sends
 * an operator to a route that refuses them.
 *
 * @pattern Specification — the sibling of `authorshipPolicy.ts`: one question, answered from the food's facts alone
 * @module
 */
import type { FoodStatus } from '../dao/food.dao.js';

/** The facts the decision reads. */
export interface RefetchFacts {
    readonly status: FoodStatus;
    /** Whether the seed owns the food's item: the seed is then its one writer (KTD-12). */
    readonly seedOwned: boolean;
}

/** Why a refetch is refused: the food is mid-erasure, its author withdrew it (ADR-0038), or the seed owns it. */
export type RefetchRefusal = 'deleting' | 'withdrawn' | 'seedOwned';

const REASONS: Readonly<Record<RefetchRefusal, string>> = {
    deleting: 'it is being deleted',
    withdrawn: 'its author withdrew it',
    seedOwned: 'it belongs to the catalog seed, and only the seed changes it',
};

/**
 * The refusal a refetch of this food earns. Pure.
 *
 * @param food - The food's status and seed ownership.
 * @returns The refusal, or `undefined` when a refetch may queue the food.
 */
export function refetchRefusalOf(food: RefetchFacts): RefetchRefusal | undefined {
    if (food.status === 'DELETING') {
        return 'deleting';
    }

    if (food.status === 'WITHDRAWN') {
        return 'withdrawn';
    }

    return food.seedOwned ? 'seedOwned' : undefined;
}

/**
 * The operator-facing reason for a refusal, as a clause a message ends with. Pure.
 *
 * @param refusal - The refusal.
 * @returns The reason.
 */
export function refetchRefusalReason(refusal: RefetchRefusal): string {
    return REASONS[refusal];
}
