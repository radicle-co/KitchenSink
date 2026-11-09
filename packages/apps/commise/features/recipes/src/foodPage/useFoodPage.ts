/**
 * @module @commise/features-recipes/foodPage — `useFoodPage`: the author's food page orchestration (private foods spec
 * section 5). It reads the food and, for a state that shows staff's answer, its newest publication request; turns them into
 * one {@link FoodPageState}; and owns the cook's intents: Ask, Withdraw (with its confirmation) and Retry. Edit is the
 * host's (web opens the edit sheet, native the same sheet), so it is handed through.
 *
 * Remote state stays in TanStack Query: the page state is DERIVED from the queries each render, never copied into local
 * state. The ask and withdraw are mutations that refresh the food, its request and the list (the food client's hooks).
 *
 * @pattern Facade — one hook over the food reads and the author mutations
 */
import {
    useFood,
    usePublicationRequest,
    useRequestFoodPublication,
    useWithdrawFood,
} from '@kitchensink/food-service-client/hooks';
import { useMessages } from '@commise/i18n/react';
import { useSnackbar } from '@commise/ui/snackbar';
import { onlineManager } from '@tanstack/react-query';
import { useCallback, useState, useSyncExternalStore } from 'react';

import { foodPageStateOf, type FoodPageState, type FoodRead } from './foodPageState.js';
import type { AskStatus, WithdrawDialogState } from './foodPageViewProps.js';
import { foodPageMessages } from './messages.js';

/** What the page asks of its host. */
export interface FoodPageHost {
    /** Open the edit sheet, prefilled by the state (the waiting edit, the declined version, or the food). */
    readonly onEdit: () => void;
}

/** What the page returns: the state and every handler `FoodPageView` takes. */
export interface FoodPageSession {
    readonly state: FoodPageState;
    readonly ask: AskStatus;
    readonly withdraw: WithdrawDialogState;
    readonly onEdit: () => void;
    readonly onAsk: () => void;
    readonly onWithdraw: () => void;
    readonly onWithdrawConfirm: () => void;
    readonly onWithdrawKeep: () => void;
    readonly onRetry: () => void;
}

/** The publication states whose panel shows staff's answer, so they need the newest request. */
const NEEDS_REQUEST = new Set(['asked', 'notApproved', 'editWaiting', 'editNotApproved']);

function useOnline(): boolean {
    return useSyncExternalStore(
        (notify) => onlineManager.subscribe(notify),
        () => onlineManager.isOnline(),
        () => true,
    );
}

/**
 * The author's food page.
 *
 * @param foodId - The food’s id.
 * @param host - The host’s hand-offs.
 * @returns The page state and the cook’s intents.
 * @sideEffect Reads food-service; Ask and Withdraw write to it; a snackbar says each success.
 */
export function useFoodPage(foodId: string, host: FoodPageHost): FoodPageSession {
    const m = useMessages(foodPageMessages);
    const { show } = useSnackbar();
    const online = useOnline();
    const food = useFood(foodId);
    const word = food.data?.status === 'RESOLVED' ? food.data.food.publicationState : undefined;
    const request = usePublicationRequest(foodId, { enabled: word !== undefined && NEEDS_REQUEST.has(word) });
    const requestPublication = useRequestFoodPublication();
    const withdrawFood = useWithdrawFood();
    const [confirming, setConfirming] = useState(false);

    // A cached answer wins over a later failure: the cook keeps reading, and the actions disable offline.
    const read: FoodRead =
        food.data !== undefined
            ? { phase: 'ready', result: food.data }
            : food.isError
              ? { phase: 'error', error: food.error }
              : { phase: 'pending' };
    const state = foodPageStateOf({ read, request: request.data, online });

    const ask: AskStatus = requestPublication.isPending ? 'busy' : requestPublication.isError ? 'failed' : 'idle';

    const onAsk = useCallback(() => {
        requestPublication.mutate(foodId, { onSuccess: () => show({ message: m.ask.done }) });
    }, [foodId, m.ask.done, requestPublication, show]);

    const onWithdrawConfirm = useCallback(() => {
        withdrawFood.mutate(foodId, {
            onSuccess: () => {
                setConfirming(false);
                show({ message: m.withdraw.done });
            },
        });
    }, [foodId, m.withdraw.done, show, withdrawFood]);

    return {
        state,
        ask,
        withdraw: { open: confirming, busy: withdrawFood.isPending, failed: withdrawFood.isError },
        onEdit: host.onEdit,
        onAsk,
        onWithdraw: () => {
            withdrawFood.reset();
            setConfirming(true);
        },
        onWithdrawConfirm,
        onWithdrawKeep: () => setConfirming(false),
        onRetry: () => void food.refetch(),
    };
}
