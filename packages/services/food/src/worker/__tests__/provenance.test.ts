/**
 * Unit tests for the async-producer provenance guard (T-053, FR-048). Pure logic: a leased
 * `fetch_queue` row is drainable only when EVERY recorded requester `sub` is a real principal —
 * a verified user `sub` or an allowlisted named service principal — and there is at least one. A
 * row with no recorded requester, or a forbidden `'system'` shortcut, is refused.
 */
import { describe, expect, it } from 'vitest';

import { hasValidProvenance, isValidPrincipal } from '../provenance.js';

describe('isValidPrincipal (FR-048)', () => {
    it('accepts a verified user sub', () => {
        expect(isValidPrincipal('user_2abc')).toBe(true);
    });

    it('accepts an allowlisted named service principal', () => {
        expect(isValidPrincipal('svc_change_refresh')).toBe(true);
        expect(isValidPrincipal('svc_recipe_import')).toBe(true);
    });

    it('rejects the forbidden "system" shortcut (no unauthenticated bypass)', () => {
        expect(isValidPrincipal('system')).toBe(false);
        expect(isValidPrincipal('SYSTEM')).toBe(false);
    });

    it('rejects an empty / whitespace-only sub', () => {
        expect(isValidPrincipal('')).toBe(false);
        expect(isValidPrincipal('   ')).toBe(false);
    });
});

describe('hasValidProvenance (FR-048)', () => {
    it('refuses a row with NO recorded requester', () => {
        expect(hasValidProvenance([])).toBe(false);
    });

    it('accepts a single-requester row whose sub is a real principal', () => {
        expect(hasValidProvenance(['user_a'])).toBe(true);
    });

    it('requires EVERY requester to be valid for a many-requester food', () => {
        expect(hasValidProvenance(['user_a', 'user_b', 'svc_change_refresh'])).toBe(true);
        expect(hasValidProvenance(['user_a', 'system'])).toBe(false);
        expect(hasValidProvenance(['user_a', ''])).toBe(false);
    });
});
