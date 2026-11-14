/**
 * The facts one import item's issue is derived from (`importItemIssueOf`), built in ONE place for the save and the item list
 * (review L2 on #220). Each had its own copy, and their guards had drifted: only the list judged no refusal for a saved item
 * and no save gap for an unmatched one.
 *
 * DESIGN PATTERN: **Specification input builder**, pure. It also answers the save reading (`importSaveGapOf`), so the save
 * sends the facts the issue was judged on and never resolves them a second time.
 */
import type { ImportItem } from '../dal/recipeImportItems.dal.js';
import type { ImportVisibility } from '../dal/recipeImports.dal.js';
import { cookKeyOf, isSaveRefusedHold } from './importHold.js';
import type { ItemIssueFacts } from './importItemIssue.js';
import { importRefusalOf } from './importRefusal.js';
import { importSaveFactsOf, importSaveGapOf, type ImportFileFacts, type ImportSaveReading } from './importSaveGap.js';
import type { KnownImportStatement } from './importStatement.js';
import { visibilityRefusedFor, type VisibilityFacts } from './importVisibility.js';

/** What the issue facts are built from. */
export interface ItemIssueInput {
    readonly item: Pick<
        ImportItem,
        | 'stage'
        | 'refusal'
        | 'allowanceSpentAt'
        | 'heldAtRev'
        | 'decisionRev'
        | 'heldReason'
        | 'heldCookKey'
        | 'cuisine'
        | 'servings'
        | 'prepTimeMinutes'
        | 'cookTimeMinutes'
    >;
    /** What the cook said about the recipe, or `undefined` when nothing yet. */
    readonly statement: KnownImportStatement | undefined;
    /** The visibility the item would be saved with: its own, else the import's. */
    readonly requested: ImportVisibility;
    /** The cook, as the visibility policy reads them. */
    readonly cook: VisibilityFacts;
    /** What the recipe file states: the save facts and its counts (the list reads them in SQL, the save from the payload). */
    readonly saveFacts: {
        readonly file: ImportFileFacts;
        readonly ingredientLineCount: number;
        readonly stepCount: number;
    };
    readonly outOfSlots: boolean;
    readonly allowanceSpent: boolean;
}

/**
 * The issue facts of one item, and the save reading when it has one to judge.
 *
 * @param input - The item, the cook and the file.
 * @returns `facts` for `importItemIssueOf`, and `reading` (the gap or the facts the create sends) for a matched, stated,
 *   unrefused item; `undefined` for any other. Pure.
 */
export function itemIssueFactsOf(input: ItemIssueInput): {
    readonly facts: ItemIssueFacts;
    readonly reading: ImportSaveReading | undefined;
} {
    const { item, statement, requested, saveFacts } = input;
    const counts = { ingredientLineCount: saveFacts.ingredientLineCount, stepCount: saveFacts.stepCount };
    // The stored refusal, else the one the counts state: a payload that slipped past the upload's refusal is named for what it
    // lacks. A saved item's payload is gone, so its counts say nothing.
    const refusal = item.refusal ?? (item.stage === 'saved' ? null : importRefusalOf(counts));
    // Only a matched, stated, unrefused item has a save gap to judge (`importSaveGapOf` throws for a refused one, a defect).
    const reading =
        statement === undefined || item.stage !== 'matched' || refusal !== null
            ? undefined
            : importSaveGapOf({ statement, ...importSaveFactsOf(item, saveFacts.file), ...counts });

    return {
        facts: {
            stage: item.stage,
            refusal,
            hasStatement: statement !== undefined,
            visibilityRefused: statement !== undefined && visibilityRefusedFor(input.cook, statement, requested),
            private: requested === 'private',
            outOfSlots: input.outOfSlots,
            paid: item.allowanceSpentAt !== null,
            allowanceSpent: input.allowanceSpent,
            saveGap: reading !== undefined && 'gap' in reading ? reading.gap : null,
            saveRefusedHold: isSaveRefusedHold(item, cookKeyOf(input.cook)),
        },
        reading,
    };
}
