/**
 * The web storage adapter for cook marks (blueprint A13): `sessionStorage`, so marks survive a reload in the same tab
 * and end with it. A browser that refuses storage (a private window over quota, storage disabled) still keeps the
 * cook's marks for the page's life rather than dropping each tap.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { clearStoredCookMarks, sessionCookMarksBackend } from '../cookMarksBackend.js';

afterEach(() => {
    // Restore first: a case may have replaced the `sessionStorage` getter with one that throws.
    vi.restoreAllMocks();
    sessionStorage.clear();
});

describe('sessionCookMarksBackend', () => {
    it('writes to and reads from sessionStorage, and lists its keys', () => {
        const backend = sessionCookMarksBackend(sessionStorage);

        backend.setItem('cook.v1.user_1.rec_1', 'x');

        expect(sessionStorage.getItem('cook.v1.user_1.rec_1')).toBe('x');
        expect(backend.getItem('cook.v1.user_1.rec_1')).toBe('x');
        expect(backend.keys()).toContain('cook.v1.user_1.rec_1');

        backend.removeItem('cook.v1.user_1.rec_1');
        expect(sessionStorage.getItem('cook.v1.user_1.rec_1')).toBeNull();
    });

    it('keeps a write in memory when storage refuses it', () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new DOMException('full', 'QuotaExceededError');
        });
        const backend = sessionCookMarksBackend(sessionStorage);

        backend.setItem('cook.v1.user_1.rec_1', 'x');

        expect(backend.getItem('cook.v1.user_1.rec_1')).toBe('x');
        expect(backend.keys()).toContain('cook.v1.user_1.rec_1');

        backend.removeItem('cook.v1.user_1.rec_1');
        expect(backend.getItem('cook.v1.user_1.rec_1')).toBeNull();
    });

    it('works in memory alone when there is no storage at all', () => {
        const backend = sessionCookMarksBackend(undefined);

        backend.setItem('k', 'v');

        expect(backend.getItem('k')).toBe('v');
        expect(backend.keys()).toEqual(['k']);
    });
});

/**
 * The session end (`docs/design/uiOverhaul/ownerDecisions.md` D18, ADR-0054). The provider's scope also removes marks
 * when the cook changes, but a sign-out leaves with a full document load that can unload the page before that effect
 * runs, so the sign-out command removes them itself. Every cook's marks go — the store's own sign-out rule — including
 * the ones written under no cook (`cookMarksKey('')`), and nothing outside the namespace is touched.
 */
describe('clearStoredCookMarks', () => {
    it('removes every cook-marks key from the tab, whoever made it, and keeps every other key', () => {
        sessionStorage.setItem('cook.v1.user_1.rec_1', '{"lines":[],"step":1}');
        sessionStorage.setItem('cook.v1.user_2.rec_2', '{"lines":["a"],"step":null}');
        sessionStorage.setItem('cook.v1..rec_3', '{"lines":["b"],"step":null}');
        sessionStorage.setItem('editor.v1.user_1.draft', 'kept');
        sessionStorage.setItem('cook.v2.user_1.rec_1', 'kept');

        clearStoredCookMarks();

        expect(sessionStorage.getItem('cook.v1.user_1.rec_1')).toBeNull();
        expect(sessionStorage.getItem('cook.v1.user_2.rec_2')).toBeNull();
        expect(sessionStorage.getItem('cook.v1..rec_3')).toBeNull();
        expect(sessionStorage.getItem('editor.v1.user_1.draft')).toBe('kept');
        expect(sessionStorage.getItem('cook.v2.user_1.rec_1')).toBe('kept');
    });

    it('does not throw where the browser blocks storage', () => {
        vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
            throw new DOMException('blocked', 'SecurityError');
        });

        expect(() => clearStoredCookMarks()).not.toThrow();
    });
});
