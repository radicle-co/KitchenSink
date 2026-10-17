/**
 * @module @commise/features-recipes/byline/messages — the byline's copy (plan 2026-10-15-010 D11), one table every
 * surface fills its own sentence from ("by {byline}", "Copied from {byline}", "{byline} / {name}").
 *
 * Glossary: the username is shown as "@username". Visible copy never says "handle", "user name" or "screen name".
 */
import type { LocalizedMessages } from '@commise/i18n';

/** The byline's words. */
export interface BylineMessages {
    /** The username as the public handle (contains `{handle}`, the bare username). */
    readonly handle: string;
    /** The handle with the display name beside it (contains `{handle}`, already "@"-prefixed, and `{displayName}`). */
    readonly handleWithName: string;
    /** An erased author, inside a sentence ("by a former member"). */
    readonly formerMember: string;
    /** An erased author, standing alone (a card, a dialog line). */
    readonly formerMemberStandalone: string;
}

export const bylineMessages: LocalizedMessages<BylineMessages> = {
    en: {
        handle: '@{handle}',
        handleWithName: '{handle} ({displayName})',
        formerMember: 'a former member',
        formerMemberStandalone: 'Former member',
    },
};
