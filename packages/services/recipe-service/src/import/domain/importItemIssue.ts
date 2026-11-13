/**
 * Why an item cannot be saved yet, as the opaque key the clients localize (the contract's `issue.reason`).
 *
 * DESIGN PATTERN: **Specification / Policy module**, pure and total. DERIVED at read time and never stored: a stored issue is
 * wrong the moment the cook fixes it, the same reason "flagged" is not stored (ADR-0072 §6). The stage enum is closed and
 * parsed strictly by installed clients, so a new stuck state arrives as a new key here and never as a new stage.
 *
 * Precedence, first match wins: a saved item has none; a REFUSED recipe (no ingredient line or no step, ADR-0072 §3) names its
 * refusal, because it is never paid for, parsed or saved; an unpaid item waits for the allowance; then a matched item needs
 * its statement, then its visibility must be allowed for the label the statement sets, then it must have what the save needs
 * (cuisine, servings, times; ADR-0072 §3 as amended 2026-11-11), then a private one may be paused for want of a slot
 * (ADR-0073). The statement comes first because the label, and with it the cuisine requirement, is derived from it. A save gap
 * comes before the slot pause because a recipe that cannot be saved uses no slot. Last of the reasons that hold an item, an
 * item the save HELD for a reason none of these names (a create refusal the pre-check did not predict, or a payload the save
 * cannot read) is `saveRefused`, read from the hold's recorded REASON while it still applies to this cook (`importHold.ts`),
 * so it never stalls with no issue and never names a hold whose cause is gone. It comes before the slot pause because a held
 * item is out of the queue whether or not a slot frees.
 */
import type { ImportStage } from '../../database/schema/recipeImports.js';
import type { ImportRefusal } from './importRefusal.js';
import type { ImportSaveGap } from './importSaveGap.js';

/** The issue key for each thing the save still needs. */
const SAVE_GAP_ISSUES = {
    cuisine: 'needsCuisine',
    servings: 'needsServings',
    times: 'needsTimes',
} as const satisfies Record<ImportSaveGap, string>;

/** One issue key. A closed set for the service; the wire carries it as an opaque string. */
export type ItemIssue =
    | ImportRefusal
    | 'waitingForAllowance'
    | 'needsStatement'
    | 'visibilityRefused'
    | (typeof SAVE_GAP_ISSUES)[ImportSaveGap]
    | 'saveRefused'
    | 'outOfSlots';

/** What the issue is derived from. */
export interface ItemIssueFacts {
    readonly stage: ImportStage;
    /** Why the import refused the recipe (`importRefusalOf`, stored at write time), or `null`. */
    readonly refusal: ImportRefusal | null;
    /** Whether the cook has said where the recipe came from. */
    readonly hasStatement: boolean;
    /** Whether the visibility policy refuses this recipe's requested visibility for the label its statement sets. */
    readonly visibilityRefused: boolean;
    /** Whether the recipe would be saved private. */
    readonly private: boolean;
    /** Whether the cook has no private slot left (derived from the live count; ADR-0073 §8). */
    readonly outOfSlots: boolean;
    /** Whether the item spent its allowance unit. */
    readonly paid: boolean;
    /** Whether the caller's bulk allowance has no unit left today. */
    readonly allowanceSpent: boolean;
    /** The first thing the save still needs (`importSaveGapOf`), or `null`. */
    readonly saveGap: ImportSaveGap | null;
    /** Whether the save holds the item for a create refusal or an unreadable payload, still applying (`isSaveRefusedHold`). */
    readonly saveRefusedHold: boolean;
}

/**
 * The issue that keeps an item from being saved, if any.
 *
 * @param facts - Where the item stands and what is true of it now.
 * @returns The issue key, or `null`. Pure and total.
 */
export function importItemIssueOf(facts: ItemIssueFacts): ItemIssue | null {
    if (facts.stage === 'saved') {
        return null;
    }

    // A refused recipe is never paid for, parsed or saved, so its reason is the only one that is true of it.
    if (facts.refusal !== null) {
        return facts.refusal;
    }

    if (facts.stage === 'received' && !facts.paid && facts.allowanceSpent) {
        return 'waitingForAllowance';
    }

    if (facts.stage !== 'matched') {
        return null;
    }

    if (!facts.hasStatement) {
        return 'needsStatement';
    }

    if (facts.visibilityRefused) {
        return 'visibilityRefused';
    }

    if (facts.saveGap !== null) {
        return SAVE_GAP_ISSUES[facts.saveGap];
    }

    if (facts.saveRefusedHold) {
        return 'saveRefused';
    }

    return facts.private && facts.outOfSlots ? 'outOfSlots' : null;
}
