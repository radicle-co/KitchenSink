/**
 * The one rule for when a change of the signed-in cook ends a session (ADR-0094; the device scope and the in-memory
 * timer store both call it). Clerk reports `undefined` while it loads, which the callers ignore before asking.
 */
import { describe, expect, it } from 'vitest';

import { endsCookSession } from '../endsCookSession.js';

describe('endsCookSession', () => {
    it.each([
        ['a cook to nobody', 'cookA', null, true],
        ['a cook to another cook', 'cookA', 'cookB', true],
        ['a cook to the same cook', 'cookA', 'cookA', false],
        ['nobody to a cook', null, 'cookA', false],
        ['nobody to nobody', null, null, false],
    ])('%s: %s', (_name, held, next, ends) => {
        expect(endsCookSession(held, next)).toBe(ends);
    });
});
