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
import type { PublicRefusal } from '../actions/publicRefusal.js';
import type { EditorMessages } from './messages.js';
import type { PublishBlockedSheetProps } from './publishBlockedSheetProps.js';

/** What the dialog says. */
export interface PublishBlockedCopy {
    readonly title: string;
    readonly body: string;
    /** The Premium line, only while the subscription-entry-point switch is on. */
    readonly upsell: string | undefined;
}

/** Which pair of bodies the dialog says: a web copy first, then another refusal, then the plain no-slot words. */
function bodiesOf(
    noSlot: EditorMessages['publishBlocked']['noSlot'],
    webSource: boolean,
    refused: boolean,
): readonly [counted: string, uncounted: string] {
    if (webSource) {
        return [noSlot.bodyWebSource, noSlot.bodyWebSourceNoCount];
    }

    if (refused) {
        return [noSlot.bodyRefused, noSlot.bodyRefusedNoCount];
    }

    return [noSlot.body, noSlot.bodyNoCount];
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
 * @param refused - Public is refused for another reason (a book, a paid site, another person, a kind this app cannot name): the
 *   words offer no public path either. `webSource` wins when both are set.
 */
export function publishBlockedCopyOf(
    slotTotal: number | undefined,
    messages: EditorMessages['publishBlocked'],
    sellsPro: boolean,
    premiumFeatures = '',
    webSource = false,
    refused = false,
): PublishBlockedCopy {
    const { noSlot } = messages;
    const [counted, uncounted] = bodiesOf(noSlot, webSource, refused);

    return {
        title: noSlot.title,
        body: slotTotal === undefined ? uncounted : fillTemplate(counted, { total: slotTotal }),
        upsell: sellsPro ? fillTemplate(messages.noSlot.upsell, { premiumFeatures }) : undefined,
    };
}

/**
 * What the blocked-publish sheet offers for Public: the control when nothing refuses it, otherwise the flag that picks
 * the words for the reason there is none (a web copy keeps its own). Pure.
 */
export function publicOfferOf(
    refusal: PublicRefusal,
    webSource: boolean,
    publish: () => void,
): Pick<PublishBlockedSheetProps, 'onPublishPublic' | 'webSource' | 'refused'> {
    if (refusal === 'none') {
        return { onPublishPublic: publish };
    }

    return webSource ? { webSource: true } : { refused: true };
}
