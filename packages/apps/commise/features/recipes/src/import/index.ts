/**
 * @module @commise/features-recipes/import — bulk import's ingredient matching surfaces, for the apps' orchestration to
 * compose: the mode choice, the review wizard (step, lines, rail, notices, Save and leave), the summary and the lines to
 * check, with the line model and rules the orchestration needs to drive them. The line model is the neutral
 * `ingredientMatching/` module's, which the editor's paste flow reads too; it is re-exported here because this is the
 * package's one door to the import surfaces.
 *
 * A package-export entry (the one kind of barrel this repo keeps). Every component resolves to its web or native leaf at
 * bundle time.
 */
export { ImportFlaggedList } from './ImportFlaggedList.js';
export { ImportLineList } from './ImportLineList.js';
export { ImportLineOptionsPane } from './ImportLineOptionsPane.js';
export { ImportLineOptionsSheet } from './ImportLineOptionsSheet.js';
export { ImportModeChoice } from './ImportModeChoice.js';
export { ImportReviewRail } from './ImportReviewRail.js';
export { ImportSummary } from './ImportSummary.js';
export { ImportWizardLeave } from './ImportWizardLeave.js';
export { ImportWizardNotice } from './ImportWizardNotice.js';
export { ImportWizardStep } from './ImportWizardStep.js';
export {
    isNothingToFix,
    isOpenLine,
    matchCountsOf,
    nextOpenLineKey,
    pickFocusOf,
} from '../ingredientMatching/matchLine.js';
export type {
    BoundBy,
    FoodChoice,
    LineBinding,
    LinePick,
    LineText,
    MatchCounts,
    MatchLine,
    PickFocus,
    ReviewNote,
} from '../ingredientMatching/matchLine.js';
export { IMPORT_MATCH_MODES } from './importMode.js';
export type { ImportMatchMode } from './importMode.js';
export type {
    ImportFlaggedLineItem,
    ImportFlaggedListProps,
    ImportLineListProps,
    ImportLineOptionsPaneProps,
    ImportLineOptionsSheetProps,
    ImportModeChoiceProps,
    ImportRailRecipe,
    ImportReviewRailProps,
    ImportSummaryProps,
    ImportWizardLeaveProps,
    ImportWizardNoticeProps,
    ImportWizardStepProps,
} from './props.js';
