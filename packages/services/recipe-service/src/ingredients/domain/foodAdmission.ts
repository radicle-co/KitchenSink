/**
 * The policy that decides whether a food may be BOUND to a recipe line, and whether a food-service fact may
 * free a SHARED failure record (plan 002 R13, R20, R51).
 *
 * It returns two branded proofs, and only this module can build them:
 *  - {@link FoodAdmission} — the repository's `findOrCreateBoundRoot` takes one, so a bind that skipped food's
 *    check does not type-check (R51);
 *  - {@link ResolvedHandle} — the repository's `settleFailure` takes one, so only food's answer about the
 *    failure's own pending food, or about the failure's own phrase, may move every line off a shared failure.
 *    One cook's personal cascade never can (R13, R20), and a cook's declared name is never freed at all.
 *
 * The brand is a module-private `unique symbol`, so a literal elsewhere cannot supply it.
 *
 * @pattern Policy — a pure decision module in the ADR-0023 shape, returning branded proofs (Value Objects)
 */
import type { FailureFacts, UnresolvedArm } from '../../database/schema/foodLookupArm.js';
import type { FoodRefAnswer } from './foodRefAnswer.js';
import { canonicalIngredientName, type CanonicalIngredientName } from './ingredientName.js';

const admissionBrand: unique symbol = Symbol('FoodAdmission');
const handleBrand: unique symbol = Symbol('ResolvedHandle');

/** Proof that a food may be bound, with the facts the binding captures. */
export interface FoodAdmission {
    readonly [admissionBrand]: true;
    readonly foodId: string;
    /** The food's name as food published it, in canonical form. */
    readonly name: CanonicalIngredientName;
    /** The author's id when the food is their private authored food; `null` for a shared food. */
    readonly ownerId: string | null;
}

/** Why a food may not be bound, in words for the `UNKNOWN_INGREDIENT` message. */
export interface AdmissionRefusal {
    readonly refused: string;
}

/** Proof that food-service resolved a shared failure's own pending food or phrase to a bindable food. */
export interface ResolvedHandle {
    readonly [handleBrand]: true;
    /** The failure record every line on it will be moved off. */
    readonly unresolvedFoodId: string;
    /** The failure's own lookup row. */
    readonly lookupId: string;
    readonly admission: FoodAdmission;
}

/** What food said about a shared failure, and which of the failure's facts it is about. */
export type FreeingEvidence =
    /** Food's answer about the pending food whose id the failure holds as its handle. */
    | { readonly kind: 'handle'; readonly foodId: string; readonly answer: FoodRefAnswer }
    /** Food resolved the failure's own phrase to `foodId` (an add by the same normalized name). */
    | {
          readonly kind: 'name';
          /** The normalized key the add was made under, compared with the failure's own key. */
          readonly normalizedKey: string;
          readonly foodId: string;
          readonly answer: FoodRefAnswer;
      };

/**
 * Whether a decision is an admission rather than a refusal.
 *
 * @param decision - An admission decision.
 * @returns `true` for a {@link FoodAdmission}. Pure.
 */
export function isAdmission(decision: FoodAdmission | AdmissionRefusal): decision is FoodAdmission {
    return !('refused' in decision);
}

/**
 * Decide whether food's answer about a food lets it be bound.
 *
 * A food is bindable when food found it, it is `RESOLVED`, and it has a usable name. A private food is shown by
 * food to its author alone, so when the answer says private, the caller IS the author and is recorded as owner.
 *
 * @param foodId - The food that was asked about.
 * @param answer - Food's answer about it.
 * @param callerId - The requesting user, or `undefined` for an unattended caller.
 * @returns The admission, or why not. Pure.
 */
export function admitResolvedRef(
    foodId: string,
    answer: FoodRefAnswer,
    callerId: string | undefined,
): FoodAdmission | AdmissionRefusal {
    if (answer.outcome !== 'found') {
        return {
            refused:
                answer.outcome === 'absent' ? 'the food service has no such food' : 'the food service did not answer',
        };
    }

    if (answer.status !== 'RESOLVED') {
        return { refused: `status is ${answer.status}, not RESOLVED` };
    }

    if (answer.name === undefined) {
        return { refused: 'the food has no usable name' };
    }

    if (answer.isPrivate && callerId === undefined) {
        return { refused: 'a private food needs its author as the caller' };
    }

    const ownerId = answer.isPrivate && callerId !== undefined ? callerId : null;

    return { [admissionBrand]: true, foodId, name: answer.name, ownerId };
}

/**
 * Admit the food an author just created (the forced fork, R13): the author owns it, and only the line that
 * asked for it may bind it.
 *
 * @param created - The created food's id and name.
 * @param authorId - The author.
 * @returns The admission, or why not. Pure.
 */
export function admitAuthoredFood(
    created: { readonly id: string; readonly name: string },
    authorId: string,
): FoodAdmission | AdmissionRefusal {
    const name = canonicalIngredientName(created.name);

    if (name === undefined) {
        return { refused: 'the created food has no usable name' };
    }

    return { [admissionBrand]: true, foodId: created.id, name, ownerId: authorId };
}

/**
 * Whether a failure is still open: not a cook's declared name, and not freed by a settle. Only an open failure is
 * re-asked, picked for or settled (a settle is final, ADR-0045). Pure.
 *
 * @param failure - The failure's facts.
 * @returns `true` while the failure can still be resolved.
 */
export function isOpenFailure(failure: FailureFacts): boolean {
    return failure.reasonCode !== 'author_declared' && failure.settledLookupId === null;
}

/**
 * The pending food an open failure waits on. A settle keeps the handle, so reading the column alone would act on a
 * closed failure. Pure.
 *
 * @param arm - The failure.
 * @returns The handle, or `undefined` when the failure has none or is not open.
 */
export function openHandleOf(arm: UnresolvedArm): string | undefined {
    return isOpenFailure(arm.failure) ? (arm.failure.foodHandleId ?? undefined) : undefined;
}

/**
 * Decide whether food's answer frees a shared failure record.
 *
 * @param arm - The failure's lookup.
 * @param evidence - What food said, and which of the failure's facts it is about.
 * @returns The proof, or `undefined` when the answer is about something else, is not a bindable shared food, the
 *   failure is a cook's declared name, or a settle already freed it (a settle is final). Pure.
 */
export function resolvedHandleOf(arm: UnresolvedArm, evidence: FreeingEvidence): ResolvedHandle | undefined {
    const { failure } = arm;

    if (!isOpenFailure(failure)) {
        return undefined;
    }

    const aboutThisFailure =
        evidence.kind === 'handle'
            ? failure.foodHandleId !== null && failure.foodHandleId === evidence.foodId
            : evidence.normalizedKey === failure.normalizedKey;

    if (!aboutThisFailure) {
        return undefined;
    }

    // A private food frees nobody else's line: it is visible to its author only (the forced fork, R13).
    if (evidence.answer.outcome === 'found' && evidence.answer.isPrivate) {
        return undefined;
    }

    const admission = admitResolvedRef(evidence.foodId, evidence.answer, undefined);

    if (!isAdmission(admission)) {
        return undefined;
    }

    return { [handleBrand]: true, unresolvedFoodId: failure.unresolvedFoodId, lookupId: arm.lookupId, admission };
}
