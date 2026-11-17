// @vitest-environment jsdom
/**
 * The web's kept cooking-session port (ADR-0094 sections 3 and 6): `localStorage` behind the store's port, with the
 * three events that tell a tab another tab (or a restored page) changed the record.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { webKeptPort } from '@/components/recipes/keptSessionStore';

afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
});

describe('webKeptPort', () => {
    it('reads, writes and removes through localStorage', async () => {
        expect(await webKeptPort.write('cook.v2.a', '{"v":1}')).toEqual({ ok: true });
        expect(await webKeptPort.read('cook.v2.a')).toBe('{"v":1}');

        await webKeptPort.remove('cook.v2.a');

        expect(await webKeptPort.read('cook.v2.a')).toBeNull();
    });

    it('returns a failed outcome, not a throw, when the browser refuses the write (quota, private mode)', async () => {
        const quota = new Error('QuotaExceededError');
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw quota;
        });

        expect(await webKeptPort.write('cook.v2.a', 'x')).toEqual({ ok: false, error: quota });
    });

    it('lists only the keys with the prefix', async () => {
        window.localStorage.setItem('cook.v2.a', '1');
        window.localStorage.setItem('cook.v2.b', '1');
        window.localStorage.setItem('other', '1');

        expect([...(await webKeptPort.keys('cook.v2.'))].sort()).toEqual(['cook.v2.a', 'cook.v2.b']);
    });
});

describe('webKeptPort.subscribeExternal', () => {
    const subscribe = () => {
        const onChange = vi.fn();
        const unsubscribe = webKeptPort.subscribeExternal?.(onChange);

        return { onChange, unsubscribe };
    };

    const storage = (key: string | null) => window.dispatchEvent(new StorageEvent('storage', { key }));

    it('answers a storage event for a kept key, and for a clear(), and ignores another key', () => {
        const { onChange, unsubscribe } = subscribe();

        storage('some.other.key');
        expect(onChange).not.toHaveBeenCalled();

        storage('cook.v2.user_a');
        storage(null);
        expect(onChange).toHaveBeenCalledTimes(2);
        unsubscribe?.();
    });

    it('answers pageshow only when the page was restored from the cache (persisted)', () => {
        const { onChange, unsubscribe } = subscribe();

        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false }));
        expect(onChange).not.toHaveBeenCalled();

        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
        expect(onChange).toHaveBeenCalledTimes(1);
        unsubscribe?.();
    });

    it('answers visibilitychange only when the tab becomes visible', () => {
        const { onChange, unsubscribe } = subscribe();
        const state = vi.spyOn(document, 'visibilityState', 'get');

        state.mockReturnValue('hidden');
        document.dispatchEvent(new Event('visibilitychange'));
        expect(onChange).not.toHaveBeenCalled();

        state.mockReturnValue('visible');
        document.dispatchEvent(new Event('visibilitychange'));
        expect(onChange).toHaveBeenCalledTimes(1);
        unsubscribe?.();
    });

    it('removes all three listeners on unsubscribe', () => {
        const { onChange, unsubscribe } = subscribe();

        unsubscribe?.();
        storage('cook.v2.user_a');
        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
        document.dispatchEvent(new Event('visibilitychange'));

        expect(onChange).not.toHaveBeenCalled();
    });
});
