/**
 * @module @commise/features-recipes/foodPage — `useFoodPage`: the author's food page orchestration (private foods spec
 * section 5). It reads the food and, for a state that shows staff's answer, its newest publication request; turns them into
 * one {@link FoodPageState}; and owns the cook's intents: Ask, Withdraw (with its confirmation) and Retry. Edit opens
 * the edit form (`useFoodEdit`).
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
import type { PublicationStateValue } from '@kitchensink/schema-food';
import { useState } from 'react';

import { foodPageStateOf, type FoodPageState, type FoodRead } from './foodPageState.js';
import type { AskStatus, WithdrawDialogState } from './foodPageViewProps.js';
import { foodPageMessages } from './messages.js';
import { useFoodEdit, type FoodEditSession } from './useFoodEdit.js';

/** What the page returns: the state and every handler `FoodPageView` takes. */
export interface FoodPageSession {
    readonly state: FoodPageState;
    readonly ask: AskStatus;
    readonly withdraw: WithdrawDialogState;
    /** The edit form (states 13 and 14); Edit opens it. */
    readonly edit: FoodEditSession;
    readonly onEdit: () => void;
    readonly onAsk: () => void;
    readonly onWithdraw: () => void;
    readonly onWithdrawConfirm: () => void;
    readonly onWithdrawKeep: () => void;
    readonly onRetry: () => void;
}

/** What the host hands the page: the app's one connectivity reading (`@commise/query`'s `useIsOffline`). */
export interface FoodPageHost {
    readonly offline: boolean;
}

/** The publication states whose panel shows staff's answer, so they need the newest request. */
const NEEDS_REQUEST: ReadonlySet<PublicationStateValue> = new Set([
    'asked',
    'notApproved',
    'editWaiting',
    'editNotApproved',
]);

/**
 * The author's food page.
 *
 * @param foodId - The food’s id.
 * @param host - What the host hands in: whether the device is offline.
 * @returns The page state and the cook’s intents.
 * @sideEffect Reads food-service; Ask and Withdraw write to it; a snackbar says each success.
 */
export function useFoodPage(foodId: string, { offline }: FoodPageHost): FoodPageSession {
    const m = useMessages(foodPageMessages);
    const { show } = useSnackbar();
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
              : { phase: 'pending', parked: food.fetchStatus === 'paused' };
    const state = foodPageStateOf({ read, request: request.data, online: !offline });
    const edit = useFoodEdit(state);

    const ask: AskStatus = requestPublication.isPending ? 'busy' : requestPublication.isError ? 'failed' : 'idle';

    return {
        state,
        ask,
        withdraw: { open: confirming, busy: withdrawFood.isPending, failed: withdrawFood.isError },
        edit,
        onEdit: edit.onOpen,
        onAsk: () => {
            requestPublication.mutate(foodId, { onSuccess: () => show({ message: m.ask.done }) });
        },
        onWithdraw: () => {
            withdrawFood.reset();
            setConfirming(true);
        },
        onWithdrawConfirm: () => {
            withdrawFood.mutate(foodId, {
                onSuccess: () => {
                    setConfirming(false);
                    show({ message: m.withdraw.done });
                },
            });
        },
        onWithdrawKeep: () => setConfirming(false),
        onRetry: () => void food.refetch(),
    };
}
