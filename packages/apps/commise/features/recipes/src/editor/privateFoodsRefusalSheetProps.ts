/**
 * @module @commise/features-recipes/editor — the platform-neutral props of `PrivateFoodsRefusalSheet` (web and native):
 * what the cook sees when the server refuses a public recipe that holds foods only they can see (private foods spec
 * section 7). The host decides which door it came through and what each action does; the sheet draws and calls back.
 */
import type { RefusalDoor } from '../foodPage/privateFoodsRefusal.js';

/** One refused line, as the editor row shows it. */
export interface RefusedLineView {
    readonly rowId: string;
    readonly foodId: string;
    /** The amount as the editor row shows it, or `''`. Drawn strong, as the row draws it. */
    readonly amount: string;
    /** The cook’s words, as the editor row reads them. */
    readonly words: string;
}

/** Props for the `PrivateFoodsRefusalSheet` leaves. */
export interface PrivateFoodsRefusalSheetProps {
    readonly open: boolean;
    readonly door: RefusalDoor;
    /** The existing privateGate outcome for a change to Private is `apply`: Pro, or a free private slot. */
    readonly canGoPrivate: boolean;
    /** At least one: with none, the host does not open the sheet. */
    readonly lines: readonly RefusedLineView[];
    /** Open the food’s page. Web opens a new tab and the sheet stays; native closes the sheet and pushes the page. */
    readonly onOpenFood: (foodId: string) => void;
    /** Switch the recipe to Private and send again in one step. */
    readonly onSendAsPrivate: () => void;
    /** Every close route: Back to editor, Close, Escape, the scrim, a swipe, Android Back. */
    readonly onClose: () => void;
    /** Called once the sheet is off screen after any close, so the host can scroll to the first named row. */
    readonly onDismissed?: () => void;
}
