/**
 * The duration reader and the facts sheet name time words from ONE list (spec 027 FR-035). The sheet states each time
 * as an amount in the unit the list gives, and the reader returns the durations of the same words, so the two must
 * agree on what is a time word. This also proves every listed word, the bare `h` included, passes the reader's own
 * pattern boundaries.
 */
import { TIME_UNIT_WORDS } from '@kitchensink/recipe-core/time-unit-words';
import { describe, expect, it } from 'vitest';

import { readDuration } from '../duration.js';

describe('the time words', () => {
    it.each(Object.keys(TIME_UNIT_WORDS))('are all read by the duration reader: %s', (word) => {
        expect(readDuration(`Rest for 2 ${word}.`).kind).toBe('one');
    });

    it('offers no timer for days or weeks: cooking mode reads the same lines as before', () => {
        expect(readDuration('Chill for 2 days.')).toEqual({ kind: 'none' });
        expect(readDuration('Chill for 1 week.')).toEqual({ kind: 'none' });
        expect(readDuration('Bake 30 minutes, then chill 2 days.')).toEqual({ kind: 'one', seconds: 1_800 });
    });
});
