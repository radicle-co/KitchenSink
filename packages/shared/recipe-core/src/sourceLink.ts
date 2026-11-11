/**
 * The web link a cook pastes as a recipe's source (ADR-0089).
 *
 * DESIGN PATTERN: **Value Object + Parse, don't validate**. {@link parseSourceLink} turns text into a {@link SourceLink}
 * (a proved http(s) address and the site it names) or a named refusal, and nothing else in the editor or the service
 * judges a link: the form, the paste sheets and `evaluateProvenance` all read this one parse, so the client's idea of a
 * source and the server's cannot drift. Everything here is pure and never fetches the page.
 *
 * The signal is a link the cook PASTES. A copied text selection carries no address, and no site is recognised by its
 * wording or layout, so a recipe the cook typed or pasted without a link is never labelled.
 *
 * The site is the REGISTRABLE domain from the Public Suffix List (`tldts`), so `www.example.co.uk` and `m.example.co.uk`
 * are both `example.co.uk`. Our own domain is never a source: a Commise link is a page of this app, not a page the recipe
 * was copied from.
 */
import { getDomain, parse } from 'tldts';

import { safeHttpUrl } from './externalUrl.js';

/** The longest source link, in characters. Mirrors the `recipe_import_items` citation CHECK and the stored `source_url`. */
export const SOURCE_LINK_MAX_LENGTH = 2_000;

/** Our own registrable domain. A link to it, or to any subdomain of it, is not a source. */
export const OWN_SITE_DOMAIN = 'commise.app';

/** A proved web source: the address to store and the site to show. */
export interface SourceLink {
    /** The absolute http(s) address, as the URL parser re-serializes it. */
    readonly url: string;
    /** The registrable domain of the host (`allrecipes.com`), shown as the source. */
    readonly site: string;
}

/** Why a text is not a usable source: not a public web link at all, or a link to this app. */
export type SourceLinkRefusal = 'invalid' | 'ownSite';

/** The result of reading one text as a source link. */
export type SourceLinkResult =
    { readonly ok: true; readonly link: SourceLink } | { readonly ok: false; readonly reason: SourceLinkRefusal };

/** What {@link extractSourceLink} found in a pasted block. */
export interface SourceLinkExtraction {
    /** The first line that was only a link to an outside site. ABSENT when there was none. */
    readonly link?: SourceLink;
    /** Whether a line that was only a link to our own site was dropped from the text. */
    readonly ownSiteLeftOut: boolean;
    /** The pasted text without those link lines. */
    readonly remaining: string;
}

const INVALID: SourceLinkResult = { ok: false, reason: 'invalid' };

/** Sentence punctuation that sticks to the end of a pasted address. */
const TRAILING_PUNCTUATION = /[.,;:!?)\]}>'"]+$/;

/** A line that is only a link, optionally after a short label such as `Source:`. */
const LINK_ONLY_LINE = /^\s*(?:[\p{L} ]{1,24}:\s*)?(https?:\/\/\S+)\s*$/iu;

/**
 * Read `text` as a recipe's web source.
 *
 * Refused as `invalid`: anything that is not one absolute http(s) address with a public host (other schemes, embedded
 * credentials, spaces, an address over {@link SOURCE_LINK_MAX_LENGTH}, `localhost`, a bare or IPv6 address). Refused as
 * `ownSite`: our own domain or a subdomain of it.
 *
 * @param text - What the cook typed or pasted into the source field.
 * @returns The link, or why it is not one. Pure.
 */
export function parseSourceLink(text: string): SourceLinkResult {
    const candidate = text.trim().replace(TRAILING_PUNCTUATION, '');

    if (candidate === '' || candidate.length > SOURCE_LINK_MAX_LENGTH || /\s/.test(candidate)) {
        return INVALID;
    }

    const safe = safeHttpUrl(candidate);

    if (safe === null) {
        return INVALID;
    }

    const host = parse(safe.href);
    const site = getDomain(safe.href);

    // A host with no registrable domain (`localhost`, a bare or IPv6 address) is not a public web page.
    if (host.isIp === true || site === null || site === '' || safe.href.length > SOURCE_LINK_MAX_LENGTH) {
        return INVALID;
    }

    if (site === OWN_SITE_DOMAIN) {
        return { ok: false, reason: 'ownSite' };
    }

    return { ok: true, link: { url: safe.href, site } };
}

/**
 * Take the source link out of a pasted block (a list of ingredients or of steps).
 *
 * A line that is ONLY a link, with or without a `Label:` before it, is removed; a link inside a sentence stays, because
 * it is the cook's words. The first line that is a link to an outside site becomes the source, and any later one stays as
 * text. A line that is only a link to OUR site is removed and reported, so the cook is told it was left out. A line that
 * is only a link but is not a usable source (`http://localhost/a`) stays as text. Line breaks come back as `\n`.
 *
 * @param pasted - The pasted text.
 * @returns The link if one was found, whether an own-site link was dropped, and the text that is left. Pure.
 */
export function extractSourceLink(pasted: string): SourceLinkExtraction {
    let link: SourceLink | undefined;
    let ownSiteLeftOut = false;
    const kept: string[] = [];

    for (const line of pasted.split(/\r?\n/)) {
        const address = LINK_ONLY_LINE.exec(line)?.[1];
        const parsed = address === undefined ? undefined : parseSourceLink(address);

        if (parsed?.ok === true && link === undefined) {
            link = parsed.link;
        } else if (parsed?.ok === false && parsed.reason === 'ownSite') {
            ownSiteLeftOut = true;
        } else {
            kept.push(line);
        }
    }

    return { ...(link === undefined ? {} : { link }), ownSiteLeftOut, remaining: kept.join('\n') };
}
