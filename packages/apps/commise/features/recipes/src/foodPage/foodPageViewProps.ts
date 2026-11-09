/**
 * @module @commise/features-recipes/foodPage — the platform-neutral props of `FoodPageView` (web and native). The view is
 * `props → JSX`: the orchestration (`useFoodPage`) owns every read, mutation and navigation, and passes the state and
 * the handlers down.
 */
import type { FoodPageState } from './foodPageState.js';

/** How the ask to make the food public stands. */
export type AskStatus = 'idle' | 'busy' | 'failed';

/** The Withdraw confirmation. */
export interface WithdrawDialogState {
    readonly open: boolean;
    readonly busy: boolean;
    readonly failed: boolean;
}

/** Props for the `FoodPageView` leaves. */
export interface FoodPageViewProps {
    readonly state: FoodPageState;
    readonly ask: AskStatus;
    readonly withdraw: WithdrawDialogState;
    readonly onEdit: () => void;
    readonly onAsk: () => void;
    /** Open the Withdraw confirmation. */
    readonly onWithdraw: () => void;
    readonly onWithdrawConfirm: () => void;
    readonly onWithdrawKeep: () => void;
    readonly onRetry: () => void;
    /** The way out of "Food not found": My recipes, or back to the editor. */
    readonly onLeave: () => void;
    /** The label of that way out; defaults to "Go to My recipes". */
    readonly leaveLabel?: string;
}
