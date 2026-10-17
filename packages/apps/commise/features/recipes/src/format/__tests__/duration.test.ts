/**
 * `formatDuration` — a stored duration said in hours and minutes. Moved here from `list/__tests__/model.test.ts`
 * with the function (blueprint slice 1, step 10): the card, the detail and the editor all say a duration, and none of
 * them should reach into the list's model to do it. The cases are unchanged.
 */
import { describe, expect, it } from 'vitest';

import { formatDuration } from '../duration.js';

/**
 * F1 (`docs/design/uiOverhaul/evaluateRecipeAndWizard.md`): a step timer read "16200s timer". It is said in hours and
 * minutes, through the localized templates, on every runtime (one path, so web, SSR and Hermes print the same words).
 */
describe('formatDuration', () => {
    const templates = { minutes: '{minutes} min', hours: '{hours} h', hoursMinutes: '{hours} h {minutes} min' };

    it.each([
        [undefined, undefined],
        [0, undefined],
        [20, '1 min'],
        [1200, '20 min'],
        [1800, '30 min'],
        [3600, '1 h'],
        [5400, '1 h 30 min'],
        [16200, '4 h 30 min'],
        [93600, '26 h'],
    ])('says %s seconds as %s', (seconds, expected) => {
        expect(formatDuration(seconds, templates)).toBe(expected);
    });
});
