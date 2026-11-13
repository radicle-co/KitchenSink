/**
 * @module @commise/features-cooking/messages — the copy cooking mode says on both platforms, for the states the first cooking screen draws.
 * Copy the two apps say identically lives here, in the feature package, and each shell reads it
 * through `useMessages(cookingMessages)`. A count is a `{ one, other }` pair with `{count}`, chosen by the shell's
 * view-model with `Intl.PluralRules`. The `en` set is required; adding a locale is another key.
 */
import type { LocalizedMessages, PluralText } from '@commise/i18n';

/** The top bar: Exit. */
export interface CookingTopMessages {
    /** Visible label of Exit. It stays, even under 360 wide. */
    readonly exit: string;
    /** The one accessible name of Exit, which shows the × and the label together. */
    readonly exitA11y: string;
    /** The place, "Step 2 of 6" (contains `{current}` and `{total}`). Also the step region's name. */
    readonly place: string;
}

/** Back and Next step. */
export interface CookingNavMessages {
    /** Visible label of Back, on every step. */
    readonly back: string;
    /** Back's accessible name on step 1: it leaves to the recipe page. */
    readonly backA11yRecipe: string;
    /** Back's accessible name from step n+1 (contains `{n}`, the step it goes to). */
    readonly backA11y: string;
    /** Visible label of Next step. */
    readonly next: string;
    /** Next step's accessible name (contains `{n}`, the step it goes to). */
    readonly nextA11y: string;
    /** Next on the last step. */
    readonly finish: string;
    /** The filled action once every line is ticked (contains `{n}`). */
    readonly startStep: string;
    /** The one-line preview of the next step above the pair (contains `{n}`). */
    readonly nextPreview: string;
}

/** A step and its lines. */
export interface CookingStepMessages {
    /** "Line 1 of 3", shown only when a step has more than one line (contains `{current}` and `{total}`). */
    readonly lineOf: string;
    /** The collapsed record of ticked lines (each contains `{count}` or says one). */
    readonly tickedSummary: PluralText;
    /** The control that opens the ticked lines. */
    readonly show: string;
    /** The polite announcement on a step change, with the focus line (contains `{current}`, `{total}` and `{line}`). */
    readonly announce: string;
    /** The same when every line is ticked and there is no focus line to read (contains `{current}` and `{total}`). */
    readonly announceNoLine: string;
}

/** Next coming: every line of the step is ticked. */
export interface CookingNextMessages {
    /** The overline above the filled action (contains `{n}`). */
    readonly upNext: string;
}

/** Done. */
export interface CookingDoneMessages {
    /** The heading (contains `{total}`). */
    readonly title: string;
    /** The line under it (contains `{recipe}`). */
    readonly enjoy: string;
    /** Said only where the screen was kept on. */
    readonly screenOff: string;
    /** The filled action. */
    readonly backToRecipe: string;
    /** The quiet action. */
    readonly cookAgain: string;
}

/** Loading. */
export interface CookingLoadingMessages {
    /** The place while the recipe loads. */
    readonly place: string;
    /** Added after one second. */
    readonly label: string;
}

/** The load error. */
export interface CookingErrorMessages {
    readonly title: string;
    /** The body when the device is online. There are no timers yet, so it has no timer sentence. */
    readonly body: string;
    /** The body when the device is offline and the recipe is not stored. */
    readonly offlineBody: string;
    readonly retry: string;
    readonly back: string;
}

/** A recipe with no steps. */
export interface CookingEmptyMessages {
    readonly title: string;
    /** The owner's body. */
    readonly body: string;
    /** Another cook's body. */
    readonly bodyOther: string;
    /** The owner's filled action. */
    readonly edit: string;
    readonly back: string;
}

/** A recipe that cannot be read any more. It never says why. */
export interface CookingGoneMessages {
    readonly title: string;
    readonly home: string;
}

/** Every string the cooking surface says. */
export interface CookingMessages {
    readonly top: CookingTopMessages;
    readonly nav: CookingNavMessages;
    readonly step: CookingStepMessages;
    readonly next: CookingNextMessages;
    readonly done: CookingDoneMessages;
    readonly loading: CookingLoadingMessages;
    readonly error: CookingErrorMessages;
    readonly empty: CookingEmptyMessages;
    readonly gone: CookingGoneMessages;
}

export const cookingMessages: LocalizedMessages<CookingMessages> = {
    en: {
        top: {
            exit: 'Exit',
            exitA11y: 'Exit cooking mode',
            place: 'Step {current} of {total}',
        },
        nav: {
            back: 'Back',
            backA11yRecipe: 'Back to the recipe',
            backA11y: 'Back to step {n}',
            next: 'Next step',
            nextA11y: 'Next step, step {n}',
            finish: 'Finish',
            startStep: 'Start step {n}',
            nextPreview: 'Next · step {n}',
        },
        step: {
            lineOf: 'Line {current} of {total}',
            tickedSummary: { one: 'You ticked 1 line', other: 'You ticked {count} lines' },
            show: 'Show',
            announce: 'Step {current} of {total}. {line}',
            announceNoLine: 'Step {current} of {total}.',
        },
        next: {
            upNext: 'Up next · step {n}',
        },
        done: {
            title: 'All {total} steps done',
            enjoy: '{recipe}. Enjoy it.',
            screenOff: 'The screen can turn off again.',
            backToRecipe: 'Back to the recipe',
            cookAgain: 'Cook it again',
        },
        loading: {
            place: 'Step –',
            label: 'Opening the recipe…',
        },
        error: {
            title: 'We couldn’t open this recipe',
            body: 'Check your connection, then try again.',
            offlineBody: 'You’re offline, and this recipe isn’t saved on this device yet.',
            retry: 'Try again',
            back: 'Back to the recipe',
        },
        empty: {
            title: 'This recipe has no steps yet',
            body: 'Cooking mode walks you through the steps one at a time. Add some to cook from it here.',
            bodyOther: 'Its cook hasn’t added any steps.',
            edit: 'Edit recipe',
            back: 'Back to the recipe',
        },
        gone: {
            title: 'This recipe isn’t available any more',
            home: 'Go to Home',
        },
    },
};
