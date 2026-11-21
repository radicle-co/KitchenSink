/**
 * @module cookingViewProps — the props of cooking mode: the screen's props (what the route adapter hands
 * `CookingScreen`), the step body's props and the props of the step leaves. The ingredients list's props live in
 * `ingredients/cookingIngredientsListProps.ts`. Every string here is already localised and filled by the screen: a
 * render component never formats copy.
 */
import type { CookLinkInput } from '@kitchensink/cooking-core';
import type { RecipeIngredientView } from '@kitchensink/recipe-core';
import type { ReactNode } from 'react';

import type { LoadingPhase } from './loadingPhase.js';
import type { UseCookingSessionInput } from './useCookingSession.js';

/** The recipe as the screen cooks it: what the session reads, the title Done names, and the status the link reads. */
export interface CookingRecipe {
    readonly id: string;
    readonly title: string;
    readonly status: CookLinkInput['status'];
    readonly steps: UseCookingSessionInput['steps'];
    /** The recipe's ingredient lines in stored order. Empty, never absent: "no ingredients" is a held fact. */
    readonly ingredients: readonly RecipeIngredientView[];
    /** The servings the recipe was authored with, the base of the cook's scaling. */
    readonly servings: number;
}

/**
 * Where the read of the recipe stands, as the route adapter knows it. `ready` needs the viewer KNOWN: until it is, the
 * adapter reports `pending`, so no cook-link decision is ever taken on a guess.
 */
export type CookingScreenRead =
    | { readonly kind: 'pending'; readonly retry: () => void }
    | { readonly kind: 'failed'; readonly offline: boolean; readonly retry: () => void }
    | { readonly kind: 'gone' }
    | { readonly kind: 'ready'; readonly recipe: CookingRecipe; readonly viewerIsOwner: boolean };

/** Props for `CookingScreen`, on both platforms. */
export interface CookingScreenProps {
    readonly read: CookingScreenRead;
    /** Exit, Back on step 1, and Back to the recipe: to the recipe page, by route, never by history. */
    readonly onLeave: () => void;
    /** To the editor, replacing the cook route: the owner's Edit recipe on a recipe with no steps, and where an owner's draft link goes. */
    readonly onEdit: () => void;
    /** Go to Home from a recipe that is gone. */
    readonly onHome: () => void;
}

/** A control the cook presses: its visible label, an optional fuller accessible name, and what it does. */
export interface CookingAction {
    /** The visible label. */
    readonly label: string;
    /** The accessible name, when it says more than the label. It always contains the label (WCAG 2.5.3). */
    readonly accessibilityLabel?: string;
    readonly onPress: () => void;
}

/** One line of a step, as a checkbox named by its text. */
export interface CookingLineView {
    /** Stable within the step: the line's index. */
    readonly key: string;
    readonly text: string;
    readonly checked: boolean;
    readonly onToggle: () => void;
}

/** Props for `CookingLineRow`: one line of a step, as the checkbox the cook ticks. */
export interface CookingLineRowProps {
    /** The line: its text, whether it is ticked, and what a press does. */
    readonly line: CookingLineView;
    /** `focus` is the line the cook is doing now, the loudest thing on screen. */
    readonly emphasis: 'focus' | 'other';
}

/** Props for `CookingTopBar`. */
export interface CookingTopBarProps {
    /** Exit: one control, the × and its label, with one accessible name. */
    readonly exit: CookingAction;
    /** The place, plain text ("Step 2 of 6"), `muted` while the recipe loads ("Step –"). Absent on Done. */
    readonly place?: { readonly text: string; readonly tone: 'ink' | 'muted' };
    /**
     * Ingredients: a quiet button with the `listChecks` glyph and its visible label, never an icon alone. Absent where
     * there is nothing to open: at L2 and L3, where the column is in view, and on a recipe with no ingredients.
     */
    readonly ingredients?: CookingAction;
}

/** Props for the step track: one segment per step. */
export interface CookingStepTrackProps {
    readonly total: number;
    /** The current step, 1-based. */
    readonly position: number;
}

/** The ticked lines of a step, collapsed behind one summary. */
export interface CookingTickedView {
    /** "You ticked 1 line". */
    readonly summary: string;
    /** The disclosure that opens the ticked lines. */
    readonly show: CookingAction;
    readonly expanded: boolean;
    readonly lines: readonly CookingLineView[];
}

/** The next step previewed in the pinned foot, above Back and Next, while a line of this step is unticked. */
export interface CookingPreviewView {
    /** "Next · step 3". */
    readonly overline: string;
    /** The next step's first line, as plain text. Shown on one line under 700 tall, never cut in its accessible text. */
    readonly line: string;
}

/** The next step in the body once every line of this step is ticked. It scrolls and is never cut. */
export interface CookingUpNextView {
    /** "Up next · step 3". */
    readonly overline: string;
    /** The next step's first line, at the focus size, as plain text. */
    readonly lead: string;
    /** Its other lines, as plain text. */
    readonly rest: readonly string[];
}

/** Props for the step body. */
export interface CookingStepProps {
    /** The region's accessible name: the place ("Step 2 of 6"). */
    readonly label: string;
    readonly track: CookingStepTrackProps;
    /** "Line 2 of 3"; absent for a one-line step and when every line is ticked. */
    readonly lineOf?: string;
    /** Absent when no line of the step is ticked. */
    readonly ticked?: CookingTickedView;
    /** The first unticked line; absent when every line is ticked. */
    readonly focus?: CookingLineView;
    /** The unticked lines after the focus line. */
    readonly then: readonly CookingLineView[];
    /** Once every line is ticked, the next step; absent otherwise and on the last step. */
    readonly upNext?: CookingUpNextView;
}

/** Props for `CookingNextPreview`: the next step, previewed in the pinned foot. */
export interface CookingNextPreviewProps {
    /** The next step's overline and first line. */
    readonly preview: CookingPreviewView;
}

/** How the forward control looks: quiet (Next step, Finish before every line is ticked) or filled (the action now). */
type CookingForwardTone = 'quiet' | 'filled';

/** Props for `CookingNav`: Back and the forward control, an equal pair with forward last. */
export interface CookingNavProps {
    /** Back: to the step before, or to the recipe on step 1. */
    readonly back: CookingAction;
    /** Forward: Next step, Start step n or Finish, and how it looks now. */
    readonly forward: CookingAction & { readonly tone: CookingForwardTone };
    /** While the recipe loads both are drawn and disabled. */
    readonly disabled: boolean;
}

/** Props for `CookingDone`: the body. Its actions are pinned in the foot, like Back and Next. */
export interface CookingDoneProps {
    /** "All 6 steps done": the page's h1, in the largeTitle role. */
    readonly title: string;
    /** "{recipe}. Enjoy it." */
    readonly enjoy: string;
    /** "The screen can turn off again.", only where the screen was kept on. */
    readonly screenOff?: string;
}

/** Props for `CookingDoneActions`: Done's two actions, pinned in the foot, each full width. */
export interface CookingDoneActionsProps {
    /** The filled action. */
    readonly backToRecipe: CookingAction;
    /** The outlined secondary action, under the filled one. */
    readonly cookAgain: CookingAction;
}

/** What the loading body shows: nothing at first, then the skeleton, then its label too. `slow` is the slow-load notice. */
type CookingLoadingPhase = Exclude<LoadingPhase, 'slow'>;

/** Props for `CookingLoading`. */
export interface CookingLoadingProps {
    /** How long the recipe has been loading, as what the body draws. */
    readonly phase: CookingLoadingPhase;
    /** "Opening the recipe…" */
    readonly label: string;
}

/** Props for `CookingFrame`: the full-screen surface and its three slots. */
export interface CookingFrameProps {
    /** The bar pinned at the top; `null` for a full-screen notice. */
    readonly topBar: ReactNode;
    /** The scrolling body between the bar and the foot. */
    readonly body: ReactNode;
    /**
     * Pinned at the foot of the column: the actions (Back and Next, or Done's two), with the Next preview above them while
     * there is one. The frame owns the spacing between the two. Absent for a full-screen notice.
     */
    readonly foot?: { readonly preview?: ReactNode; readonly actions: ReactNode };
    /** `aria-busy` on the surface while the recipe loads. */
    readonly busy: boolean;
}
