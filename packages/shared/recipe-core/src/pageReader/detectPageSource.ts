/**
 * The site a pasted page says it came from.
 *
 * DESIGN PATTERN: **Specification**. One predicate set over the page and the recipe node's own links: the ORDER of
 * preference, then the AGREEMENT rule. Every address goes through `parseSourceLink`, the one source reader (ADR-0089),
 * so our own site, `localhost`, IP addresses, credentials and `javascript:` are refused here exactly as the editor and the
 * server refuse them.
 *
 * ⛔ A detected source is a SUGGESTION, never a statement (ADR-0089 §7): the cook still confirms it. So when the page is
 * unsure the answer is `none`. Two valid addresses that name different registrable domains give `none`, and the site is
 * never guessed from a publisher name, a title or a layout (ADR-0089 §1, §3). Nothing is fetched.
 */
import { SOURCE_LINK_INPUT_MAX_LENGTH, parseSourceLink } from '../sourceLink.js';
import type { SourceLink } from '../sourceLink.js';
import type { PageDocument } from './pageDocument.js';

/** What detection found: a suggested source, or nothing. */
export type DetectedSource = { readonly kind: 'found'; readonly citation: SourceLink } | { readonly kind: 'none' };

const NONE: DetectedSource = Object.freeze({ kind: 'none' });

/** The longest scheme read (`https`, `javascript`, `chrome-extension`); a longer prefix is not one. */
const MAX_SCHEME_CHARS = 32;

/** Whether `text` starts with a scheme (`https:`, `javascript:`), so it is not a relative reference. */
function hasScheme(text: string): boolean {
    const colon = text.indexOf(':');

    return colon > 0 && colon <= MAX_SCHEME_CHARS && /^[a-z][a-z0-9+.-]*$/iu.test(text.slice(0, colon));
}

/** `raw` made absolute against `base`, or unchanged when it already has a scheme; `undefined` when it cannot be. */
function resolved(raw: string, base: string | undefined): string | undefined {
    if (raw.length > SOURCE_LINK_INPUT_MAX_LENGTH) {
        return undefined;
    }

    if (hasScheme(raw)) {
        return raw;
    }

    try {
        return base === undefined ? undefined : new URL(raw, base).href;
    } catch {
        return undefined;
    }
}

/** The first non-blank value of `attribute` on the elements of `tag` that pass `test`. */
function firstAttribute(
    page: PageDocument,
    tag: string,
    attribute: string,
    test: (element: { attr(name: string): string | undefined }) => boolean,
): string | undefined {
    for (const element of page.byTag(tag)) {
        const value = element.attr(attribute)?.trim();

        if (test(element) && value !== undefined && value !== '') {
            return value;
        }
    }

    return undefined;
}

/** What a page says about its own address: read once per page, then combined with each recipe's own links. */
export interface PageAddresses {
    readonly canonical: string | undefined;
    readonly ogUrl: string | undefined;
    readonly baseHref: string | undefined;
}

/**
 * Read the addresses a page states for itself.
 *
 * @param page - The parsed paste.
 * @returns The canonical link, the `og:url` and the `<base href>`, each as written or `undefined`. Pure.
 */
export function pageAddressesOf(page: PageDocument): PageAddresses {
    return {
        canonical: firstAttribute(page, 'link', 'href', (link) =>
            (link.attr('rel') ?? '').toLowerCase().split(/\s+/u).includes('canonical'),
        ),
        ogUrl: firstAttribute(
            page,
            'meta',
            'content',
            (meta) => meta.attr('property') === 'og:url' || meta.attr('name') === 'og:url',
        ),
        baseHref: firstAttribute(page, 'base', 'href', () => true),
    };
}

/**
 * Read each address as a source link, a relative one against `<base href>`, else the first absolute address given.
 *
 * @param addresses - What the page states for itself.
 * @param raws - The addresses to read, as written, in order.
 * @returns The ones that are valid source links, in order. An address that cannot be made absolute or is refused by
 *   `parseSourceLink` is dropped. Pure.
 */
export function sourceLinksOf(addresses: PageAddresses, raws: readonly string[]): readonly SourceLink[] {
    const base = [addresses.baseHref, ...raws].find((raw) => {
        const absolute = raw === undefined || !hasScheme(raw) ? undefined : parseSourceLink(raw);

        return absolute?.ok === true;
    });

    return raws.flatMap((raw) => {
        const absolute = resolved(raw, base);
        const parsed = absolute === undefined ? undefined : parseSourceLink(absolute);

        return parsed?.ok === true ? [parsed.link] : [];
    });
}

/**
 * Detect the source of a pasted page.
 *
 * @param page - The parsed paste.
 * @param nodeLinks - The addresses the recipe node names for itself (`url`, then `mainEntityOfPage`), in that order.
 * @returns The first valid address in the order canonical link, `og:url`, node links, when every valid address names the
 *   same registrable domain; otherwise `none`. A relative address is read against `<base href>`, or else the first
 *   absolute address the page gives, and is dropped when there is neither. Pure.
 */
export function detectPageSource(page: PageDocument | PageAddresses, nodeLinks: readonly string[]): DetectedSource {
    const addresses = 'byTag' in page ? pageAddressesOf(page) : page;
    const raws = [addresses.canonical, addresses.ogUrl, ...nodeLinks].flatMap((raw) =>
        raw === undefined ? [] : [raw],
    );
    const links = sourceLinksOf(addresses, raws);
    const [first] = links;

    if (first === undefined || links.some((link) => link.site !== first.site)) {
        return NONE;
    }

    return Object.freeze({ kind: 'found', citation: Object.freeze(first) });
}
