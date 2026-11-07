/**
 * @module @commise/features-recipes/editor — what the editor's ONE polite region says when a section becomes complete or
 * a paste finishes (build spec §7.2; designer rulings 2026-11-06).
 *
 * - A section the cook's own edit completed: "{Section} complete", the first in page order.
 * - A paste finishing ("Added 6 ingredients."): the editor says it, not the section, so that when the SAME settle
 *   completes Ingredients the cook hears ONE message, "Added 6 ingredients. Ingredients complete.", never two in a breath.
 * - Pasted lines that fail and wait on the cook ("Needs you") are never announced: their block already says it.
 *
 * Pure. No React.
 *
 * @pattern Policy — a pure projection of two status snapshots and the paste's count into at most one message
 */
import { pluralOf } from '../format/plural.js';
import type { EditorMessages } from './messages.js';
import { newlyComplete, type SectionStatuses } from './sectionStatus.js';

/** What a paste last added, as the paste counts it: `occurrence` moves once per finished paste. */
export interface PasteAdded {
    readonly count: number;
    readonly occurrence: number;
}

/** What the message is derived from. */
export interface PageAnnouncementInput {
    readonly previous: SectionStatuses;
    readonly next: SectionStatuses;
    /** The paste's `added` when last looked at, and now. */
    readonly previousAdded: PasteAdded | undefined;
    readonly nextAdded: PasteAdded | undefined;
    readonly messages: EditorMessages;
    readonly locale: string;
}

/**
 * The one message for this change, or `undefined` when there is nothing to say.
 *
 * @param input - The statuses and paste counts before and after.
 * @returns The text to speak. Pure.
 */
export function pageAnnouncementOf(input: PageAnnouncementInput): string | undefined {
    const { previous, next, previousAdded, nextAdded, messages, locale } = input;
    const complete = newlyComplete(previous, next);
    const [first] = complete;
    const finished = nextAdded !== undefined && nextAdded.occurrence !== (previousAdded?.occurrence ?? 0);

    if (finished && complete.includes('ingredients')) {
        return pluralOf(messages.index.announceAddedComplete, nextAdded.count, locale);
    }

    if (finished) {
        return pluralOf(messages.ingredients.pasteAdded, nextAdded.count, locale);
    }

    return first === undefined ? undefined : messages.index.announce[first];
}
