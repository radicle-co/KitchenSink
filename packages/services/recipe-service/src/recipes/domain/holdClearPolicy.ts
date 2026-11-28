/**
 * `holdClearPolicy`: who may clear a recipe's correction hold, and when (ADR-0106, plan pr5HoldClear KTD-5).
 *
 * @pattern Specification — a pure decision over facts the caller read under the recipe's row lock. It does no I/O and takes no
 *   request field: the chain it reads is the server's, never a client's label.
 *
 * ## The rules
 *
 *  - **Staff** clear any held recipe, whatever the answer, when the correction they saw is still the newest row of the chain
 *    (`null` means "no row anywhere", and holds only while there is still none).
 *  - **An earned rewrite** clears only when EVERY correction row in the chain (the recipe and each ancestor by `cloned_from_id`) has
 *    a third-party answer: book, paid site or web page. An own or from-person row anywhere, or no row at all, refuses (fail closed):
 *    the hold then needs staff. Rows already cleared still count, because rows are never removed.
 *
 * ## The domain is narrow on purpose
 *
 * A correction holds only when `holdOf(from, to)`: the new answer is own or person, or the old answer was a paid site. So the held
 * recipes with an all-third-party chain are (i) paid site corrected to a book, web page or paid site, (ii) a later third-party
 * correction over an earlier own or person hold, which the ratchet keeps, and (iii) clones of those. A book label still hides the
 * recipe through the private-only term after the clear.
 */
import type { SourceAnswerKind } from './sourceCorrectionScopePolicy.js';

/** Why an earned clear is refused. The union is closed: a caller branches on every member. */
export type EarnedHoldClearRefusal = 'notHeld' | 'noCorrectionRow' | 'ownAnswerInChain' | 'fromPersonAnswerInChain';

/** Why a staff clear is refused. */
export type StaffHoldClearRefusal = 'notHeld' | 'correctionNotLatest';

/** One correction row of the chain, newest and nearest first. */
export interface ChainAnswer {
    readonly id: string;
    readonly answer: SourceAnswerKind;
}

export type HoldClearVerdict<R extends string> =
    { readonly kind: 'clear' } | { readonly kind: 'refuse'; readonly reason: R };

/**
 * Decide a hold clear. Pure.
 *
 * @param input - The cause and the facts read under the row lock.
 * @returns `clear`, or the first refusal in the documented order.
 */
export function holdClearPolicy(input: {
    readonly cause: 'staff';
    readonly held: boolean;
    readonly chain: readonly ChainAnswer[];
    readonly expectedCorrectionId: string | null;
}): HoldClearVerdict<StaffHoldClearRefusal>;
export function holdClearPolicy(input: {
    readonly cause: 'earnedRewrite';
    readonly held: boolean;
    readonly chain: readonly ChainAnswer[];
}): HoldClearVerdict<EarnedHoldClearRefusal>;
export function holdClearPolicy(
    input:
        | {
              readonly cause: 'staff';
              readonly held: boolean;
              readonly chain: readonly ChainAnswer[];
              readonly expectedCorrectionId: string | null;
          }
        | { readonly cause: 'earnedRewrite'; readonly held: boolean; readonly chain: readonly ChainAnswer[] },
): HoldClearVerdict<StaffHoldClearRefusal> | HoldClearVerdict<EarnedHoldClearRefusal> {
    if (!input.held) {
        return { kind: 'refuse', reason: 'notHeld' };
    }

    if (input.cause === 'staff') {
        return (input.chain[0]?.id ?? null) === input.expectedCorrectionId
            ? { kind: 'clear' }
            : { kind: 'refuse', reason: 'correctionNotLatest' };
    }

    if (input.chain.length === 0) {
        return { kind: 'refuse', reason: 'noCorrectionRow' };
    }

    if (input.chain.some((row) => row.answer === 'own')) {
        return { kind: 'refuse', reason: 'ownAnswerInChain' };
    }

    if (input.chain.some((row) => row.answer === 'person')) {
        return { kind: 'refuse', reason: 'fromPersonAnswerInChain' };
    }

    return { kind: 'clear' };
}
