/**
 * @module @commise/features-recipes/collections/sourceOwnerByline — the byline of a copied collection's source owner,
 * through the one byline rule (plan 2026-10-15-010 D11). The header, the list card and the pull dialog each fill their
 * own sentence around it ("Copied from {byline}", "{byline} / {name}").
 *
 * The display name is the one frozen at clone time; the username is resolved by the service whenever the clone is
 * read (D7), so it names the source owner as they are now.
 *
 * Pure.
 */
import { bylineOf } from '../byline/bylineOf.js';
import { bylineText } from '../byline/bylineText.js';
import type { BylineMessages } from '../byline/messages.js';

/** What a copy carries about its source collection's owner. */
export interface SourceOwner {
    readonly sourceOwnerUsername?: string;
    readonly sourceOwnerDisplayName?: string;
}

/**
 * The source owner's byline text, or `undefined` when nothing is known about them.
 *
 * @param source - The copy's source-owner fields.
 * @param copy - The byline copy.
 * @param form - `sentence` inside "Copied from …"; `standalone` on its own line.
 */
export function sourceOwnerBylineText(
    source: SourceOwner,
    copy: BylineMessages,
    form: 'standalone' | 'sentence',
): string | undefined {
    return bylineText(
        bylineOf({
            ...(source.sourceOwnerUsername === undefined ? {} : { username: source.sourceOwnerUsername }),
            ...(source.sourceOwnerDisplayName === undefined ? {} : { displayName: source.sourceOwnerDisplayName }),
        }),
        copy,
        form,
    );
}
