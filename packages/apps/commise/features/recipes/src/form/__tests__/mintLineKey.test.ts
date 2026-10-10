/**
 * Unit tests for `mintLineKey` (`../mintLineKey.ts`) — the impure edge that mints an appended line's identity from the
 * house UUID seam (`analytics/mintEventId.ts`), so the append transition can stay pure and take the key as a parameter.
 *
 * ⛔ The property that matters is NEVER REPEATING, including after the line holding the previous key is removed —
 * the case "one past the highest key in the draft" got wrong (staff-architect REVIEW F1).
 */
import { describe, expect, it } from 'vitest';

import { isIngredientLineKey } from '../lineKey.js';
import { mintLineKey } from '../mintLineKey.js';

describe('mintLineKey', () => {
    it('mints a well-formed line key', () => {
        expect(isIngredientLineKey(mintLineKey())).toBe(true);
    });

    it('never repeats across many mints (no draft state is consulted, so a removal cannot make it reissue)', () => {
        const keys = Array.from({ length: 200 }, () => mintLineKey());

        expect(new Set(keys).size).toBe(200);
    });
});
