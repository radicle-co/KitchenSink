/**
 * @module @commise/features-recipes/editor — the words of the dialog a Publish opens when the cook chose Private and cannot
 * keep it (owner ruling 2026-10-26). Whether it may sell Pro is the one subscription-entry-point switch
 * (`@commise/features-account`, spec 010 T-035), passed in so both positions are testable.
 *
 * Pure and platform-agnostic.
 *
 * @pattern Policy — one pure decision of which words the blocked-publish dialog says
 */
import { fillTemplate } from '@commise/i18n';
import type { BlockingRefusal, PublicRefusal } from '../actions/publicRefusal.js';
import type { EditorMessages } from './messages.js';
import type { PublishBlockedSheetProps } from './publishBlockedSheetProps.js';

/** What the dialog says. */
export interface PublishBlockedCopy {
    readonly title: string;
    readonly body: string;
    /** The Premium line, only while the subscription-entry-point switch is on. */
    readonly upsell: string | undefined;
}

/** Which pair of bodies the dialog says: the web words for a web copy, the refused words for any other reason, else the plain no-slot words. */
function bodiesOf(
    noSlot: EditorMessages['publishBlocked']['noSlot'],
    refusal: BlockingRefusal | undefined,
): readonly [counted: string, uncounted: string] {
    if (refusal === undefined) {
        return [noSlot.body, noSlot.bodyNoCount];
    }

    return refusal === 'policy.webPage'
        ? [noSlot.bodyWebSource, noSlot.bodyWebSourceNoCount]
        : [noSlot.bodyRefused, noSlot.bodyRefusedNoCount];
}

/**
 * The dialog's words for a blocked Publish. Pure.
 *
 * @param slotTotal - The cook's private-slot limit, for the `noSlot` case; `undefined` when it is not known, which says no number.
 * @param messages - The editor's words.
 * @param sellsPro - The subscription-entry-point switch; off, no variant sells Pro.
 * @param premiumFeatures - What Premium adds, for the upsell line (only read while the switch is on).
 * @param refusal - Why the recipe cannot be public, when it cannot. A web copy (`policy.webPage`, ADR-0089) gets the web
 *   words, any other reason the refused words, and neither offers a public path. Absent: the plain words.
 */
export function publishBlockedCopyOf(
    slotTotal: number | undefined,
    messages: EditorMessages['publishBlocked'],
    sellsPro: boolean,
    premiumFeatures = '',
    refusal?: BlockingRefusal,
): PublishBlockedCopy {
    const { noSlot } = messages;
    const [counted, uncounted] = bodiesOf(noSlot, refusal);

    return {
        title: noSlot.title,
        body: slotTotal === undefined ? uncounted : fillTemplate(counted, { total: slotTotal }),
        upsell: sellsPro ? fillTemplate(messages.noSlot.upsell, { premiumFeatures }) : undefined,
    };
}

/**
 * What the blocked-publish sheet offers for Public: the control when nothing refuses it, otherwise the reason there is
 * none, which picks the words. Pure.
 */
export function publicOfferOf(
    refusal: PublicRefusal,
    publish: () => void,
): Pick<PublishBlockedSheetProps, 'onPublishPublic' | 'refusal'> {
    return refusal === 'none' ? { onPublishPublic: publish } : { refusal };
}
