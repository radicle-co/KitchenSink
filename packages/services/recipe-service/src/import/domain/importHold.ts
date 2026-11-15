/**
 * Why an import item is held, and whether that hold still applies to the cook asking (review M1 on #220).
 *
 * DESIGN PATTERN: **Specification**, pure and total, with the hold's cause as a **value object**. A hold keeps an item out of
 * the save queue until something that could change the outcome changes. For a cause inside the item (a missing cuisine,
 * servings or times, a refusal, a payload this build cannot read) only the cook's decision can, and a decision moves
 * `decision_rev` past `held_at_rev`. For a cause the COOK'S FACTS decide (the label judged under their containment, or a
 * create the save path refused under their plan), an upgrade or a containment change can too, with no decision at all. So
 * those holds record the facts they were judged under, and they no longer apply to a cook whose facts differ. A released
 * item that is still refused is held again under the new facts: one look per change, never a loop.
 *
 * ⛔ The candidate query states the same rule in SQL (`findSaveCandidates`). Both sides read ONE list,
 * {@link COOK_DEPENDENT_HOLD_REASONS}, and the LOCAL e2e asks every reason of both. The 0082 CHECK spells the same sets in
 * SQL, so a new reason needs a new migration too, and that e2e fails until it has one.
 */
import type { VisibilityFacts } from './importVisibility.js';

/** Every reason a hold records. The SQL CHECK of 0082 spells the same set. */
export const HOLD_REASONS = ['item', 'unreadable', 'visibility', 'createRefused'] as const;

/** Why an item is held. */
export type HoldReason = (typeof HOLD_REASONS)[number];

/** The reasons whose cause the cook's facts decide: the hold records them, and a cook with other facts is not held. */
export const COOK_DEPENDENT_HOLD_REASONS: readonly HoldReason[] = ['visibility', 'createRefused'];

/** The reasons the list names `saveRefused`: the save held the item for a cause no other issue names. */
const SAVE_REFUSED_REASONS: readonly HoldReason[] = ['unreadable', 'createRefused'];

/** What a hold writes beside `held_at_rev`. */
export interface ImportHold {
    readonly reason: HoldReason;
    /** The cook facts it was judged under ({@link cookKeyOf}), for a cook-dependent reason; `null` otherwise. */
    readonly cookKey: string | null;
}

/** The columns a hold is read from. */
export interface HeldItem {
    readonly heldAtRev: number | null;
    readonly decisionRev: number;
    /** `null` for a hold written before reasons were recorded, read as a cause inside the item. */
    readonly heldReason: HoldReason | null;
    readonly heldCookKey: string | null;
}

const isCookDependent = (reason: HoldReason): boolean => COOK_DEPENDENT_HOLD_REASONS.includes(reason);

/**
 * The cook facts the label and the create read, as one opaque key: equal facts give an equal key. Pure.
 *
 * @param facts - The cook's principal kind, containment and plan.
 */
export function cookKeyOf(facts: VisibilityFacts): string {
    return [facts.principalKind, facts.containment, facts.isPremium ? 'paid' : 'free'].join('/');
}

/**
 * The hold to record for a reason, judged under these cook facts. Pure.
 *
 * @param reason - Why the save holds the item.
 * @param cook - The cook the save judged it for.
 */
export function holdOf(reason: HoldReason, cook: VisibilityFacts): ImportHold {
    return { reason, cookKey: isCookDependent(reason) ? cookKeyOf(cook) : null };
}

/**
 * Whether an item's hold keeps it out of the save queue for this cook. Pure and total.
 *
 * @param item - The hold's columns.
 * @param cookKey - The asking cook's {@link cookKeyOf}.
 */
export function holdApplies(item: HeldItem, cookKey: string): boolean {
    if (item.heldAtRev !== item.decisionRev) {
        return false;
    }

    const reason = item.heldReason ?? 'item';

    return !isCookDependent(reason) || item.heldCookKey === cookKey;
}

/**
 * Whether the save holds the item, at its current revision, because it cannot read its recipe: the one hold a new recipe
 * from the cook may lift on a matched item (`decideItemUpsert`). Pure.
 *
 * @param item - The hold's columns.
 */
export function isHeldUnreadable(item: HeldItem): boolean {
    return item.heldReason === 'unreadable' && item.heldAtRev === item.decisionRev;
}

/**
 * Whether the list names the hold `saveRefused`: it still applies, and its cause is one no other issue names (a create
 * refusal the pre-check did not predict, or a payload this build cannot read). Pure and total.
 *
 * @param item - The hold's columns.
 * @param cookKey - The asking cook's {@link cookKeyOf}.
 */
export function isSaveRefusedHold(item: HeldItem, cookKey: string): boolean {
    return item.heldReason !== null && SAVE_REFUSED_REASONS.includes(item.heldReason) && holdApplies(item, cookKey);
}
