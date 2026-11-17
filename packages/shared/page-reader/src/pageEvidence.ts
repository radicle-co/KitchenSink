/**
 * What a page says about WHO made a recipe, WHERE its picture is and WHEN it was published: evidence beside the recipe,
 * never part of it.
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

/**
 * Evidence beside a recipe. FACTS ONLY: the reader applies no policy to any of them, and none of them changes whether a
 * recipe is read.
 */
export interface PageEvidence {
    readonly credit: PageCredit;
    /** schema.org `datePublished` as written (`datePublishedOf`), when it is an ISO 8601 date or date-time with a real calendar date. */
    readonly datePublished?: string;
    /** An absolute http(s) address, never fetched. ABSENT when the page names none that is usable. */
    readonly imageUrl?: string;
}

/** The longest `datePublished` read, in characters. */
const MAX_DATE_CHARS = 40;

/**
 * An ISO 8601 date, with an optional time and zone: anchored, with no repetition that could backtrack. Hand-written on
 * purpose: no date library is a dependency, and zod 4.6's `iso.datetime` refuses the `+0200` offset and a time with an
 * offset but no seconds (`T10:00+02:00`), which real pages write, and needs a second schema for a bare date.
 */
const ISO_DATE =
    /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-](\d{2}):?(\d{2}))?)?$/u;

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
 * common subtypes). A node of one of these types states when the whole page was published. `CollectionPage` is left
 * out on purpose: a roundup's date is never its recipes' date.
 */
const PAGE_TYPES: ReadonlySet<string> = new Set([
    'WebPage',
    'ItemPage',
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

/**
 * The properties by which a recipe names the page it is on. Only a page node ({@link isPageNode}) is read from them: a
 * whole blog, site or roundup (`isPartOf`) or a part of the page (`hasPart`) states no date for the recipe.
 */
const RECIPE_LINKS: readonly string[] = ['mainEntityOfPage', 'isPartOf'];

/**
 * The page's nodes that may contain a recipe, indexed once per page so each recipe's date is read in time linear in what
 * it names: the page nodes, the nodes with a `mainEntity`, and every one of them by its `@id`.
 */
export interface PageGraph {
    readonly pages: readonly SchemaNode[];
    readonly mainEntityHolders: readonly SchemaNode[];
    readonly byId: ReadonlyMap<string, readonly SchemaNode[]>;
}

/**
 * Index a page's container nodes for {@link datePublishedOf}.
 *
 * @param containers - The page's page nodes and nodes with a `mainEntity`, in page order.
 * @returns The index, built in one pass. Pure.
 */
export function pageGraphOf(containers: readonly SchemaNode[]): PageGraph {
    const byId = new Map<string, SchemaNode[]>();

    for (const container of containers) {
        const id = idOf(container);

        if (typeof id === 'string') {
            const named = byId.get(id);

            if (named === undefined) {
                byId.set(id, [container]);
            } else {
                named.push(container);
            }
        }
    }

    return {
        pages: containers.filter(isPageNode),
        mainEntityHolders: containers.filter((container) => field(container, 'mainEntity') !== undefined),
        byId,
    };
}

/**
 * The nodes a recipe names under `keys`, in order: each node it embeds, then the page's nodes that its `@id`, or a bare
 * address in its place, names ("mainEntityOfPage": {"@id": ".../pie"}), as JSON-LD links them. One lookup per name.
 */
function linkedNodes(node: SchemaNode, keys: readonly string[], graph: PageGraph): readonly SchemaNode[] {
    return keys.flatMap((key) =>
        items(field(node, key)).flatMap((item) => {
            const id = isSchemaNode(item) ? idOf(item) : item;
            const named = typeof id === 'string' ? (graph.byId.get(id) ?? []) : [];

            return [...(isSchemaNode(item) ? [item] : []), ...named];
        }),
    );
}

/**
 * The page's one page node, when it has exactly one (counted by `@id`) that names no other node as its `mainEntity`.
 * With two or more, nothing ties either to the recipe: one may be a related post, a comment or another recipe's page.
 */
function solePageNode(node: SchemaNode, graph: PageGraph): readonly SchemaNode[] {
    const pages = graph.pages.filter(
        (page) => page !== node && (field(page, 'mainEntity') === undefined || hasMainEntity(page, node)),
    );
    const distinct = new Set(
        pages.map((page) => {
            const id = idOf(page);

            return typeof id === 'string' ? id : page;
        }),
    );

    return distinct.size === 1 ? pages.slice(0, 1) : [];
}

/**
 * When a Recipe node, or the page it is on, was published.
 *
 * A date the recipe states is the answer, and one it states that cannot be read gives no date: another node's date is
 * never put in its place. Without one, the page nodes it names as `mainEntityOfPage` or `isPartOf` (embedded or by
 * `@id`) are read, then a node whose `mainEntity` is the recipe, then the page's one page node ({@link solePageNode}).
 *
 * @param node - A JSON-LD Recipe node or a microdata item shaped like one.
 * @param graph - The page's container nodes, indexed once per page ({@link pageGraphOf}).
 * @returns The first usable `datePublished` in that order, or `undefined`. Pure.
 */
export function datePublishedOf(node: SchemaNode, graph: PageGraph): string | undefined {
    const stated = field(node, 'datePublished');

    if (stated !== undefined) {
        return isoDate(stated);
    }

    const sources = [
        ...linkedNodes(node, RECIPE_LINKS, graph).filter((linked) => linked !== node && isPageNode(linked)),
        ...graph.mainEntityHolders.filter((container) => container !== node && hasMainEntity(container, node)),
        ...solePageNode(node, graph),
    ];

    return sources.map((source) => isoDate(field(source, 'datePublished'))).find((date) => date !== undefined);
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
