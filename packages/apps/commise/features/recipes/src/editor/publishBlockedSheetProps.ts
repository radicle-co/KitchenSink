/**
 * @module @commise/features-recipes/editor — the contract `PublishBlockedSheet`'s web and native leaves share.
 */
import type { PublishBlocked } from '../hooks/useRecipeEditor.js';

/** Props for `PublishBlockedSheet`. */
export interface PublishBlockedSheetProps {
    /** Whether the sheet is shown; closed, it renders nothing. */
    readonly open: boolean;
    /** Which case blocked the Publish, which decides the words (`publishBlockedCopyOf`). */
    readonly ask: PublishBlocked;
    /** The cook's private-slot limit, for the `noSlot` words. */
    readonly slotTotal: number;
    /**
     * Keep the recipe a draft with the cook's Private choice intact; nothing is sent. EVERY way out of the sheet calls
     * this (Close, Escape, the scrim, a swipe, Android Back): dismissing never publishes.
     */
    readonly onKeepDraft: () => void;
    /** Publish with visibility public. Only this control calls it. */
    readonly onPublishPublic: () => void;
}
