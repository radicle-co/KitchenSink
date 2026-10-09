/**
 * The web storage adapter for cook marks (blueprint A13): `sessionStorage`, so marks survive a reload in the same tab
 * and end with it. A browser that refuses storage (a private window over quota, storage disabled) still keeps the
 * cook's marks for the page's life rather than dropping each tap.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { sessionCookMarksBackend } from '../cookMarksBackend.js';

afterEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
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
