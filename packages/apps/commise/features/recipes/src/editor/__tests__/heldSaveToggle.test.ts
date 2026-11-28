/**
 * The held-save ways-out toggle ships OFF (heldPublicSave U2, KTD-4). The task that turns it on changes this pin to
 * `true` under a qse TEST-CHANGE record (U7); until then every client surface behaves as main.
 */
import { describe, expect, it } from 'vitest';

import { HELD_SAVE_WAYS_OUT_ON } from '../heldSaveToggle.js';

describe('HELD_SAVE_WAYS_OUT_ON', () => {
    it('ships OFF', () => {
        expect(HELD_SAVE_WAYS_OUT_ON).toBe(false);
    });
});
