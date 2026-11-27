import { CookMarksProvider } from '@commise/features-recipes/cook';
import { BackInterceptProvider } from '@commise/ui/back-intercept';
import { SnackbarHost } from '@commise/ui/snackbar';
import type { FC, ReactNode } from 'react';

import { TimerStoreContext } from '../timer/timerContext.js';
import { createTimerStore, type TimerStore } from '../timer/timerStore.js';

/** What a cooking screen test mounts the screen in: the app's own providers around it. */
export interface CookingWrapper {
    /** The timer store the screen reads, for a test that starts a timer. */
    readonly store: TimerStore;
    /** The wrapper to pass to `render`. */
    readonly Wrapper: FC<{ readonly children: ReactNode }>;
}

/** Hardware Back that no screen took: the navigator would handle it, and these tests have none. */
const unhandled = (): boolean => false;

/**
 * The providers the native cooking screen needs above it, as the app mounts them: the cook marks, the session's timer
 * store, the one snackbar host and the hardware-back seam. A test names the store only when it starts a timer.
 *
 * @param store - The timer store the screen reads. A new, empty one by default.
 * @returns The store and the wrapper that provides it. Pure.
 */
export function makeCookingWrapper(store: TimerStore = createTimerStore()): CookingWrapper {
    const Wrapper: FC<{ readonly children: ReactNode }> = ({ children }) => (
        <CookMarksProvider subject="user_test">
            <TimerStoreContext value={store}>
                <SnackbarHost>
                    <BackInterceptProvider onUnhandled={unhandled}>{children}</BackInterceptProvider>
                </SnackbarHost>
            </TimerStoreContext>
        </CookMarksProvider>
    );

    return { store, Wrapper };
}
