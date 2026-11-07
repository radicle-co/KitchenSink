/**
 * @module @commise/features-recipes/editor — the contract `PublishOpenChoicesSheet`'s web and native leaves share.
 */
import type { OpenChoicesFacts } from './openChoicesCopy.js';

/** Props for `PublishOpenChoicesSheet`. */
export interface PublishOpenChoicesSheetProps {
    /** Whether the sheet is shown; closed, it renders nothing. */
    readonly open: boolean;
    /** The open and checking lines, and how many lines count (`openChoicesCopyOf`). */
    readonly facts: OpenChoicesFacts;
    /** Go back and choose; nothing is published. */
    readonly onChooseNow: () => void;
    /** Publish, with the open lines saved as written. */
    readonly onPublishAnyway: () => void;
    /** Every close route (Close, Escape, the scrim, a swipe, Android back) calls this with `false`. */
    readonly onOpenChange: (open: boolean) => void;
}
