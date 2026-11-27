/**
 * @module timerDockView — what the timer dock draws, worked out from the timer list: one row per timer of this recipe,
 * with its figure, its words and its control names, and whether the "Time ..." offer shows. Pure, so the web and the
 * phone draw the same rows.
 *
 * @pattern Presentation Model — the dock's leaves are props to JSX; every decision about what they say is made here.
 */
import { fillTemplate } from '@commise/i18n';
import { timeLeftMs } from '@kitchensink/cooking-core';
import type { ActiveTimer, TimerOrderEntry } from '@kitchensink/cooking-core';

import type { CookingRecipe } from '../cookingViewProps.js';
import type { CookingMessages } from '../messages.js';
import { countdownFigure, spokenDuration, timerNameOf } from './timerCopy.js';
import { timerStepOf } from './timerStep.js';

/** What every row says. */
interface DockRowBase {
    /** The timer's id: the row's key, and what its commands name. */
    readonly id: string;
    /** The run the row was drawn for, so a press on a stale row is harmless. */
    readonly run: number;
    readonly figure: string;
    readonly meta: string;
    readonly accessibilityLabel: string;
}

/** One row of the dock, by the state its timer is in. */
export type DockRow =
    | (DockRowBase & { readonly kind: 'running'; readonly pauseLabel: string; readonly cancelLabel: string })
    | (DockRowBase & {
          readonly kind: 'paused';
          readonly status: string;
          readonly resumeLabel: string;
          readonly cancelLabel: string;
      })
    | (DockRowBase & { readonly kind: 'done'; readonly status: string; readonly stopLabel: string });

/** The dock: its rows, and whether the offer shows beside them. */
export interface TimerDockView {
    readonly rows: readonly DockRow[];
    /** True only while no timer is live, of any recipe. A held Undo slot does not hide it. */
    readonly offerShown: boolean;
}

/** What the view is made from. */
export interface TimerDockViewInput {
    readonly order: readonly TimerOrderEntry[];
    /** The recipe now open: only its timers get a row. */
    readonly recipe: Pick<CookingRecipe, 'id' | 'steps'>;
    readonly nowMs: number;
    readonly copy: CookingMessages;
    readonly locale: string;
}

/** The time left on a timer, rounded up to the whole second, so the figure and the spoken words agree. */
const remainingMsOf = (timer: ActiveTimer, nowMs: number): number => Math.ceil(timeLeftMs(timer, nowMs) / 1000) * 1000;

/**
 * The dock for the timer list.
 *
 * @param input - The list in the cook's order, the open recipe, the clock and the copy.
 * @returns A row for each live timer of this recipe, and whether the offer shows. Pure.
 */
export function timerDockView(input: TimerDockViewInput): TimerDockView {
    const { order, recipe } = input;
    const live = order.flatMap((entry) => (entry.kind === 'live' ? [entry.timer] : []));

    return {
        rows: live.filter((timer) => timer.recipeId === recipe.id).map((timer) => rowOf(timer, input)),
        offerShown: live.length === 0,
    };
}

/** One timer's row. */
function rowOf(timer: ActiveTimer, { recipe, nowMs, copy, locale }: TimerDockViewInput): DockRow {
    const step = timerStepOf(timer, recipe);
    const { text: label, isFallback } = timerNameOf(timer, step, copy.timer);
    const { dock } = copy;
    const n = step.number;
    // A fallback name is "Step {n}": it already says the step, so the row does not say it twice (designer D96).
    const meta = isFallback ? label : fillTemplate(dock.meta, { label, n });
    const base = { id: timer.id, run: timer.run, meta };
    const remaining = remainingMsOf(timer, nowMs);
    const spoken = spokenDuration(remaining, copy.duration, locale);

    switch (timer.kind) {
        case 'running':
            return {
                ...base,
                kind: 'running',
                figure: countdownFigure(remaining),
                accessibilityLabel: fillTemplate(isFallback ? dock.rowA11yNoStep : dock.rowA11y, {
                    label,
                    remaining: spoken,
                    n,
                }),
                pauseLabel: fillTemplate(dock.pauseA11y, { label }),
                cancelLabel: fillTemplate(dock.cancelA11y, { label }),
            };
        case 'paused':
            return {
                ...base,
                kind: 'paused',
                figure: countdownFigure(remaining),
                status: dock.paused,
                accessibilityLabel: fillTemplate(isFallback ? dock.rowA11yPausedNoStep : dock.rowA11yPaused, {
                    label,
                    remaining: spoken,
                    n,
                }),
                resumeLabel: fillTemplate(dock.resumeA11y, { label }),
                cancelLabel: fillTemplate(dock.cancelA11y, { label }),
            };
        case 'ringing':
        case 'endedAway':
            return {
                ...base,
                kind: 'done',
                figure: countdownFigure(0),
                status: dock.done,
                accessibilityLabel: fillTemplate(isFallback ? dock.rowA11yDoneNoStep : dock.rowA11yDone, { label, n }),
                stopLabel: fillTemplate(dock.stopA11y, { label }),
            };
    }
}
