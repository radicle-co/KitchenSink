/**
 * @module @commise/features-recipes/editor — the contract `PublishBlockedSheet`'s web and native leaves share.
 */
/** Props for `PublishBlockedSheet`. */
export interface PublishBlockedSheetProps {
    /** Whether the sheet is shown; closed, it renders nothing. */
    readonly open: boolean;
    /** The cook's private-slot limit, for the `noSlot` words; `undefined` when not known (the words then say no number). */
    readonly slotTotal: number | undefined;
    /**
     * Keep the recipe a draft with the cook's Private choice intact; nothing is sent. EVERY way out of the sheet calls
     * this (Close, Escape, the scrim, a swipe, Android Back): dismissing never publishes.
     */
    readonly onKeepDraft: () => void;
    /** Publish with visibility public. Only this control calls it. */
    readonly onPublishPublic: () => void;
}
