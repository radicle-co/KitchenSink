/**
 * The ONE reading of a `food_lookups` row's arm (ADR-0045: "one function maps a `food_lookups` row to a tagged
 * value … it lives beside the schema, and every reader goes through it").
 *
 * The table carries no `kind` column: its arm is READ OFF which of `food_id`, `food_variant_id` and
 * `unresolved_food_id` is set (`food_lookups_one_arm`). That decision only pays for itself if the reading lives
 * in exactly one place, so every caller that needs to know "root, variant or unresolved" parses the row here
 * and switches over the result. A `row.foodId !== null ? … : …` anywhere else is the drift this module exists
 * to prevent.
 *
 * It PARSES rather than validates: a stored reason, status or tier comes back as the narrow type the rest of
 * the service works in, and a value outside the vocabulary is refused here, at the boundary, instead of
 * travelling on as a string.
 *
 * ⛔ The failure record's `detail` column is not part of any arm. It is operator-only (plan 002 R5), so the
 * input type below omits it and no arm can carry it toward a response.
 *
 * @pattern Visitor — a discriminated union read by an exhaustive switch; the parser is its one constructor
 */
import {
    UNRESOLVED_FOOD_STATUSES,
    unresolvedFoodReasonSchema,
    type UnresolvedFoodReasonCode,
    type UnresolvedFoodStatus,
} from '@kitchensink/recipe-core';

import { isCascadeTierId, type CascadeTierId } from '../../ingredients/resolution/resolutionCascade.js';
import { FoodLookupArmCorruptError } from './foodLookupArm.errors.js';
import type { FoodLookupRow } from './foodLookups.js';
import type { UnresolvedFoodRow } from './unresolvedFoods.js';

/** A failure record as the service may select it: every column except the operator-only `detail`. */
export type FailureRow = Omit<UnresolvedFoodRow, 'detail'>;

/** A `food_lookups` row with its failure record, when it has one (`food_lookups LEFT JOIN unresolved_foods`). */
export interface FoodLookupJoinedRow {
    readonly lookup: FoodLookupRow;
    readonly failure: FailureRow | null;
}

/** What a failure record says, parsed into the service's own types. */
export interface FailureFacts {
    readonly unresolvedFoodId: string;
    /** The food name that failed to resolve — the unresolved arm's whole contribution to a line's name. */
    readonly name: string;
    readonly normalizedKey: string;
    readonly reasonCode: UnresolvedFoodReasonCode;
    readonly status: UnresolvedFoodStatus;
    /** Food-service's id for the food it is still working on; set exactly for the two pending reasons. */
    readonly foodHandleId: string | null;
    readonly tiersConsulted: readonly CascadeTierId[];
    readonly tiersUnavailable: readonly CascadeTierId[];
    readonly attempts: number;
    /**
     * The binding a food-service answer settled this failure to, or `null` while it stands (plan 002 R13). A line
     * that still names a settled failure is planned onto this binding.
     */
    readonly settledLookupId: string | null;
}

/** A binding to a root food. */
export interface RootArm {
    readonly kind: 'root';
    readonly lookupId: string;
    readonly foodId: string;
    /** The author's id when the food is their private authored food; `null` for a shared food. */
    readonly foodOwnerId: string | null;
    readonly createdAt: Date;
}

/** A binding to a variant of a root. */
export interface VariantArm {
    readonly kind: 'variant';
    readonly lookupId: string;
    readonly foodVariantId: string;
    readonly createdAt: Date;
}

/** A binding to the record of a lookup that did not resolve. */
export interface UnresolvedArm {
    readonly kind: 'unresolved';
    readonly lookupId: string;
    readonly failure: FailureFacts;
    readonly createdAt: Date;
}

/** What a `food_lookups` row binds to: exactly one of a root, a variant or an unresolved food. */
export type FoodLookupArm = RootArm | VariantArm | UnresolvedArm;

/** The food a bound arm points at, as food-service addresses it. */
export interface FoodRef {
    readonly kind: 'root' | 'variant';
    readonly id: string;
}

/**
 * Parse one stored array of tier names.
 *
 * @param lookupId - The lookup row's id, for the error.
 * @param column - Which column, for the error.
 * @param values - The stored names.
 * @returns The chain tiers.
 * @throws {FoodLookupArmCorruptError} when a name is not a link of the chain.
 */
function parseTiers(lookupId: string, column: string, values: readonly string[]): readonly CascadeTierId[] {
    return values.map((value) => {
        if (!isCascadeTierId(value)) {
            throw new FoodLookupArmCorruptError(lookupId, `${column} names "${value}", which is not a cascade tier`);
        }

        return value;
    });
}

/**
 * Parse a failure record that belongs to an unresolved-arm lookup. Exported for the repository, which reads a
 * failure back after updating it; every other reader goes through {@link foodLookupArmOf}.
 *
 * @param lookupId - The lookup row's id.
 * @param failure - The record.
 * @returns The parsed facts.
 * @throws {FoodLookupArmCorruptError} when a stored value is outside the vocabulary.
 */
export function failureFactsOf(lookupId: string, failure: FailureRow): FailureFacts {
    const reason = unresolvedFoodReasonSchema.safeParse(failure.reasonCode);

    if (!reason.success) {
        throw new FoodLookupArmCorruptError(lookupId, `reason code "${failure.reasonCode}" is outside the vocabulary`);
    }

    const status = UNRESOLVED_FOOD_STATUSES.find((member) => member === failure.status);

    if (status === undefined) {
        throw new FoodLookupArmCorruptError(lookupId, `status "${failure.status}" is not a failure status`);
    }

    return {
        unresolvedFoodId: failure.id,
        name: failure.name,
        normalizedKey: failure.normalizedKey,
        reasonCode: reason.data,
        status,
        foodHandleId: failure.foodHandleId,
        tiersConsulted: parseTiers(lookupId, 'tiers_consulted', failure.tiersConsulted),
        tiersUnavailable: parseTiers(lookupId, 'tiers_unavailable', failure.tiersUnavailable),
        attempts: failure.attempts,
        settledLookupId: failure.settledLookupId,
    };
}

/**
 * Read a joined `food_lookups` row as exactly one arm.
 *
 * @param row - The lookup and its failure record, when it has one.
 * @returns The arm.
 * @throws {FoodLookupArmCorruptError} when the row names no arm or several, when the failure record is missing
 *   or belongs to another row, when a bound row carries a failure record or a non-root row carries an owner, or
 *   when a stored value is outside the vocabulary. None of these can come from a migrated database. Pure.
 */
export function foodLookupArmOf(row: FoodLookupJoinedRow): FoodLookupArm {
    const { lookup, failure } = row;
    const arms = [lookup.foodId, lookup.foodVariantId, lookup.unresolvedFoodId].filter((value) => value !== null);

    if (arms.length !== 1) {
        throw new FoodLookupArmCorruptError(lookup.id, `it names ${String(arms.length)} arms, not exactly one`);
    }

    if (lookup.unresolvedFoodId === null && failure !== null) {
        throw new FoodLookupArmCorruptError(lookup.id, 'a bound row came back with a failure record');
    }

    if (lookup.foodId === null && lookup.foodOwnerId !== null) {
        throw new FoodLookupArmCorruptError(lookup.id, 'only a root binding may carry an owner');
    }

    if (lookup.foodId !== null) {
        return {
            kind: 'root',
            lookupId: lookup.id,
            foodId: lookup.foodId,
            foodOwnerId: lookup.foodOwnerId,
            createdAt: lookup.createdAt,
        };
    }

    if (lookup.foodVariantId !== null) {
        return {
            kind: 'variant',
            lookupId: lookup.id,
            foodVariantId: lookup.foodVariantId,
            createdAt: lookup.createdAt,
        };
    }

    if (failure === null || failure.id !== lookup.unresolvedFoodId) {
        throw new FoodLookupArmCorruptError(lookup.id, 'its failure record is missing or is another row');
    }

    return {
        kind: 'unresolved',
        lookupId: lookup.id,
        failure: failureFactsOf(lookup.id, failure),
        createdAt: lookup.createdAt,
    };
}

/**
 * The author of a binding's PRIVATE food, or `undefined` for every other binding — the one statement of which
 * bindings are private. Only a root food can be a cook's own (`food_lookups_owner_needs_a_root`).
 *
 * @param arm - A parsed arm.
 * @returns The owner's id. Pure.
 */
export function privateFoodOwnerOf(arm: FoodLookupArm): string | undefined {
    return arm.kind === 'root' && arm.foodOwnerId !== null ? arm.foodOwnerId : undefined;
}

/**
 * Whether a viewer may NOT see a food: the food is private and the viewer is not its author (plan 002 R46). An unknown
 * viewer is a stranger, so privacy fails toward hiding. The one statement of who is entitled; each enforcement point
 * decides for itself what a stranger is shown.
 *
 * @param privateFoodOwner - The food's author when the food is private ({@link privateFoodOwnerOf}), else `undefined`.
 * @param viewerId - The viewer, or `undefined` when unknown.
 * @returns `true` when the viewer is a stranger to a private food. Pure.
 */
export function isStrangerToPrivateFood(privateFoodOwner: string | undefined, viewerId: string | undefined): boolean {
    return privateFoodOwner !== undefined && privateFoodOwner !== viewerId;
}

/**
 * The food a bound arm points at.
 *
 * @param arm - A parsed arm.
 * @returns The reference, or `undefined` for an unresolved arm. Pure.
 */
export function foodRefOf(arm: FoodLookupArm): FoodRef | undefined {
    switch (arm.kind) {
        case 'root':
            return { kind: 'root', id: arm.foodId };
        case 'variant':
            return { kind: 'variant', id: arm.foodVariantId };
        case 'unresolved':
            return undefined;
    }
}

/**
 * A map key for a reference. A root and a variant that share an id string are different foods, so the kind is
 * part of the key.
 *
 * @param ref - The reference.
 * @returns `kind:id`. Pure.
 */
export function foodRefKey(ref: FoodRef): string {
    return `${ref.kind}:${ref.id}`;
}
