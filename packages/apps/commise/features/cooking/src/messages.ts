/**
 * @module messages — the copy cooking mode says on both platforms, for the states the first cooking screen draws.
 * Copy the two apps say identically lives here, in the feature package, and each shell reads it
 * through `useMessages(cookingMessages)`. A count is a `{ one, other }` pair with `{count}`, chosen by the shell's
 * view-model with `Intl.PluralRules`. The `en` set is required; adding a locale is another key.
 */
import type { LocalizedMessages, PluralText } from '@commise/i18n';

/** The top bar: Exit. */
interface CookingTopMessages {
    /** Visible label of Exit. It stays, even under 360 wide. */
    readonly exit: string;
    /** The one accessible name of Exit, which shows the × and the label together. */
    readonly exitA11y: string;
    /** The place, "Step 2 of 6" (contains `{current}` and `{total}`). Also the step region's name. */
    readonly place: string;
    /** The control that opens the ingredients list. */
    readonly ingredients: string;
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
interface CookingStepMessages {
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
    /**
     * Under the step when the cook scales the recipe (contains `{base}` and `{servings}`). Plain text, no link inside.
     */
    readonly scaleNote: string;
    /** The quiet button under the scale note that opens the ingredients list. Its name is this label. */
    readonly scaleNoteOpen: string;
}

/** The ingredients list, held in a sheet over the step (phones) or a column beside it (tablets and wider). */
interface CookingIngredientsMessages {
    /** The title the frame draws: one item, or `{count}` items, for `{servings}` servings. */
    readonly title: PluralText;
    /** The accessible name of the sheet's × close. */
    readonly close: string;
    /** Clears every tick on the list. Not drawn while nothing is ticked. */
    readonly clear: string;
    /** The snackbar after Clear ticks; Undo restores the ticks. */
    readonly cleared: string;
}

/** Next coming: every line of the step is ticked. */
interface CookingNextMessages {
    /** The overline above the filled action (contains `{n}`). */
    readonly upNext: string;
}

/** Done. */
interface CookingDoneMessages {
    /** The heading: one form for a one-step recipe, and the other with `{count}` steps. */
    readonly title: PluralText;
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
interface CookingLoadingMessages {
    /** The place while the recipe loads. */
    readonly place: string;
    /** Shown from the `label` phase of `loadingPhase`. */
    readonly label: string;
}

/** The load error. */
interface CookingErrorMessages {
    readonly title: string;
    /** The body when the device is online. */
    readonly body: string;
    /** The body when the device is offline and the recipe is not stored. */
    readonly offlineBody: string;
    readonly retry: string;
    readonly back: string;
}

/** A recipe with no steps. */
interface CookingEmptyMessages {
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
interface CookingGoneMessages {
    readonly title: string;
    readonly home: string;
}

/** One row of All steps: its mark, and the plain text of its timers. */
export interface CookingAllStepsMessages {
    /** The mark of the step the session is on. */
    readonly now: string;
    /** The mark of a step the cook has finished. */
    readonly done: string;
    /** The mark of a step with every line ticked that the cook has not moved past. */
    readonly allTicked: string;
    /** The mark of a step with unticked lines: how many are left. */
    readonly linesLeft: PluralText;
    /** Timers that have ended and wait for the cook. */
    readonly timersDone: PluralText;
    readonly timersRunning: PluralText;
    readonly timersPaused: PluralText;
    /** What joins two timer parts. */
    readonly timerJoin: string;
}

/** The name of a timer: a label, or the step it was started on. */
export interface CookingTimerMessages {
    /** The name of a timer with no label (contains `{n}`, the step number, joined with a no-break space). */
    readonly stepLabel: string;
    /** A line label or step name told apart from its sibling on the same step (contains `{label}`, `{ordinal}`). */
    readonly ordinal: string;
}

/** A length of time: shown as digits and units, and spoken as words. */
export interface CookingDurationMessages {
    /** Shown, hours and minutes: "1 h 30" (contains `{h}`, `{m}`). The offer and shown times only. */
    readonly hoursMinutes: string;
    /** Shown and rang-ago: "2 h" (contains `{h}`). */
    readonly hoursOnly: string;
    /** Shown and rang-ago: "25 min" (contains `{m}`). */
    readonly minutesOnly: string;
    /** Shown: "30 sec" (contains `{s}`). */
    readonly secondsOnly: string;
    /** Rang-ago only: "1 h 5 min" (contains `{h}`, `{m}`). */
    readonly hoursMinutesAgo: string;
    /** Spoken words, one part each. */
    readonly hours: PluralText;
    readonly minutes: PluralText;
    readonly seconds: PluralText;
}

/** The alarm that rings when a timer ends. */
export interface CookingAlarmMessages {
    /** Under a minute since the end (contains `{label}`). */
    readonly rangJustNow: string;
    /** From a minute since the end (contains `{label}`, `{elapsed}`). */
    readonly rangAgo: string;
    /** The headline when the line gives no check text (contains `{duration}`). */
    readonly headlineFallback: string;
    /** The body when the line gives none (contains `{n}`, joined to "Step" with a no-break space, and `{line}`). */
    readonly bodyFallback: string;
}

/** The boxes of Add a timer: an accessible name and a unit for each. */
export interface CookingAddTimerMessages {
    readonly hoursLabel: string;
    readonly minutesLabel: string;
    readonly secondsLabel: string;
    readonly hoursUnit: string;
    readonly minutesUnit: string;
    readonly secondsUnit: string;
}

/** Every string the cooking surface says. */
export interface CookingMessages {
    readonly top: CookingTopMessages;
    readonly nav: CookingNavMessages;
    readonly step: CookingStepMessages;
    readonly ingredients: CookingIngredientsMessages;
    readonly next: CookingNextMessages;
    readonly done: CookingDoneMessages;
    readonly loading: CookingLoadingMessages;
    readonly error: CookingErrorMessages;
    readonly empty: CookingEmptyMessages;
    readonly gone: CookingGoneMessages;
    readonly allSteps: CookingAllStepsMessages;
    readonly timer: CookingTimerMessages;
    readonly duration: CookingDurationMessages;
    readonly alarm: CookingAlarmMessages;
    readonly addTimer: CookingAddTimerMessages;
}

export const cookingMessages: LocalizedMessages<CookingMessages> = {
    en: {
        top: {
            exit: 'Exit',
            exitA11y: 'Exit cooking mode',
            place: 'Step\u00a0{current} of {total}',
            ingredients: 'Ingredients',
        },
        nav: {
            back: 'Back',
            backA11yRecipe: 'Back to the recipe',
            backA11y: 'Back to step {n}',
            next: 'Next step',
            nextA11y: 'Next step, step {n}',
            finish: 'Finish',
            startStep: 'Start step\u00a0{n}',
            nextPreview: 'Next · step\u00a0{n}',
        },
        step: {
            lineOf: 'Line\u00a0{current} of {total}',
            tickedSummary: { one: 'You ticked 1 line', other: 'You ticked {count} lines' },
            show: 'Show',
            announce: 'Step {current} of {total}. {line}',
            announceNoLine: 'Step {current} of {total}.',
            scaleNote:
                'The steps give amounts for {base}. You\u2019re making {servings}, so use the amounts in Ingredients.',
            scaleNoteOpen: 'Open ingredients',
        },
        ingredients: {
            title: {
                one: 'Ingredients for {servings} \u00b7 1 item',
                other: 'Ingredients for {servings} \u00b7 {count} items',
            },
            close: 'Close ingredients',
            clear: 'Clear ticks',
            cleared: 'Ticks cleared',
        },
        next: {
            upNext: 'Up next · step\u00a0{n}',
        },
        done: {
            title: { one: 'All done', other: 'All {count} steps done' },
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
        allSteps: {
            now: 'Now',
            done: 'Done',
            allTicked: 'All lines ticked',
            linesLeft: { one: '{count} line left', other: '{count} lines left' },
            timersDone: { one: 'Timer done', other: '{count} timers done' },
            timersRunning: { one: 'Timer running', other: '{count} timers running' },
            timersPaused: { one: 'Timer paused', other: '{count} timers paused' },
            timerJoin: ' \u00b7 ',
        },
        timer: {
            stepLabel: 'Step\u00a0{n}',
            ordinal: '{label} ({ordinal})',
        },
        duration: {
            hoursMinutes: '{h} h {m}',
            hoursOnly: '{h} h',
            minutesOnly: '{m} min',
            secondsOnly: '{s} sec',
            hoursMinutesAgo: '{h} h {m} min',
            hours: { one: '{count} hour', other: '{count} hours' },
            minutes: { one: '{count} minute', other: '{count} minutes' },
            seconds: { one: '{count} second', other: '{count} seconds' },
        },
        alarm: {
            rangJustNow: '{label} timer \u00b7 rang just now',
            rangAgo: '{label} timer \u00b7 rang {elapsed} ago',
            headlineFallback: '{duration} timer done',
            bodyFallback: 'Step\u00a0{n}: {line}',
        },
        addTimer: {
            hoursLabel: 'Hours',
            minutesLabel: 'Minutes',
            secondsLabel: 'Seconds',
            hoursUnit: 'h',
            minutesUnit: 'min',
            secondsUnit: 'sec',
        },
    },
};
