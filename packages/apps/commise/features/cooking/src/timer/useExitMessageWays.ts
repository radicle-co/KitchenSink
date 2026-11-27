/**
 * @module useExitMessageWays — the ways out of cooking mode, each one first telling the cook that a timer of this
 * recipe is still going.
 *
 * @pattern Decorator — wraps the way out the route handed in and adds the message before it, leaving its contract alone
 */
import { useSnackbar } from '@commise/ui/snackbar';
import { useMessages } from '@commise/i18n/react';

import type { CookingRecipe, CookingWays } from '../cookingViewProps.js';
import { cookingMessages } from '../messages.js';
import { EXIT_MESSAGE_MS, exitMessageOf } from './exitMessage.js';
import { useTimerStore } from './useTimerStore.js';

/**
 * The ways out, wrapped.
 *
 * @param ways - Where each way out goes.
 * @param recipeId - The route's recipe id.
 * @param recipe - The recipe once it is read, else `undefined`.
 * @param running - The sentence for a running timer: each platform says where it rings.
 * @returns The same ways. `onLeave` and `onHome` show the exit message first when there is one; `onEdit` is the caller's
 *   own function, since Edit keeps the cook in this recipe's work.
 * @throws {Error} When no `TimerProvider` or no `SnackbarHost` is above.
 * @sideEffect Each wrapped way reads the timer store at the press and may show a snackbar.
 */
export function useExitMessageWays(
    ways: CookingWays,
    recipeId: string,
    recipe: Pick<CookingRecipe, 'id' | 'steps'> | undefined,
    running: string,
): CookingWays {
    const copy = useMessages(cookingMessages);
    const store = useTimerStore();
    const snackbar = useSnackbar();

    const leaving = (way: () => void) => (): void => {
        const message = exitMessageOf({
            state: store.getSnapshot(),
            recipeId,
            recipe,
            copy,
            running,
            nowMs: Date.now(),
        });

        if (message !== undefined) {
            snackbar.show({ message, durationMs: EXIT_MESSAGE_MS });
        }

        way();
    };

    return { onLeave: leaving(ways.onLeave), onEdit: ways.onEdit, onHome: leaving(ways.onHome) };
}
