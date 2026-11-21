/**
 * @module timerCopy — what the timer says: its name, a length of time, the rang-ago line and the alarm fallbacks. Pure
 * functions over the catalogue (`cookingMessages`), filled with the house helpers. No formatter, so the web and Hermes
 * say the same words (staff S26, designer D16, D18).
 */
import { fillTemplate, pluralOf } from '@commise/i18n';
import { durationParts, elapsedParts } from '@kitchensink/cooking-core';
import type { ActiveTimer, HmsParts } from '@kitchensink/cooking-core';

import type { CookingDurationMessages, CookingMessages, CookingTimerMessages } from '../messages.js';

/** The whole seconds in a length, rounded down: the copy never shows a fraction of a second. */
const partsOf = (ms: number): HmsParts => durationParts(Math.floor(Math.max(0, ms) / 1000));

/**
 * The name of a timer in a row, a control name or the alarm.
 *
 * @param timer - Its label and its ordinal among the timers on the same step.
 * @param stepNumber - The 1-based step number it was started from.
 * @param copy - The timer copy.
 * @returns What the cook typed, as typed. Otherwise the line label, or "Step {n}", with " ({ordinal})" after it from
 *   the second timer on the step. Pure.
 */
export function timerLabel(
    timer: Pick<ActiveTimer, 'label' | 'ordinal'>,
    stepNumber: number,
    copy: CookingTimerMessages,
): string {
    if (timer.label?.kind === 'typed') {
        return timer.label.text;
    }

    const base = timer.label?.text ?? fillTemplate(copy.stepLabel, { n: stepNumber });

    return timer.ordinal > 1 ? fillTemplate(copy.ordinal, { label: base, ordinal: timer.ordinal }) : base;
}

/**
 * A length as shown: "1 h 30", "2 h", "25 min", "30 sec". Seconds follow the hours or minutes after a space ("1 min 30
 * sec"), which the designer's table does not define: recorded in reviews/0021 for the designer.
 *
 * @param durationMs - A length in ms. Negative reads as zero.
 * @param copy - The duration copy.
 * @returns The shown text. Zero is "0 sec". Pure.
 */
export function shownDuration(durationMs: number, copy: CookingDurationMessages): string {
    const { hours, minutes, seconds } = partsOf(durationMs);
    const parts: string[] = [];

    if (hours > 0 && minutes > 0) {
        parts.push(fillTemplate(copy.hoursMinutes, { h: hours, m: minutes }));
    } else if (hours > 0) {
        parts.push(fillTemplate(copy.hoursOnly, { h: hours }));
    } else if (minutes > 0) {
        parts.push(fillTemplate(copy.minutesOnly, { m: minutes }));
    }

    if (seconds > 0 || parts.length === 0) {
        parts.push(fillTemplate(copy.secondsOnly, { s: seconds }));
    }

    return parts.join(' ');
}

/**
 * A length as words for a screen reader: "1 hour 5 minutes". Zero parts are dropped.
 *
 * @param durationMs - A length in ms. Negative reads as zero.
 * @param copy - The duration copy.
 * @param locale - The locale that picks the plural form.
 * @returns The spoken text. Zero is "0 seconds". Pure.
 */
export function spokenDuration(durationMs: number, copy: CookingDurationMessages, locale: string): string {
    const { hours, minutes, seconds } = partsOf(durationMs);
    const parts = [
        hours > 0 ? pluralOf(copy.hours, hours, locale) : undefined,
        minutes > 0 ? pluralOf(copy.minutes, minutes, locale) : undefined,
        seconds > 0 ? pluralOf(copy.seconds, seconds, locale) : undefined,
    ].filter((part) => part !== undefined);

    return parts.length === 0 ? pluralOf(copy.seconds, 0, locale) : parts.join(' ');
}

/**
 * The overline of a ringing timer: how long ago it ended (R15). Under a minute it is its own string.
 *
 * @param label - The timer's name, from `timerLabel`.
 * @param elapsedMs - Ms since the end. Negative reads as just now.
 * @param copy - The cooking copy.
 * @returns "{label} timer · rang just now", or "... rang 5 min ago", "1 h 5 min" or "2 h". Pure.
 */
export function rangLine(label: string, elapsedMs: number, copy: CookingMessages): string {
    const ago = elapsedParts(elapsedMs);

    if (ago.kind === 'justNow') {
        return fillTemplate(copy.alarm.rangJustNow, { label });
    }

    let elapsed: string;

    if (ago.kind === 'minutes') {
        elapsed = fillTemplate(copy.duration.minutesOnly, { m: ago.minutes });
    } else if (ago.minutes === 0) {
        elapsed = fillTemplate(copy.duration.hoursOnly, { h: ago.hours });
    } else {
        elapsed = fillTemplate(copy.duration.hoursMinutesAgo, { h: ago.hours, m: ago.minutes });
    }

    return fillTemplate(copy.alarm.rangAgo, { label, elapsed });
}

/**
 * The alarm headline when the step gives no check text.
 *
 * @param durationMs - The length the timer ran.
 * @param copy - The cooking copy.
 * @returns "{duration} timer done". Pure.
 */
export function alarmHeadlineFallback(durationMs: number, copy: CookingMessages): string {
    return fillTemplate(copy.alarm.headlineFallback, { duration: shownDuration(durationMs, copy.duration) });
}

/**
 * The alarm body when the step gives no check text.
 *
 * @param stepNumber - The 1-based step number.
 * @param line - The step's first line.
 * @param copy - The cooking copy.
 * @returns "Step {n}: {line}" with a no-break space after "Step". Pure.
 */
export function alarmBodyFallback(stepNumber: number, line: string, copy: CookingMessages): string {
    return fillTemplate(copy.alarm.bodyFallback, { n: stepNumber, line });
}
