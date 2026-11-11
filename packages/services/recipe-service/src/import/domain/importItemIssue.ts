/**
 * Why an item cannot be saved yet, as the opaque key the clients localize (the contract's `issue.reason`).
 *
 * DESIGN PATTERN: **Specification / Policy module**, pure and total. DERIVED at read time and never stored: a stored issue is
 * wrong the moment the cook fixes it, the same reason "flagged" is not stored (ADR-0072 §6). The stage enum is closed and
 * parsed strictly by installed clients, so a new stuck state arrives as a new key here and never as a new stage.
 *
 * Precedence, first match wins: a saved item has none; an unpaid item waits for the allowance; then a matched item needs
 * its statement, then its visibility must be allowed for the label the statement sets, then it must have what Publish needs
 * (ADR-0072 §3 as amended 2026-11-11), then a private one may be paused for want of a slot (ADR-0073). The statement comes
 * first because the label, and with it the cuisine requirement, is derived from it. A publish gap comes before the slot
 * pause because a recipe that cannot be saved uses no slot.
 */
import type { PublishRequirement } from '@kitchensink/recipe-core';

import type { ImportStage } from '../../database/schema/recipeImports.js';

/** The issue key for each publish requirement the recipe still lacks. */
const PUBLISH_GAP_ISSUES = {
    cuisine: 'needsCuisine',
    ingredients: 'needsIngredients',
    steps: 'needsSteps',
} as const satisfies Record<PublishRequirement, string>;

/** One issue key. A closed set for the service; the wire carries it as an opaque string. */
export type ItemIssue =
    | 'waitingForAllowance'
    | 'needsStatement'
    | 'visibilityRefused'
    | (typeof PUBLISH_GAP_ISSUES)[PublishRequirement]
    | 'outOfSlots';

/** What the issue is derived from. */
export interface ItemIssueFacts {
    readonly stage: ImportStage;
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
    /** The first thing Publish still needs (`importPublishGapOf`), or `null`. */
    readonly publishGap: PublishRequirement | null;
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

    if (facts.publishGap !== null) {
        return PUBLISH_GAP_ISSUES[facts.publishGap];
    }

    return facts.private && facts.outOfSlots ? 'outOfSlots' : null;
}
