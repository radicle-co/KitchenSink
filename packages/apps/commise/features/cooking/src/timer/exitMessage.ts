/**
 * @module exitMessage — what cooking mode says when the cook leaves with a timer of this recipe still counting or
 * paused. A pure rule, so the web and the phone say the same thing for the same state and only the sentence about
 * where the timer rings differs.
 *
 * @pattern Specification — one pure predicate over the timer state decides whether, and what, to say
 */
import { fillTemplate } from '@commise/i18n';
import { timeLeftMs, timerOrder } from '@kitchensink/cooking-core';
import type { ActiveTimer, TimerState } from '@kitchensink/cooking-core';

import type { CookingRecipe } from '../cookingViewProps.js';
import type { CookingMessages } from '../messages.js';
import { timerLabel } from './timerCopy.js';
import { timerStepOf } from './timerStep.js';

/**
 * How long the exit message stays, in ms. Two sentences take about this long to read (designer); the house Undo
 * default (`DEFAULT_SNACKBAR_MS`) is shorter and is left alone.
 */
export const EXIT_MESSAGE_MS = 8000;

/** What {@link exitMessageOf} reads. */
export interface ExitMessageInput {
    readonly state: TimerState;
    /** The recipe id of the route: only this recipe's timer counts, so it is known also while the recipe loads. */
    readonly recipeId: string;
    /** The recipe once it is read, to name an offered timer by its line; `undefined` while it loads. */
    readonly recipe: Pick<CookingRecipe, 'id' | 'steps'> | undefined;
    readonly copy: Pick<CookingMessages, 'exit' | 'timer'>;
    /** The sentence for a running timer: the platform says where it rings. */
    readonly running: string;
    readonly nowMs: number;
}

/** The first timer of this recipe the cook would want to hear about: running with time left, else paused. */
function timerToMention(input: ExitMessageInput): ActiveTimer | undefined {
    const ofThisRecipe = timerOrder(input.state).flatMap((entry) =>
        entry.kind === 'live' && entry.timer.recipeId === input.recipeId ? [entry.timer] : [],
    );

    return (
        ofThisRecipe.find((timer) => timer.kind === 'running' && timeLeftMs(timer, input.nowMs) > 0) ??
        ofThisRecipe.find((timer) => timer.kind === 'paused')
    );
}

/**
 * The exit message, or nothing to say.
 *
 * @param input - The timer state, the route's recipe id, the recipe if read, the copy, the running sentence and now.
 * @returns A sentence naming the timer by its typed label, else by its line, else by its step; `undefined` when no
 *   timer of this recipe is running with time left or paused. A ringing or ended-away timer already has the cook's
 *   attention. Pure.
 */
export function exitMessageOf(input: ExitMessageInput): string | undefined {
    const timer = timerToMention(input);

    if (timer === undefined) {
        return undefined;
    }

    const label = timerLabel(timer, timerStepOf(timer, input.recipe), input.copy.timer);

    return fillTemplate(timer.kind === 'running' ? input.running : input.copy.exit.timerPaused, { label });
}
