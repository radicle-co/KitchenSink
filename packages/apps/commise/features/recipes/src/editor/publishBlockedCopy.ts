/**
 * @module @commise/features-recipes/editor — the words of the dialog a Publish opens when the cook chose Private and cannot
 * keep it (owner ruling 2026-10-26). Whether it may sell Pro is the one subscription-entry-point switch
 * (`@commise/features-account`, spec 010 T-035), passed in so both positions are testable.
 *
 * Pure and platform-agnostic.
 *
 * @pattern Policy — one pure decision of which words the blocked-publish dialog says
 */
import { fillTemplate } from '../format/fillTemplate.js';
import type { EditorMessages } from './messages.js';

/** What the dialog says. */
export interface PublishBlockedCopy {
    readonly title: string;
    readonly body: string;
    /** The Premium line, only while the subscription-entry-point switch is on. */
    readonly upsell: string | undefined;
}

/**
 * The dialog's words for a blocked Publish. Pure.
 *
 * @param slotTotal - The cook's private-slot limit, for the `noSlot` case; `undefined` when it is not known, which says no number.
 * @param messages - The editor's words.
 * @param sellsPro - The subscription-entry-point switch; off, no variant sells Pro.
 * @param premiumFeatures - What Premium adds, for the upsell line (only read while the switch is on).
 * @param webSource - The recipe is a copy of a web page (ADR-0089): it can only be private, so the words offer no way to
 *   publish it as public and none that removes the source.
 */
export function publishBlockedCopyOf(
    slotTotal: number | undefined,
    messages: EditorMessages['publishBlocked'],
    sellsPro: boolean,
    premiumFeatures = '',
    webSource = false,
): PublishBlockedCopy {
    const { noSlot } = messages;
    const [counted, uncounted] = webSource
        ? [noSlot.bodyWebSource, noSlot.bodyWebSourceNoCount]
        : [noSlot.body, noSlot.bodyNoCount];

    return {
        title: noSlot.title,
        body: slotTotal === undefined ? uncounted : fillTemplate(counted, { total: slotTotal }),
        upsell: sellsPro ? fillTemplate(messages.noSlot.upsell, { premiumFeatures }) : undefined,
    };
}
