/**
 * What a page says about WHO made a recipe, WHERE its picture is, whether it is free to read, when it was published and
 * whether it reserves itself from AI: evidence beside the recipe, never part of it.
 *
 * A `PageRecipe` stays exactly what becomes the import. Credit and the image address ride beside it, for the
 * source statement step, so a recipe cannot assert its own provenance.
 *
 * ⛔ Nothing is guessed. Markup that states no licence states none (016 FR-012b): every field may be absent. A text field
 * past its bound is LEFT OUT, never cut short, so a half-sentence is never shown as the credit. An image address is a
 * string only: it is never fetched, and only an absolute `http` or `https` address is kept.
 */
import { safeHttpUrl } from '@kitchensink/recipe-core/external-url';
import { MAX_IMAGE_URL_CHARS } from './pageCaps.js';
import { asList, field, isList, isSchemaNode, scalar, textOf, typeNames } from './schemaNode.js';
import type { SchemaNode } from './schemaNode.js';

/** The most authors kept. */
const MAX_CREDIT_AUTHORS = 10;
/** The longest author, publisher or copyright holder name, in characters. */
const MAX_CREDIT_NAME_CHARS = 200;
/** The longest copyright notice, in characters. */
const MAX_COPYRIGHT_NOTICE_CHARS = 1_000;
/** The longest licence (text or address), in characters. */
const MAX_LICENSE_CHARS = 2_000;

/** Who a page credits. Every field may be absent. */
export interface PageCredit {
    readonly authors: readonly string[];
    readonly publisher?: string;
    readonly copyrightNotice?: string;
    readonly copyrightHolder?: string;
    readonly license?: string;
}

/** What a page states about access and age. Every field may be absent. */
export interface PageAccess {
    /** schema.org `isAccessibleForFree` over every statement on the page (`isAccessibleForFreeOf`). */
    readonly isAccessibleForFree?: boolean;
    /** schema.org `datePublished` as written (`datePublishedOf`), when it is an ISO 8601 date or date-time with a real calendar date. */
    readonly datePublished?: string;
}

/**
 * Evidence beside a recipe. FACTS ONLY: the reader applies no policy to any of them, and none of them changes whether a
 * recipe is read.
 */
export interface PageEvidence extends PageAccess {
    readonly credit: PageCredit;
    /** An absolute http(s) address, never fetched. ABSENT when the page names none that is usable. */
    readonly imageUrl?: string;
    /**
     * Whether the page reserves its content from AI and text-and-data mining: `true` for any reservation `aiOptOutOf`
     * reads, `false` for a `tdm-reservation` of 0 and no reservation, ABSENT for no signal. Read from the page's own
     * `<meta>` tags (an `X-Robots-Tag` only as an http-equiv meta): a paste carries no HTTP headers.
     */
    readonly aiOptOut?: boolean;
}

/** The longest `datePublished` read, in characters. */
const MAX_DATE_CHARS = 40;

/** An ISO 8601 date, with an optional time and zone: anchored, with no repetition that could backtrack. */
const ISO_DATE =
    /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-](\d{2}):?(\d{2}))?)?$/u;

/** schema.org's Boolean values written as an address or a compact name: `https://schema.org/False`, `schema:True`. */
const SCHEMA_BOOLEAN = /^(?:https?:\/\/schema\.org\/|schema:)(true|false)$/u;

/** How one `isAccessibleForFree` statement reads: true, false, or present and unreadable. */
type FreeStatement = boolean | 'unreadable';

/**
 * One stated boolean: `true`, `false`, the text of either in any case, schema.org's address or compact form of either,
 * or a JSON-LD value object (`{"@value": "false"}`) holding one. Anything else is present but unreadable.
 */
function statedBoolean(raw: unknown): FreeStatement {
    if (typeof raw === 'boolean') {
        return raw;
    }

    const value = isSchemaNode(raw) ? field(raw, '@value') : raw;

    if (typeof value === 'boolean') {
        return value;
    }

    const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
    const word = SCHEMA_BOOLEAN.exec(text)?.[1] ?? text;

    return word === 'true' ? true : word === 'false' ? false : 'unreadable';
}

/**
 * The answer from every statement: `false` when any says false; unknown (`undefined`) when none does but one cannot be
 * read, since it may be a paywall; `true` when every statement says true; `undefined` when there is none.
 */
function freeOf(statements: readonly FreeStatement[]): boolean | undefined {
    if (statements.includes(false)) {
        return false;
    }

    return statements.length > 0 && statements.every((statement) => statement === true) ? true : undefined;
}

/** An ISO 8601 date as written, when its calendar date, time and zone are real ("2024-02-30" and "T23:60" are not). */
function isoDate(value: unknown): string | undefined {
    const text = textOf(scalar(value));
    const match = text !== undefined && text.length <= MAX_DATE_CHARS ? ISO_DATE.exec(text) : null;

    if (match === null) {
        return undefined;
    }

    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    // An absent time or zone part reads as 0, which is in range.
    const [hour, minute, second, zoneHour, zoneMinute] = [4, 5, 6, 7, 8].map((group) => Number(match[group] ?? 0));
    const date = new Date(0);

    date.setUTCFullYear(year, month - 1, day);

    const realDate = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
    const realTime = hour <= 23 && minute <= 59 && second <= 59 && zoneHour <= 14 && zoneMinute <= 59;

    return realDate && realTime ? text : undefined;
}

/**
 * The schema.org types of a node that stands for the page a recipe is on: a web page, or an article or post (and their
 * common subtypes). A node of one of these types states what it says about access and age for the whole page.
 */
const PAGE_TYPES: ReadonlySet<string> = new Set([
    'WebPage',
    'ItemPage',
    'CollectionPage',
    'AboutPage',
    'FAQPage',
    'QAPage',
    'MedicalWebPage',
    'Article',
    'NewsArticle',
    'AnalysisNewsArticle',
    'BackgroundNewsArticle',
    'OpinionNewsArticle',
    'ReportageNewsArticle',
    'ReviewNewsArticle',
    'BlogPosting',
    'LiveBlogPosting',
    'SocialMediaPosting',
    'DiscussionForumPosting',
    'Report',
    'TechArticle',
    'ScholarlyArticle',
    'AdvertiserContentArticle',
    'SatiricalArticle',
]);

/** Whether a node stands for the page: one of {@link PAGE_TYPES}. */
export const isPageNode = (node: SchemaNode): boolean => typeNames(node).some((type) => PAGE_TYPES.has(type));

/** The `@id` of a node, or `undefined`. */
const idOf = (node: SchemaNode): unknown => scalar(field(node, '@id'));

/** Whether `container` names `recipe` as its `mainEntity`: the node itself, or a node with the same `@id`. */
function hasMainEntity(container: SchemaNode, recipe: SchemaNode): boolean {
    const id = idOf(recipe);

    return items(field(container, 'mainEntity')).some(
        (entity) => entity === recipe || (isSchemaNode(entity) && typeof id === 'string' && idOf(entity) === id),
    );
}

/** The properties by which a recipe names the page it is on, or a part of that page (Google's paywall markup). */
const RECIPE_LINKS: readonly string[] = ['mainEntityOfPage', 'isPartOf', 'hasPart'];

/** The nodes a node embeds under `keys`, in order. A reference by `@id` alone states nothing and is read as a node. */
function linkedNodes(node: SchemaNode, keys: readonly string[]): readonly SchemaNode[] {
    return keys.flatMap((key) => items(field(node, key)).filter(isSchemaNode));
}

/**
 * When a Recipe node, or the page around it, was published.
 *
 * The recipe is read first, then the nodes it embeds as `mainEntityOfPage`, `isPartOf` and `hasPart`, then its
 * containers: a node whose `mainEntity` is the recipe, then a page node ({@link isPageNode}).
 *
 * @param node - A JSON-LD Recipe node or a microdata item shaped like one.
 * @param containers - The page's other nodes that may contain it: page nodes and nodes with a `mainEntity`. Any other
 *   node is passed over.
 * @returns The first usable `datePublished` in that order, or `undefined`. Pure.
 */
export function datePublishedOf(node: SchemaNode, containers: readonly SchemaNode[]): string | undefined {
    const sources = [
        node,
        ...linkedNodes(node, RECIPE_LINKS),
        ...containers.filter((container) => container !== node && hasMainEntity(container, node)),
        ...containers.filter((container) => container !== node && isPageNode(container)),
    ];

    return sources.map((source) => isoDate(field(source, 'datePublished'))).find((date) => date !== undefined);
}

/**
 * Whether the page is free to read, from EVERY `isAccessibleForFree` statement it makes, in any node of any JSON-LD block
 * and any microdata item. A paywall is stated on the article, a `WebPageElement` two levels down or a node named by `@id`
 * as often as on the recipe, so no statement is passed over for where it sits.
 *
 * @param statements - Every statement's value as written (a list is read item by item).
 * @param complete - Whether every statement was read: `false` when a walk cap cut the read short.
 * @returns `false` when any statement says false; unknown (`undefined`) when none does but one cannot be read or the
 *   read was cut short, since a paywall may be there; `true` when every statement says true; `undefined` when there is
 *   none. Pure.
 */
export function isAccessibleForFreeOf(statements: readonly unknown[], complete: boolean): boolean | undefined {
    const read = statements.flatMap((statement) => items(statement).map(statedBoolean));

    return freeOf(complete ? read : [...read, 'unreadable']);
}

/** The robots tokens that reserve a page from AI, in a robots meta or header for every crawler. */
const NO_AI_TOKENS: ReadonlySet<string> = new Set(['noai', 'noimageai']);

/** The robots tokens that reserve a page from a crawler named for AI: the AI tokens, and keeping it out entirely. */
const NAMED_AI_CRAWLER_TOKENS: ReadonlySet<string> = new Set([...NO_AI_TOKENS, 'noindex', 'none']);

/**
 * Crawlers that read pages for AI training or AI answers, by the name a site writes in a robots meta (lower case). Data:
 * the agents their operators publish. A search crawler (`googlebot`, `bingbot`) is not one.
 */
const AI_CRAWLERS: ReadonlySet<string> = new Set([
    'gptbot',
    'chatgpt-user',
    'oai-searchbot',
    'ccbot',
    'google-extended',
    'anthropic-ai',
    'claudebot',
    'claude-web',
    'perplexitybot',
    'bytespider',
    'amazonbot',
    'applebot-extended',
    'facebookbot',
    'meta-externalagent',
    'cohere-ai',
    'diffbot',
    'imagesiftbot',
    'omgilibot',
    'youbot',
]);

/** A page's `<meta>` element, as its `name`, `http-equiv` and `content`. */
export interface PageMeta {
    readonly name?: string;
    readonly httpEquiv?: string;
    readonly content?: string;
}

/** The robots tokens of a value, split on spaces, commas and semicolons, lower case. */
const robotsTokens = (value: string): readonly string[] => value.split(/[\s,;]+/u).filter((token) => token !== '');

/** X-Robots-Tag directives that take a value after a colon (`max-snippet: 50`): no user agent. */
const VALUE_DIRECTIVES: ReadonlySet<string> = new Set([
    'max-snippet',
    'max-image-preview',
    'max-video-preview',
    'unavailable_after',
]);

/** Whether a robots token reserves the page for `agent` (`undefined`: every agent). */
const reservesFor = (agent: string | undefined, token: string): boolean =>
    NO_AI_TOKENS.has(token) || (agent !== undefined && AI_CRAWLERS.has(agent) && NAMED_AI_CRAWLER_TOKENS.has(token));

/**
 * Whether an `X-Robots-Tag` value reserves the page. A word followed by a colon (spaces allowed before it) that starts with
 * a letter names the user agent the tokens after it are for (`googlebot: noindex, gptbot: none`), unless it is a
 * directive that takes a value (`max-snippet: 50`); a number before a colon is part of a time. `noai` and `noimageai`
 * reserve for every agent (016 FR-024a); `noindex` and `none` only for an AI crawler. One pass over the tokens.
 */
function headerReserves(value: string): boolean {
    const tokens = robotsTokens(value.replaceAll(':', ' : '));
    let agent: string | undefined;

    for (const [index, token] of tokens.entries()) {
        if (tokens[index + 1] === ':') {
            agent = /^\p{L}/u.test(token) && !VALUE_DIRECTIVES.has(token) ? token : agent;
        } else if (token !== ':' && reservesFor(agent, token)) {
            return true;
        }
    }

    return false;
}

/** Whether a meta name is for crawlers: `robots`, or a crawler's own name (`googlebot`, `bingbot`, `gptbot`, `ccbot`). */
const isCrawlerMeta = (key: string): boolean => /bot|spider|crawler|slurp/u.test(key) || AI_CRAWLERS.has(key);

/** Whether one meta reserves the page from AI. */
function metaReserves(key: string | undefined, equiv: string | undefined, value: string): boolean {
    if (key === 'tdm-reservation') {
        return value === '1';
    }

    if (key !== undefined && isCrawlerMeta(key)) {
        return robotsTokens(value).some((token) => reservesFor(key === 'robots' ? undefined : key, token));
    }

    return equiv === 'x-robots-tag' && headerReserves(value);
}

/**
 * Whether a page reserves its content from AI and text-and-data mining (see {@link PageEvidence.aiOptOut}): a TDMRep
 * `tdm-reservation` of 1; `noai` or `noimageai` in a robots or crawler-named meta or an `X-Robots-Tag` http-equiv, for any
 * agent; or `noindex` or `none` for a named AI crawler (its own meta, or its `agent:` segment). A `noindex` for every
 * crawler or for a search crawler is about search, not AI, and is no reservation. Every meta on the page counts, including one
 * inside `<noscript>` or `<template>`: a reservation a cook cannot see still binds, so the read errs toward reserved.
 *
 * @param metas - The page's `<meta>` elements.
 * @returns `true` when any meta reserves the page; else `false` when a `tdm-reservation` of 0 says it does not; else
 *   `undefined` (no signal). Pure.
 */
export function aiOptOutOf(metas: readonly PageMeta[]): boolean | undefined {
    let notReserved = false;

    for (const { name, httpEquiv, content } of metas) {
        const key = name?.trim().toLowerCase();
        const value = content?.trim().toLowerCase() ?? '';

        if (metaReserves(key, httpEquiv?.trim().toLowerCase(), value)) {
            return true;
        }

        notReserved = notReserved || (key === 'tdm-reservation' && value === '0');
    }

    return notReserved ? false : undefined;
}

/** The items of a property, microdata's one-level lists flattened. */
function items(value: unknown): readonly unknown[] {
    return asList(value).flatMap((item) => (isList(item) ? item : [item]));
}

/** The text of a name given as text or as a node with a `name`; `undefined` past `max` characters. */
function nameOf(value: unknown, max: number): string | undefined {
    const text = isSchemaNode(value) ? textOf(field(value, 'name')) : textOf(value);

    return text !== undefined && text.length <= max ? text : undefined;
}

/** The first name among a property's items. */
function firstName(value: unknown, max: number): string | undefined {
    return items(value)
        .map((item) => nameOf(item, max))
        .find((name) => name !== undefined);
}

/** A bounded text, or `undefined` when absent or past `max`. */
function boundedText(value: unknown, max: number): string | undefined {
    const text = textOf(scalar(value));

    return text !== undefined && text.length <= max ? text : undefined;
}

/** A licence: text or an address, or a node naming one by `url`, `@id` or `name`. */
function licenseOf(value: unknown): string | undefined {
    for (const item of items(value)) {
        const text = isSchemaNode(item)
            ? (textOf(field(item, 'url')) ?? textOf(field(item, '@id')) ?? textOf(field(item, 'name')))
            : textOf(item);

        if (text !== undefined && text.length <= MAX_LICENSE_CHARS) {
            return text;
        }
    }

    return undefined;
}

/**
 * Read who a Recipe node credits.
 *
 * @param node - A JSON-LD Recipe node or a microdata item shaped like one.
 * @returns The credit; a field the node does not state, or states past its bound, is absent. Pure.
 */
export function creditOf(node: SchemaNode): PageCredit {
    const authors = [
        ...new Set(items(field(node, 'author')).flatMap((author) => nameOf(author, MAX_CREDIT_NAME_CHARS) ?? [])),
    ].slice(0, MAX_CREDIT_AUTHORS);
    const publisher = firstName(field(node, 'publisher'), MAX_CREDIT_NAME_CHARS);
    const copyrightNotice = boundedText(field(node, 'copyrightNotice'), MAX_COPYRIGHT_NOTICE_CHARS);
    const copyrightHolder = firstName(field(node, 'copyrightHolder'), MAX_CREDIT_NAME_CHARS);
    const license = licenseOf(field(node, 'license'));

    return Object.freeze({
        authors: Object.freeze(authors),
        ...(publisher === undefined ? {} : { publisher }),
        ...(copyrightNotice === undefined ? {} : { copyrightNotice }),
        ...(copyrightHolder === undefined ? {} : { copyrightHolder }),
        ...(license === undefined ? {} : { license }),
    });
}

/**
 * The image addresses a Recipe node names, in order: each `image` that is a string, or an `ImageObject` with a `url` or
 * `contentUrl`. Not yet checked or resolved: see {@link imageUrlOf}.
 *
 * @param node - A JSON-LD Recipe node or a microdata item.
 * @returns The addresses as written, blank ones dropped. Pure.
 */
export function imageRefsOf(node: SchemaNode): readonly string[] {
    return items(field(node, 'image')).flatMap((image) => {
        const raw = isSchemaNode(image) ? (scalar(field(image, 'url')) ?? scalar(field(image, 'contentUrl'))) : image;

        return typeof raw === 'string' && raw.trim() !== '' ? [raw.trim()] : [];
    });
}

/**
 * The first usable image address.
 *
 * @param refs - The addresses as written ({@link imageRefsOf}).
 * @param base - The page's canonical address, which a relative address is resolved against; `undefined` when the page
 *   names none, and a relative address is then dropped.
 * @returns An absolute `http` or `https` address with no credentials, at most {@link MAX_IMAGE_URL_CHARS} characters, or
 *   `undefined`. Nothing is fetched. Pure.
 */
export function imageUrlOf(refs: readonly string[], base: string | undefined): string | undefined {
    for (const ref of refs) {
        if (ref.length > MAX_IMAGE_URL_CHARS) {
            continue;
        }

        try {
            const safe = safeHttpUrl(new URL(ref, base).href);

            if (safe !== null && safe.href.length <= MAX_IMAGE_URL_CHARS) {
                return safe.href;
            }
        } catch {
            // Not an address (a relative one with no base, or garbage): the next one.
        }
    }

    return undefined;
}
