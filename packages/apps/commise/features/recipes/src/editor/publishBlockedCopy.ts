/**
 * @module @commise/features-recipes/editor — the words of the dialog a Publish opens when the cook chose Private and cannot
 * keep it (owner ruling 2026-10-26), and the one switch that keeps its Premium line off until there is somewhere to send
 * the cook.
 *
 * Pure and platform-agnostic.
 *
 * @pattern Policy — one pure decision of which words the blocked-publish dialog says
 */
import type { PublishBlocked } from '../hooks/useRecipeEditor.js';
import { fillTemplate } from '../format/fillTemplate.js';
import type { EditorMessages } from './messages.js';

/**
 * Whether the dialog may sell Premium: the upsell line and "See Premium". ⛔ OFF until feature 010 (the subscription page)
 * exists - owner ruling 2026-10-26: there is no destination for "See Premium" yet, and none may be invented. Off, every
 * dialog reads as its paid-features-hidden variant. Turning it on is this one change, plus giving the dialog a destination
 * and the `{premiumFeatures}` list.
 */
export const PUBLISH_BLOCKED_PREMIUM_UPSELL = false;

/** What the dialog says. */
export interface PublishBlockedCopy {
    readonly title: string;
    readonly body: string;
    /** The Premium line, only while {@link PUBLISH_BLOCKED_PREMIUM_UPSELL} is on. */
    readonly upsell: string | undefined;
}

/**
 * The dialog's words for a blocked Publish. Pure.
 *
 * @param ask - Which case blocked it.
 * @param slotTotal - The cook's private-slot limit, for the `noSlot` case.
 * @param messages - The editor's words.
 * @param premiumFeatures - What Premium adds, for the upsell line (only read while the switch is on).
 */
export function publishBlockedCopyOf(
    ask: PublishBlocked,
    slotTotal: number,
    messages: EditorMessages['publishBlocked'],
    premiumFeatures = '',
): PublishBlockedCopy {
    if (ask.kind === 'noSlot') {
        return {
            title: messages.noSlot.title,
            body: fillTemplate(messages.noSlot.body, { total: slotTotal }),
            upsell: PUBLISH_BLOCKED_PREMIUM_UPSELL
                ? fillTemplate(messages.noSlot.upsell, { premiumFeatures })
                : undefined,
        };
    }

    const sellsPremium = PUBLISH_BLOCKED_PREMIUM_UPSELL && ask.refusal === 'premium';

    return {
        title: messages.webImport.title,
        body: sellsPremium ? messages.webImport.body : messages.webImport.bodyNoPaid,
        upsell: sellsPremium ? fillTemplate(messages.webImport.upsell, { premiumFeatures }) : undefined,
    };
}
