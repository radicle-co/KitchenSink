/**
 * Why an ingredient lookup failed, and what a later attempt may overwrite (plan 002 R1 to R3, R11).
 *
 * Before 0051 the cascade worked the reason out and threw it away. This policy turns what the cascade and food
 * said into the one failure record `unresolved_foods` keeps, and the table's CHECKs pin the same shapes in SQL:
 * a pending reason carries food's handle and a settled one never does, and the stored `status` is generated
 * from the reason, so nothing here computes a status.
 *
 * ⛔ R2 is the merge rule: "we could not look" (a transient reason) never overwrites "we looked" (an
 * informative one), because the two lead to opposite actions and an outage must not become a permanent fact.
 *
 * @pattern Policy — a pure decision module in the ADR-0023 shape
 */
import type { FoodStatus } from '@kitchensink/food-service-client';
import type { UnresolvedFoodReasonCode } from '@kitchensink/recipe-core';

import type { FailureFacts } from '../../database/schema/foodLookupArm.js';
import type { CascadeTierId } from '../resolution/resolutionCascade.js';

/** The most operator detail a failure record keeps (the `unresolved_foods_detail_bounded` CHECK). */
const MAX_FAILURE_DETAIL_CHARS = 500;

/** A failure record to write. */
export interface NewFailure {
    readonly name: string;
    readonly normalizedKey: string;
    /** The raw phrase the name came from, when an import supplied one. */
    readonly sourcePhrase: string | null;
    readonly reasonCode: UnresolvedFoodReasonCode;
    /** Food's id for the food it is still working on; set exactly for the two pending reasons. */
    readonly foodHandleId: string | null;
    readonly tiersConsulted: readonly CascadeTierId[];
    readonly tiersUnavailable: readonly CascadeTierId[];
    /** ⛔ Operator-only text, never on the wire (R5). */
    readonly detail: string | null;
}

/** What the resolution cascade concluded before food was asked. */
export type CascadeFinding =
    | {
          readonly kind: 'exhausted';
          readonly consulted: readonly CascadeTierId[];
          /** Consulted tiers whose I/O failed. Non-empty means "we could not look", not "we found nothing". */
          readonly unavailable: readonly CascadeTierId[];
      }
    /** No cascade is configured, or the phrase could not key one. */
    | { readonly kind: 'notRun' };

/**
 * What food said when asked to add the phrase by name. `RESOLVED` is not a failure, so it has no arm: the caller
 * binds the food instead of recording anything.
 */
export type FoodAddAnswer =
    | { readonly kind: 'answered'; readonly foodId: string; readonly status: Exclude<FoodStatus, 'RESOLVED'> }
    /** Food could not be asked: no caller credential to ask with. */
    | { readonly kind: 'notAsked' }
    /** Food was asked and did not answer. `detail` names the error, for operators. */
    | { readonly kind: 'unreachable'; readonly detail: string };

/** How a new attempt changes an existing failure record. */
export type FailureUpdate =
    /** Count the attempt; keep every fact. */
    | { readonly kind: 'countAttempt' }
    /** Count the attempt and replace the facts with the new outcome's. */
    | { readonly kind: 'replace'; readonly failure: NewFailure };

/** The reasons that mean "we could not look". Every other reason is something we learned. */
const TRANSIENT_REASONS: ReadonlySet<UnresolvedFoodReasonCode> = new Set(['sources_errored', 'cascade_unavailable']);

/**
 * Whether a failure's reason means "we could not look" rather than something we learned. Pure.
 *
 * @param reasonCode - The failure's reason.
 * @returns `true` for a transient reason.
 */
export const isTransientReason = (reasonCode: UnresolvedFoodReasonCode): boolean => TRANSIENT_REASONS.has(reasonCode);

/**
 * Cut operator detail to the column's bound.
 *
 * @param detail - The raw detail.
 * @returns At most {@link MAX_FAILURE_DETAIL_CHARS} characters. Pure.
 */
function boundedDetail(detail: string): string {
    return detail.slice(0, MAX_FAILURE_DETAIL_CHARS);
}

/**
 * The reason and handle food's add answer means.
 *
 * @param answer - Food's answer.
 * @param cascade - What the cascade concluded, for when food was not asked.
 * @returns The reason, handle and detail. Pure.
 */
function reasonOf(
    answer: FoodAddAnswer,
    cascade: CascadeFinding,
): Pick<NewFailure, 'reasonCode' | 'foodHandleId' | 'detail'> {
    switch (answer.kind) {
        case 'unreachable':
            return { reasonCode: 'sources_errored', foodHandleId: null, detail: boundedDetail(answer.detail) };

        case 'notAsked': {
            const couldNotLook = cascade.kind === 'exhausted' && cascade.unavailable.length > 0;

            return {
                reasonCode: couldNotLook ? 'cascade_unavailable' : 'cascade_exhausted',
                foodHandleId: null,
                detail: null,
            };
        }

        case 'answered':
            switch (answer.status) {
                case 'PENDING':
                case 'AWAITING_RETRY':
                    return { reasonCode: 'awaiting_source', foodHandleId: answer.foodId, detail: null };
                case 'UNRESOLVED':
                    return { reasonCode: 'several_candidates', foodHandleId: answer.foodId, detail: null };
                case 'NOT_FOUND':
                case 'WITHDRAWN':
                    return { reasonCode: 'no_source_has_it', foodHandleId: null, detail: null };
                case 'FAILED':
                    return { reasonCode: 'sources_errored', foodHandleId: null, detail: 'food reported FAILED' };
            }
    }
}

/**
 * The failure record for a phrase the cascade and food could not resolve.
 *
 * @param input - The phrase, what the cascade concluded, and what food said.
 * @returns The record to write. Pure.
 */
export function failureOf(input: {
    readonly name: string;
    readonly normalizedKey: string;
    readonly sourcePhrase: string | null;
    readonly cascade: CascadeFinding;
    readonly food: FoodAddAnswer;
}): NewFailure {
    const { cascade } = input;

    return {
        name: input.name,
        normalizedKey: input.normalizedKey,
        sourcePhrase: input.sourcePhrase,
        ...reasonOf(input.food, cascade),
        tiersConsulted: cascade.kind === 'exhausted' ? cascade.consulted : [],
        tiersUnavailable: cascade.kind === 'exhausted' ? cascade.unavailable : [],
    };
}

/**
 * The record for a name the cook declared: a substance they asked for as written. It never converges with
 * another cook's declaration and it is never retried.
 *
 * @param name - The cook's name.
 * @param normalizedKey - Its key (unused for convergence, which the dedup index skips for declarations).
 * @returns The record to write. Pure.
 */
export function declaredFailure(name: string, normalizedKey: string): NewFailure {
    return {
        name,
        normalizedKey,
        sourcePhrase: null,
        reasonCode: 'author_declared',
        foodHandleId: null,
        tiersConsulted: [],
        tiersUnavailable: [],
        detail: null,
    };
}

/**
 * How a new attempt changes a failure record that already exists for the same phrase.
 *
 * @param existing - The stored record.
 * @param next - The new attempt's outcome.
 * @returns Count the attempt only, or replace the facts too. Pure.
 */
export function mergeAttempt(existing: FailureFacts, next: NewFailure): FailureUpdate {
    if (existing.reasonCode === 'author_declared') {
        return { kind: 'countAttempt' };
    }

    const knownBefore = !TRANSIENT_REASONS.has(existing.reasonCode);
    const transientNow = TRANSIENT_REASONS.has(next.reasonCode);

    return knownBefore && transientNow ? { kind: 'countAttempt' } : { kind: 'replace', failure: next };
}
