/**
 * @module @commise/features-recipes/import — the prop contracts of bulk import's matching components, shared by each
 * web leaf and its `.native.tsx` sibling so the two platforms implement one surface (`docs/CODING_STANDARDS.md` §14).
 *
 * Every component here is presentational and controlled: what is open, what is chosen and what a press does are the
 * host's (the wiring phase's orchestration, after the server contract lands). No prop here is a wire type.
 */
import type { ReactNode } from 'react';

import type { ControlFocus } from '../common/controlFocus.js';
import type { FoodChoiceListProps } from '../ingredientMatching/foodChoiceListProps.js';
import type { MatchLine, PendingSend } from '../ingredientMatching/matchLine.js';
import type { MatchLineListProps } from '../ingredientMatching/matchLineListProps.js';
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

/**
 * A recipe's lines in the review wizard: the ONE shared matched-line list (`MatchLineList`, which the editor's paste
 * flow draws too), one open line expanded at a time, and the recipe-with-nothing-to-fix sentence above it.
 */
export type ImportLineListProps = MatchLineListProps;

/** One step of the review wizard (board WizardStep): the recipe, its progress, its lines and the step's actions. */
export interface ImportWizardStepProps {
    /** The recipe under review: the step's heading. */
    readonly recipeTitle: string;
    /** This recipe's place among the recipes to review, from 1. */
    readonly position: number;
    /** Recipes to review in all. */
    readonly total: number;
    /** Lines to choose: default, needsChoice and noMatch with nothing bound (`matchCountsOf(lines).choose`). */
    readonly openLines: number;
    /** Lines still being checked, counted on their own (`matchCountsOf(lines).checking`). */
    readonly checkingLines: number;
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
    /**
     * A request that Next recipe take focus: raised by the host when a pick leaves nothing open (`pickFocusOf` answers
     * `done`; staff-ux 2026-10-25).
     */
    readonly nextFocus: ControlFocus;
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
    /**
     * What the host is sending, by line: "Use {food}" is a `useProposal` and reads busy on its Use; any send refuses
     * both of the line's controls, so a double press cannot send twice (M5).
     */
    readonly pending: ReadonlyMap<string, PendingSend>;
    /** Bind the line to its suggestion. The host raises its pending send in this call. */
    readonly onUseSuggestion: (key: string) => void;
    /** Choose another: open the line's options, search first — the sheet on phone and 834, the pane at 1194 and web. */
    readonly onChooseAnother: (key: string) => void;
    /** The open line's options, drawn beside the list at the wide container class. */
    readonly detail?: ReactNode;
}

/**
 * A flagged line's options: the ONE shared food-choice list (`FoodChoiceList`), search first, built from the line the
 * way every matched line's list is (`choiceListViewOf`).
 */
export interface ImportLineOptionsProps extends Omit<FoodChoiceListProps, 'view'> {
    /** The line whose options are shown. */
    readonly line: MatchLine;
    /** Whether search can run. */
    readonly online: boolean;
    /** The pick in flight for this line, if any. */
    readonly pending: PendingSend | undefined;
}

/** A flagged line's options in a sheet (phone and 834). */
export interface ImportLineOptionsSheetProps extends ImportLineOptionsProps {
    /** Whether the sheet is shown. */
    readonly open: boolean;
    /** Every close route calls this with `false`. */
    readonly onOpenChange: (open: boolean) => void;
    /** The sheet's title: the line and its recipe. */
    readonly title: string;
}

/** A flagged line's options in the pane beside the flagged list (1194 and web): the same list as the sheet. */
export interface ImportLineOptionsPaneProps extends ImportLineOptionsProps {
    /** The pane's heading: the line and its recipe. */
    readonly title: string;
}
