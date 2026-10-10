/**
 * @module @commise/features-recipes — saying a stored duration (blueprint slice 1, step 10).
 *
 * The card, the detail and the editor each say a duration. They read it from here rather than from the list's model,
 * which is a list concern. `Intl.DurationFormat` is not used: Hermes support is unverified, and the localized
 * templates already say it the same way on web, SSR and the device. The rounding rule is `splitDuration`'s, in
 * `@commise/ui/duration`.
 */
import { splitDuration } from '@commise/ui/duration';

import { fillTemplate } from './fillTemplate.js';
import type { RecipeDurationMessages } from '../messages.js';

/**
 * Say a duration stored in seconds in hours and minutes ("4 h 30 min"), never in raw seconds. Pure.
 *
 * @param seconds - The stored duration, or `undefined`.
 * @param templates - The localized templates.
 * @returns The sentence, or `undefined` when there is no duration to show.
 */
export const formatDuration = (seconds: number | undefined, templates: RecipeDurationMessages): string | undefined => {
    const parts = splitDuration(seconds);

    if (parts === undefined) {
        return undefined;
    }

    if (parts.hours === 0) {
        return fillTemplate(templates.minutes, { minutes: parts.minutes });
    }

    return parts.minutes === 0
        ? fillTemplate(templates.hours, { hours: parts.hours })
        : fillTemplate(templates.hoursMinutes, { hours: parts.hours, minutes: parts.minutes });
};
