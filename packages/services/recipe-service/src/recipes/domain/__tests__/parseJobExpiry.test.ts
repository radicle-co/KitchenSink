/**
 * `isParseJobExpired` — the ONE expiry rule a paste job's mutations and its matcher apply (ADR-0071 review, F12). It
 * replaces two copies (the job DAL's mutation guard and the matcher's own) that would drift the first time either
 * changed.
 */
import { describe, expect, it } from 'vitest';

import { isParseJobExpired } from '../parseJobExpiry.js';

const NOW = Date.parse('2026-10-25T12:00:00.000Z');

describe('isParseJobExpired', () => {
    it('is live before its expiry instant', () => {
        expect(isParseJobExpired({ status: 'complete', expiresAt: new Date(NOW + 1) }, NOW)).toBe(false);
    });

    it('⛔ is expired AT its expiry instant, not a moment after', () => {
        expect(isParseJobExpired({ status: 'complete', expiresAt: new Date(NOW) }, NOW)).toBe(true);
    });

    it('⛔ is expired once the sweep marked it, whatever its timestamp says', () => {
        expect(isParseJobExpired({ status: 'expired', expiresAt: new Date(NOW + 60_000) }, NOW)).toBe(true);
    });
});
