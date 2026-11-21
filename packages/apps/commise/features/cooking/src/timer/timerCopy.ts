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
 * @param timer - Its label.
 * @param stepNumber - The 1-based step number it was started from.
 * @param copy - The timer copy.
 * @returns What the cook typed, as typed, else the line label, else "Step {n}". The ordinal is not here: it goes with the
 *   step (designer), and S3a holds one timer. Pure.
 */
export function timerLabel(timer: Pick<ActiveTimer, 'label'>, stepNumber: number, copy: CookingTimerMessages): string {
    return timer.label?.text ?? fillTemplate(copy.stepLabel, { n: stepNumber });
}

/**
 * A length as shown: "1 h 30", "2 h", "25 min", "30 sec". With seconds each shape is its own key ("1 h 30 min 15
 * sec", designer D81); "1 h 30" is only for a length with no seconds.
 *
 * @param durationMs - A length in ms. Negative reads as zero.
 * @param copy - The duration copy.
 * @returns The shown text. Zero is "0 sec". Pure.
 */
export function shownDuration(durationMs: number, copy: CookingDurationMessages): string {
    const { hours, minutes, seconds } = partsOf(durationMs);

    if (seconds > 0) {
        if (hours > 0 && minutes > 0) {
            return fillTemplate(copy.hoursMinutesSeconds, { h: hours, m: minutes, s: seconds });
        }

        if (hours > 0) {
            return fillTemplate(copy.hoursSeconds, { h: hours, s: seconds });
        }

        return minutes > 0
            ? fillTemplate(copy.minutesSeconds, { m: minutes, s: seconds })
            : fillTemplate(copy.secondsOnly, { s: seconds });
    }

    if (hours > 0 && minutes > 0) {
        return fillTemplate(copy.hoursMinutes, { h: hours, m: minutes });
    }

    if (hours > 0) {
        return fillTemplate(copy.hoursOnly, { h: hours });
    }

    return minutes > 0 ? fillTemplate(copy.minutesOnly, { m: minutes }) : fillTemplate(copy.secondsOnly, { s: 0 });
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
