/**
 * @module @commise/features-recipes/import — the prop contracts of bulk import's matching components, shared by each
 * web leaf and its `.native.tsx` sibling so the two platforms implement one surface (`docs/CODING_STANDARDS.md` §14).
 *
 * Every component here is presentational and controlled: what is open, what is chosen and what a press does are the
 * host's (the wiring phase's orchestration, after the server contract lands). No prop here is a wire type.
 */
import type { ReactNode } from 'react';

import type { ImportCandidate, ImportLine, ImportLinePick, PickableImportLine } from './importLine.js';
import type { ImportMatchMode } from './importMode.js';

/** The mode choice before a bulk import (board ImportModeChoice). */
export interface ImportModeChoiceProps {
    /** The imported file's name ("My Recipes.paprikarecipes"). */
    readonly fileName: string;
    /** The app the file came from ("Paprika"). */
    readonly sourceName: string;
    /** How many recipes the file holds. */
    readonly recipeCount: number;
    /** The chosen mode, or `undefined`: nothing is preselected. */
    readonly mode: ImportMatchMode | undefined;
    /** The cook chose a mode. The component keeps no choice of its own. */
    readonly onModeChange: (mode: ImportMatchMode) => void;
    /** Start the import. Never called while no mode is chosen. */
    readonly onStart: () => void;
    /** The start request is in flight. */
    readonly starting?: boolean;
}

/** A line's option list: Search for a food first, then the candidates, then Keep … as written. */
export interface ImportLineOptionsProps {
    /** The line as written; names the list, the search button and the keep row. */
    readonly lineText: string;
    /** The server's candidates, in its order (the default first); drawn in that order, never re-sorted. */
    readonly candidates: readonly ImportCandidate[];
    /** The cook's pick, if any. A default is never passed here unless the cook picked it. */
    readonly pick: ImportLinePick | undefined;
    /** The cook chose a food or to keep the line as written. */
    readonly onPick: (pick: ImportLinePick) => void;
    /** Open food search for this line. */
    readonly onSearch: () => void;
}

/** The one expanded line of a recipe: its text, its neutral prompt and its option list. */
export interface ImportOpenLineProps {
    readonly line: PickableImportLine;
    readonly onPick: (key: string, pick: ImportLinePick) => void;
    readonly onSearch: (key: string) => void;
}

/** A line drawn closed: a matched, chosen or checking line, or an open line waiting its turn. */
export interface ImportLineRowProps {
    readonly line: ImportLine;
    /** Expand the line (a closed open line, or Change on a matched or chosen line). */
    readonly onExpand: (key: string) => void;
    /** Bind a checking line's proposed food. */
    readonly onUseProposal: (key: string) => void;
    /** Open food search for the line (a checking line reaches it in one tap). */
    readonly onSearch: (key: string) => void;
    /** Open why the late check suggested another food. */
    readonly onSeeWhy: (key: string) => void;
}

/**
 * A recipe's lines, one open line expanded at a time (`ingredientMatching.md`: phone and tablet; the wizard keeps the
 * same list beside its recipe rail at 1194 and on web).
 *
 * ⚠️ Reconcile with the paste flow's line list at merge: the editor builder is building the same row states for paste
 * import in parallel, and this list must not survive as a second copy.
 */
export interface ImportLineListProps extends Omit<ImportLineRowProps, 'line'> {
    /** The recipe's lines, in the recipe's order. */
    readonly lines: readonly ImportLine[];
    /** The line drawn expanded, or `undefined` for none. A checking line is never drawn expanded. */
    readonly expandedKey: string | undefined;
    /** The cook picked for the expanded line. Expanding the next open line is the host's (`nextOpenLineKey`). */
    readonly onPick: (key: string, pick: ImportLinePick) => void;
}

/** One step of the review wizard (board WizardStep): the recipe, its progress, its lines and the step's actions. */
export interface ImportWizardStepProps {
    /** The recipe under review: the step's heading. */
    readonly recipeTitle: string;
    /** This recipe's place among the recipes to review, from 1. */
    readonly position: number;
    /** Recipes to review in all. */
    readonly total: number;
    /** Lines still needing the cook (`openLineCount`). */
    readonly openLines: number;
    /** The recipe's line list. */
    readonly children: ReactNode;
    /** The recipe rail, drawn beside the step at the wide container class (1194 and web) and nowhere else. */
    readonly rail?: ReactNode;
    /** Return to the recipe before. Not offered on the first recipe. */
    readonly onBack: () => void;
    /** Leave this recipe's open lines as they are and move on. */
    readonly onSkip: () => void;
    /** Move to the next recipe with an open line. */
    readonly onNext: () => void;
    /** Ask to save and leave (the host opens `ImportWizardLeave`). */
    readonly onSaveAndLeave: () => void;
}

/** One recipe in the rail. */
export interface ImportRailRecipe {
    readonly id: string;
    readonly title: string;
    readonly skipped: boolean;
}

/** The wizard's recipe rail at 1194 and on web: a window of the recipes to review, the current one marked. */
export interface ImportReviewRailProps {
    /** All recipes to review (the count in the title). */
    readonly total: number;
    /** The window of recipes shown, in order. */
    readonly recipes: readonly ImportRailRecipe[];
    /** The recipe the step shows. */
    readonly currentId: string;
    /** Recipes added without a step. `0` hides the line. */
    readonly addedWithoutStep: number;
    /** Jump the review to a recipe. */
    readonly onOpenRecipe: (id: string) => void;
}

/** What the wizard says when it cannot show a step (board WizardStates). */
export type ImportWizardNoticeProps =
    | {
          /** The next recipe is being read. */
          readonly kind: 'loading';
          /** The recipe being read, from 1. */
          readonly position: number;
          /** Recipes to review in all. */
          readonly total: number;
      }
    | {
          /** The recipe could not be loaded. */
          readonly kind: 'error';
          /** The recipe that failed. */
          readonly recipeTitle: string;
          /** Load it again. */
          readonly onRetry: () => void;
          /** Move on without it; it waits under "To review". */
          readonly onSkip: () => void;
      }
    | { readonly kind: 'offline' };

/** Save and leave (board WizardLeave). */
export interface ImportWizardLeaveProps {
    /** Whether the dialog is shown; `false` renders nothing. */
    readonly open: boolean;
    /** Recipes the cook has reviewed so far. */
    readonly reviewed: number;
    /** Recipes to review in all; the rest (`total - reviewed`) are saved now. */
    readonly total: number;
    /** The recipe the review resumes at, from 1. */
    readonly resumeAt: number;
    /** Close the dialog and keep reviewing; every close route ends here. */
    readonly onKeepReviewing: () => void;
    /** Save the rest and leave the review. */
    readonly onConfirm: () => void;
    /** The save is in flight. */
    readonly saving?: boolean;
}

/** The end of an import (board WizardSummary). Every count of `0` hides its row. */
export interface ImportSummaryProps {
    /** The app the library came from. */
    readonly sourceName: string;
    /** When the import finished, already formatted for the reader's locale ("today at 11:20"). */
    readonly finishedWhen: string;
    /** Recipes added in all. */
    readonly added: number;
    /** Recipes added without a step. */
    readonly neededNothing: number;
    /** Recipes the cook reviewed in the wizard. */
    readonly reviewed: number;
    /** Recipes the cook skipped; they wait under "To review". */
    readonly skipped: number;
    /** Recipes matched to ones the cook already has, so not added again. */
    readonly alreadyHere: number;
    /** Titles of the recipes that could not be read. */
    readonly unreadable: readonly string[];
    /** Lines kept as written, with no food, so not counted toward nutrition. */
    readonly asWrittenLines: number;
    /** The recipes those lines are in. */
    readonly asWrittenRecipes: number;
    /** Recipes with every ingredient counted, drawn beside the summary at the wide container class. */
    readonly countedRecipes: number;
    /** Open the added recipes. */
    readonly onSeeAdded: () => void;
    /** Open the recipes that could not be read. */
    readonly onFixUnreadable: () => void;
    /** Open the lines kept as written, to choose their foods. */
    readonly onChooseFoods: () => void;
}

/** One line the save-time check doubts. */
export interface ImportFlaggedLineItem {
    readonly key: string;
    /** The line as written. */
    readonly text: string;
    readonly recipeTitle: string;
    /** The food the best match bound and the check doubts. */
    readonly matchedFood: string;
    /** The food the row offers instead, if the check has one. */
    readonly suggestion?: { readonly foodId: string; readonly name: string };
}

/** "N to check" (board FlaggedLine). */
export interface ImportFlaggedListProps {
    /** Every doubted line (the count in the title); `lines` may be a page of them. */
    readonly total: number;
    /** The doubted lines shown. */
    readonly lines: readonly ImportFlaggedLineItem[];
    /** Bind the line to its suggestion. */
    readonly onUseSuggestion: (key: string) => void;
    /** Open the line's options: the sheet on phone and 834, the pane at 1194 and on web. */
    readonly onSearch: (key: string) => void;
    /** The open line's options, drawn beside the list at the wide container class. */
    readonly detail?: ReactNode;
}

/** The line's options in a sheet (phone and 834): the same list the wide pane shows, search first. */
export interface ImportLineOptionsSheetProps extends ImportLineOptionsProps {
    /** Whether the sheet is shown. */
    readonly open: boolean;
    /** Every close route calls this with `false`. */
    readonly onOpenChange: (open: boolean) => void;
    /** The sheet's title: the line and its recipe. */
    readonly title: string;
}

/** The line's options in the pane beside the flagged list (1194 and web): the same list as the sheet, search first. */
export interface ImportLineOptionsPaneProps extends ImportLineOptionsProps {
    /** The pane's heading: the line and its recipe. */
    readonly title: string;
}
