/**
 * The `/` shortcut's per-device preference (`docs/architecture/uiOverhaulBlueprint.md` A18; WCAG 2.1.4). It is on by
 * default, stored per device in `localStorage` as `prefs.v1.searchShortcut`, and it must be switchable off because a
 * single-key shortcut that cannot be turned off fails Character Key Shortcuts.
 *
 * The default is the part that fails silently: storage that is missing, throws or holds junk must read as ON, because
 * the cook never chose otherwise. Only an explicit "off" disables the shortcut.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    SEARCH_SHORTCUT_STORAGE_KEY,
    readSearchShortcutEnabled,
    subscribeToSearchShortcut,
    writeSearchShortcutEnabled,
} from '../searchShortcutPreference';

afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
});

describe('the stored preference', () => {
    it('lives under the blueprint’s key', () => {
        expect(SEARCH_SHORTCUT_STORAGE_KEY).toBe('prefs.v1.searchShortcut');
    });

    it('is on when nothing is stored', () => {
        expect(readSearchShortcutEnabled()).toBe(true);
    });

    it('is off only when the stored value says off', () => {
        window.localStorage.setItem(SEARCH_SHORTCUT_STORAGE_KEY, 'off');

        expect(readSearchShortcutEnabled()).toBe(false);
    });

    it.each(['on', '', 'false', '0', 'OFF', '{"v":1}'])('stays on for the stored value %j', (value) => {
        window.localStorage.setItem(SEARCH_SHORTCUT_STORAGE_KEY, value);

        expect(readSearchShortcutEnabled()).toBe(true);
    });

    it('is on when reading storage throws (a browser with storage disabled)', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new DOMException('denied', 'SecurityError');
        });

        expect(readSearchShortcutEnabled()).toBe(true);
    });

    it('round-trips an off and an on', () => {
        writeSearchShortcutEnabled(false);
        expect(readSearchShortcutEnabled()).toBe(false);

        writeSearchShortcutEnabled(true);
        expect(readSearchShortcutEnabled()).toBe(true);
    });

    it('does not throw when writing fails (a full or disabled store)', () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new DOMException('full', 'QuotaExceededError');
        });

        expect(() => writeSearchShortcutEnabled(false)).not.toThrow();
    });
});

describe('subscribing to the preference', () => {
    it('tells a subscriber in this tab when it changes', () => {
        const listener = vi.fn();
        const unsubscribe = subscribeToSearchShortcut(listener);

        writeSearchShortcutEnabled(false);

        expect(listener).toHaveBeenCalledTimes(1);

        unsubscribe();
    });

    it('tells a subscriber when another tab changes it (the storage event)', () => {
        const listener = vi.fn();
        const unsubscribe = subscribeToSearchShortcut(listener);

        window.dispatchEvent(new StorageEvent('storage', { key: SEARCH_SHORTCUT_STORAGE_KEY, newValue: 'off' }));

        expect(listener).toHaveBeenCalledTimes(1);

        unsubscribe();
    });

    it('ignores a storage event for some other key', () => {
        const listener = vi.fn();
        const unsubscribe = subscribeToSearchShortcut(listener);

        window.dispatchEvent(new StorageEvent('storage', { key: 'something.else', newValue: 'x' }));

        expect(listener).not.toHaveBeenCalled();

        unsubscribe();
    });

    it('stops telling a subscriber once it has unsubscribed', () => {
        const listener = vi.fn();

        subscribeToSearchShortcut(listener)();
        writeSearchShortcutEnabled(false);
        window.dispatchEvent(new StorageEvent('storage', { key: SEARCH_SHORTCUT_STORAGE_KEY }));

        expect(listener).not.toHaveBeenCalled();
    });
});
