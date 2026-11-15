/**
 * @module cookingViewProps — the props contract of cooking mode, shared by the web (`*.tsx`) and native
 * (`*.native.tsx`) leaves so both platforms expose one API. It holds the screen's props (what the route adapter hands
 * `CookingScreen`) and the step body's props. Every string here is already localised and filled by the orchestration
 * layer: a render component never formats copy.
 *
 * A platform-only fact stays out of it: native's under-360 width is a native prop its own screen adds, because web's
 * container query covers it.
 */
import type { CookLinkInput } from '@kitchensink/cooking-core';

import type { UseCookingSessionInput } from './useCookingSession.js';

/** The recipe as the screen cooks it: what the session reads, the title Done names, and the status the link reads. */
export interface CookingRecipe {
    readonly id: string;
    readonly title: string;
    readonly status: CookLinkInput['status'];
    readonly steps: UseCookingSessionInput['steps'];
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
