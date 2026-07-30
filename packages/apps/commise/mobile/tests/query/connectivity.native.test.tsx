/**
 * Unit tests for the TanStack focus/online manager wiring (B21). React Native has no window-focus or
 * `navigator.onLine`, so these installers bridge `AppState` + NetInfo into TanStack's global managers.
 * NetInfo and `react-native` are mocked (no native runtime under jsdom); the real `focusManager`/
 * `onlineManager` singletons are driven so the tests assert the actual bridge — a NetInfo/AppState event
 * really does flip TanStack's focused/online state, and the fail-safe (unknown connectivity → offline) holds.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { focusManager, onlineManager } from '@tanstack/react-query';

// NetInfo has no jsdom runtime — mock it with a controllable listener.
const netInfoListeners: Array<(state: { isConnected: boolean | null }) => void> = [];
const netInfoUnsubscribe = vi.fn();
vi.mock('@react-native-community/netinfo', () => ({
    default: {
        addEventListener: (listener: (state: { isConnected: boolean | null }) => void) => {
            netInfoListeners.push(listener);

            return netInfoUnsubscribe;
        },
    },
}));

// Control AppState + Platform without the RN(-web) runtime's document-visibility coupling.
const appStateListeners: Array<(status: string) => void> = [];
const appStateRemove = vi.fn();
const platform = { OS: 'ios' as string };
vi.mock('react-native', () => ({
    AppState: {
        addEventListener: (_event: string, listener: (status: string) => void) => {
            appStateListeners.push(listener);

            return { remove: appStateRemove };
        },
    },
    get Platform() {
        return platform;
    },
}));

const { installOnlineManager, installFocusManager } = await import('../../src/query/connectivity.js');

beforeEach(() => {
    netInfoListeners.length = 0;
    appStateListeners.length = 0;
    platform.OS = 'ios';
});

afterEach(() => {
    vi.clearAllMocks();
});

describe('installOnlineManager (B21)', () => {
    it('flips TanStack online state from NetInfo connectivity events', () => {
        installOnlineManager();

        // setEventListener invokes the setup immediately, subscribing to NetInfo.
        expect(netInfoListeners).toHaveLength(1);

        netInfoListeners[0]!({ isConnected: true });
        expect(onlineManager.isOnline()).toBe(true);

        netInfoListeners[0]!({ isConnected: false });
        expect(onlineManager.isOnline()).toBe(false);
    });

    it('treats unknown connectivity (null) as offline — fail safe', () => {
        installOnlineManager();

        netInfoListeners[0]!({ isConnected: null });

        expect(onlineManager.isOnline()).toBe(false);
    });
});

describe('installFocusManager (B21)', () => {
    it('marks the client focused only while the app is active', () => {
        installFocusManager();

        // setEventListener invokes the setup immediately, subscribing to AppState.
        expect(appStateListeners).toHaveLength(1);

        appStateListeners[0]!('active');
        expect(focusManager.isFocused()).toBe(true);

        appStateListeners[0]!('background');
        expect(focusManager.isFocused()).toBe(false);
    });

    it('does not drive focus on web (which has its own visibility handling)', () => {
        platform.OS = 'web';
        const setFocusedSpy = vi.spyOn(focusManager, 'setFocused');
        installFocusManager();
        setFocusedSpy.mockClear();

        appStateListeners[0]!('active');

        expect(setFocusedSpy).not.toHaveBeenCalled();
        setFocusedSpy.mockRestore();
    });
});
