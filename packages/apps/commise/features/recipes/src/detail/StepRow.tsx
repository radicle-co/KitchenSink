'use client';

/**
 * @module @commise/features-recipes — the web step row (build spec §6.1, §6.3).
 *
 * The step text stays plain content: a whole-step button would make it presentational and hide it from a screen
 * reader (Settled 33). Its numeral is its own 44 px toggle, a `button` with `aria-pressed` named "Mark step {n} as
 * current"; the toggle's `::after` stretches over the whole step, so a tap anywhere on it moves the marker for pointer
 * users, and the timer chip sits above that overlay. The current step shows the 3 px `hereBar` at its start edge and
 * fills its numeral with `action`.
 *
 * Presentational: props → JSX.
 */
import { useMessages } from '@commise/i18n/react';
import { Icon } from '@commise/ui/icon';
import type { FC } from 'react';

import { fillTemplate } from '../format/fillTemplate.js';
import { recipeMessages } from '../messages.js';
import type { StepRowProps } from './cookRowProps.js';
import { stepTimerLabel } from './model.js';

/** The web step row. */
export const StepRow: FC<StepRowProps> = ({ step, current, onToggle }) => {
    const { detail, duration } = useMessages(recipeMessages);
    const timer = stepTimerLabel(step.timerSeconds, detail.stepTimer, duration);

    return (
        <li className="relative flex items-start gap-3 ps-3">
            {current && (
                <span
                    data-here-bar
                    aria-hidden="true"
                    className="absolute inset-y-0 start-0 w-[3px] rounded-full bg-here-bar"
                />
            )}
            <button
                type="button"
                aria-pressed={current}
                aria-label={fillTemplate(detail.stepToggleLabel, { step: step.stepNumber })}
                onClick={() => onToggle(step.stepNumber)}
                className="flex size-11 shrink-0 items-center justify-center rounded-full after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
                <span
                    data-numeral
                    aria-hidden="true"
                    className={`flex size-8 items-center justify-center rounded-full text-label tabular-nums lining-nums transition-colors motion-reduce:transition-none ${
                        current ? 'bg-action text-on-action' : 'bg-selected-fill text-ink'
                    }`}
                >
                    {step.stepNumber}
                </span>
            </button>
            <div className="flex min-w-0 flex-col gap-2 pt-2">
                <p className="max-w-[62ch] break-words text-reading-body text-ink">{step.instruction}</p>
                {timer !== undefined && (
                    <span
                        data-timer
                        className="relative z-10 inline-flex w-fit items-center gap-1 rounded-sm bg-surface-muted px-2 py-0.5"
                    >
                        <Icon name="timer" size={16} label={detail.stepTimerIcon} />
                        <span className="text-meta text-ink">{timer}</span>
                    </span>
                )}
            </div>
        </li>
    );
};
