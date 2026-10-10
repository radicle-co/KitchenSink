/**
 * The ONE derivation of a recipe line's name and user-entered flag (plan 002 R9, R10, R15; ADR-0045).
 *
 * The recipe database stores no food names. A line's name comes from following its binding: the failure
 * record's name on the unresolved arm, and food-service's answer on a bound arm. When food could not be asked,
 * or will not show the food to this caller, the line has NO name — there is no fallback, no last-known name and
 * no placeholder. That absence is what the wire's `NAMELESS_LINE_STATUSES` describe.
 *
 * Every other module reads a line's name, user-entered flag, catalog status and food presence through the
 * accessors here, so no caller branches on the arm to get a name (R10).
 *
 * A line with a name to show from food also carries where its food LIVES (curated U9): the live root and, when it is
 * one, the variant — food's answer on this read, never a stored fact.
 *
 * @pattern Data Mapper — pure, over the arm union and food's answer
 */
import type { CatalogFoodResolutionStatus, IngredientVariant, IngredientVariantPart } from '@kitchensink/recipe-core';

import { foodRefKey, foodRefOf, privateFoodOwnerOf, type FoodLookupArm } from '../../database/schema/foodLookupArm.js';
import type { FoodRefAnswer } from './foodRefAnswer.js';

/**
 * What food-service said about a bound line's food on this read.
 *
 * - `present`: food showed the food and it is live.
 * - `withdrawn`: food showed the food, and its author withdrew it.
 * - `gone`: food answered that the caller may not read the food, or that it does not exist, or it has no name.
 * - `unreachable`: food could not be asked.
 * - `unbound`: the line is unresolved; there is no food to ask about.
 */
export type FoodPresence = 'present' | 'withdrawn' | 'gone' | 'unreachable' | 'unbound';

/** Where a bound line's food lives on this read (curated U9): its live root, and the variant when it is one. */
export interface LineFood {
    readonly rootId: string;
    readonly variant?: IngredientVariant;
}

/**
 * A line's identity: its arm, its name (absent when there is none to show) and its food's presence. A line food showed
 * carries {@link LineFood}; no other line can, so "named by food, but no food" is not representable.
 */
export type IngredientLineIdentity =
    | {
          readonly arm: FoodLookupArm;
          readonly name: string;
          readonly presence: Extract<FoodPresence, 'present' | 'withdrawn'>;
          readonly food: LineFood;
      }
    | {
          readonly arm: FoodLookupArm;
          readonly name: string | undefined;
          readonly presence: Exclude<FoodPresence, 'present' | 'withdrawn'>;
          readonly food?: undefined;
      };

/** A line whose identity the caller needed was never derived — a defect in the caller's batching. */
export class MissingLineIdentityError extends Error {
    public readonly lookupId: string;

    /** @param lookupId - The lookup the caller asked about. */
    public constructor(lookupId: string) {
        super(`no identity was derived for food lookup ${lookupId}`);
        this.name = 'MissingLineIdentityError';
        this.lookupId = lookupId;
        Object.setPrototypeOf(this, MissingLineIdentityError.prototype);
    }
}

/** Type guard for {@link MissingLineIdentityError}. */
export function isMissingLineIdentityError(value: unknown): value is MissingLineIdentityError {
    return value instanceof MissingLineIdentityError;
}

/**
 * The identity a bound arm has, given food's answer.
 *
 * @param arm - The bound arm.
 * @param answer - Food's answer, or `undefined` when the reference was never answered.
 * @returns The identity. Pure.
 */
function boundIdentity(arm: FoodLookupArm, answer: FoodRefAnswer | undefined): IngredientLineIdentity {
    if (answer === undefined || answer.outcome === 'unreachable') {
        return { arm, name: undefined, presence: 'unreachable' };
    }

    if (answer.outcome === 'absent' || answer.name === undefined) {
        return { arm, name: undefined, presence: 'gone' };
    }

    return {
        arm,
        name: answer.name,
        presence: answer.status === 'WITHDRAWN' ? 'withdrawn' : 'present',
        food:
            answer.variant === undefined
                ? { rootId: answer.rootId }
                : { rootId: answer.rootId, variant: answer.variant },
    };
}

/**
 * Derive a line's identity from its arm and food's answers.
 *
 * @param arm - The line's parsed binding.
 * @param answers - Food's answers, keyed by {@link foodRefKey}.
 * @returns The identity. Pure.
 */
export function deriveIngredientLineIdentity(
    arm: FoodLookupArm,
    answers: ReadonlyMap<string, FoodRefAnswer>,
): IngredientLineIdentity {
    const ref = foodRefOf(arm);

    if (ref === undefined) {
        return { arm, name: arm.kind === 'unresolved' ? arm.failure.name : undefined, presence: 'unbound' };
    }

    return boundIdentity(arm, answers.get(foodRefKey(ref)));
}

/**
 * Look up a derived identity, refusing a missing one. The ONE place absence becomes a refusal, so it cannot be
 * spelled two ways.
 *
 * @param byLookupId - Identities by lookup id.
 * @param lookupId - The lookup wanted.
 * @returns The identity.
 * @throws {MissingLineIdentityError} when none was derived. Pure.
 */
export function requireIngredientLineIdentity(
    byLookupId: ReadonlyMap<string, IngredientLineIdentity>,
    lookupId: string,
): IngredientLineIdentity {
    const identity = byLookupId.get(lookupId);

    if (identity === undefined) {
        throw new MissingLineIdentityError(lookupId);
    }

    return identity;
}

/** The line's name, or `undefined` when it has none to show. Pure. */
export function lineNameOf(identity: IngredientLineIdentity): string | undefined {
    return identity.name;
}

/**
 * The name every reader of the recipe may see: the line's name, except for a PRIVATE authored food, whose name
 * only its author may see (plan 002 R9, AE10). The recipe-level surfaces every reader can reach — the search
 * column and the version snapshot — store this, never {@link lineNameOf}, even when the author is the one saving.
 *
 * @param identity - The line's identity.
 * @returns The name, or `undefined`. Pure.
 */
export function shareableLineNameOf(identity: IngredientLineIdentity): string | undefined {
    return privateFoodOwnerOf(identity.arm) === undefined ? identity.name : undefined;
}

/**
 * The variant parts every reader of the recipe may see, for the version snapshot beside {@link shareableLineNameOf}
 * (curated U9): the line's variant's parts, under the same private-food rule. Pure.
 *
 * @param identity - The line's identity.
 * @returns The parts, or `undefined` for a line whose food is not a variant or not shown.
 */
export function shareableVariantPartsOf(
    identity: IngredientLineIdentity,
): readonly IngredientVariantPart[] | undefined {
    return privateFoodOwnerOf(identity.arm) === undefined ? identity.food?.variant?.parts : undefined;
}

/** Whether the cook declared this line's name — DERIVED from the binding, never stored (R15). Pure. */
export function isUserEnteredOf(identity: IngredientLineIdentity): boolean {
    return identity.arm.kind === 'unresolved' && identity.arm.failure.reasonCode === 'author_declared';
}

/**
 * The catalog status the line's binding reports: `RESOLVED` for a bound line, the failure's status for an
 * unresolved one, and none for a declared line, which is not resolving.
 *
 * @param identity - The line's identity.
 * @returns The status, or `undefined`. Pure.
 */
export function catalogStatusOf(identity: IngredientLineIdentity): CatalogFoodResolutionStatus | undefined {
    const { arm } = identity;

    if (arm.kind !== 'unresolved') {
        return 'RESOLVED';
    }

    return arm.failure.reasonCode === 'author_declared' ? undefined : arm.failure.status;
}

/** What food said about the line's food on this read. Pure. */
export function presenceOf(identity: IngredientLineIdentity): FoodPresence {
    return identity.presence;
}
