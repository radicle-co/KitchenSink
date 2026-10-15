/**
 * @module @commise/features-recipes/byline/bylineText — the words a {@link Byline} renders, from {@link BylineMessages}.
 *
 * Every piece of USER text is wrapped in a Unicode isolate. A display name is the cook's own words and can be
 * right-to-left inside an English line; unisolated, the bidi algorithm can carry the "@handle" and the parentheses
 * around the name out of order. The isolate characters are invisible and screen readers skip them.
 *
 * Pure.
 */
import { fillTemplate } from '../format/fillTemplate.js';
import type { Byline } from './bylineOf.js';
import type { BylineMessages } from './messages.js';

/** FIRST STRONG ISOLATE … POP DIRECTIONAL ISOLATE around `text`. Pure. */
export function isolate(text: string): string {
    return `⁨${text}⁩`;
}

/**
 * The byline's text, or `undefined` when the surface renders none (a source line and nothing-known are each
 * surface's own copy). Pure.
 *
 * @param byline - From `bylineOf`.
 * @param copy - The byline copy.
 * @param form - `standalone` on a card or dialog line; `sentence` inside "by …" / "Copied from …".
 */
export function bylineText(byline: Byline, copy: BylineMessages, form: 'standalone' | 'sentence'): string | undefined {
    switch (byline.kind) {
        case 'person': {
            const handle = isolate(fillTemplate(copy.handle, { handle: byline.username }));

            return byline.displayName === undefined
                ? handle
                : fillTemplate(copy.handleWithName, { handle, displayName: isolate(byline.displayName) });
        }
        case 'name':
            return isolate(byline.displayName);
        case 'former':
            return form === 'sentence' ? copy.formerMember : copy.formerMemberStandalone;
        case 'source':
        case 'none':
            return undefined;
    }
}
