/**
 * @module query/connectivity — wires TanStack Query's global focus + online managers to React Native's
 * platform signals (B21). Web browsers give TanStack window-focus and `navigator.onLine` for free; React
 * Native has neither, so WITHOUT this the client's refetch-on-focus and refetch-on-reconnect behaviour — and
 * the offline mutation-pause — are dead. Both installers target the process-global singletons, so they run
 * ONCE at app start (a later `setEventListener` replaces the prior listener and runs its cleanup).
 *
 * Kept as two small, side-effect-only installers (not inline in `App`) so the wiring is unit-testable against
 * fakes without mounting the whole app.
 */
import NetInfo from '@react-native-community/netinfo';
import { focusManager, onlineManager } from '@tanstack/react-query';
import { AppState, Platform, type AppStateStatus } from 'react-native';

/**
 * Drive TanStack's {@link onlineManager} from NetInfo, so queries refetch on reconnect and mutations pause
 * while offline instead of hard-failing. A nullish `isConnected` (unknown) is treated as offline — fail safe.
 *
 * @sideEffect Registers the process-global online-manager event listener.
 */
export function installOnlineManager(): void {
    onlineManager.setEventListener((setOnline) =>
        NetInfo.addEventListener((state) => {
            setOnline(state.isConnected ?? false);
        }),
    );
}

/**
 * Drive TanStack's {@link focusManager} from `AppState`, so queries refetch when the app returns to the
 * foreground (React Native has no window-focus event — "app active" is the closest signal). The web platform
 * has its own visibility handling, so it is skipped.
 *
 * @sideEffect Registers the process-global focus-manager event listener.
 */
export function installFocusManager(): void {
    focusManager.setEventListener((handleFocus) => {
        const subscription = AppState.addEventListener('change', (status: AppStateStatus) => {
            if (Platform.OS !== 'web') {
                handleFocus(status === 'active');
            }
        });

        return () => subscription.remove();
    });
}
