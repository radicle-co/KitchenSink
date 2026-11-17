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
import { asList, field, isList, isSchemaNode, scalar, textOf } from './schemaNode.js';
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

/** What a Recipe node states about access and age. Every field may be absent: the node states nothing usable. */
export interface PageAccess {
    /** schema.org `isAccessibleForFree`: `true` or `false` as stated (a boolean, or the text "true" or "false"). */
    readonly isAccessibleForFree?: boolean;
    /** schema.org `datePublished` as written, when it is an ISO 8601 date or date-time with a real calendar date. */
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
     * Whether the page reserves its content from AI and text-and-data mining: `true` for a TDMRep `tdm-reservation` of 1
     * or a robots `noai` or `noimageai`, `false` for a `tdm-reservation` of 0 and no reservation, ABSENT for no signal.
     * Read from the page's own `<meta>` tags; a paste carries no HTTP headers.
     */
    readonly aiOptOut?: boolean;
}

/** The longest `datePublished` read, in characters. */
const MAX_DATE_CHARS = 40;

/** An ISO 8601 date, with an optional time and zone: anchored, with no repetition that could backtrack. */
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})?)?$/u;

/** A stated boolean: `true`, `false`, or the text of either in any case. Anything else is not one. */
function statedBoolean(value: unknown): boolean | undefined {
    const raw = scalar(value);

    if (typeof raw === 'boolean') {
        return raw;
    }

    const text = typeof raw === 'string' ? raw.trim().toLowerCase() : undefined;

    return text === 'true' ? true : text === 'false' ? false : undefined;
}

/** An ISO 8601 date as written, when its calendar date is real ("2024-02-30" is not). */
function isoDate(value: unknown): string | undefined {
    const text = textOf(scalar(value));
    const match = text !== undefined && text.length <= MAX_DATE_CHARS ? ISO_DATE.exec(text) : null;

    if (match === null) {
        return undefined;
    }

    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const date = new Date(Date.UTC(year, month - 1, day));

    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
        ? text
        : undefined;
}

/**
 * Read what a Recipe node states about access and age.
 *
 * @param node - A JSON-LD Recipe node or a microdata item shaped like one.
 * @returns The facts; a field the node does not state usably is absent. Pure.
 */
export function accessOf(node: SchemaNode): PageAccess {
    const isAccessibleForFree = statedBoolean(field(node, 'isAccessibleForFree'));
    const datePublished = isoDate(field(node, 'datePublished'));

    return Object.freeze({
        ...(isAccessibleForFree === undefined ? {} : { isAccessibleForFree }),
        ...(datePublished === undefined ? {} : { datePublished }),
    });
}

/** The robots tokens that reserve a page from AI. */
const NO_AI_TOKENS: ReadonlySet<string> = new Set(['noai', 'noimageai']);

/**
 * Whether a page reserves its content from AI and text-and-data mining (see {@link PageEvidence.aiOptOut}).
 *
 * @param metas - The page's `<meta>` elements, as `name` and `content`.
 * @returns `true`, `false` or `undefined` (no signal). Pure.
 */
export function aiOptOutOf(
    metas: readonly { readonly name?: string; readonly content?: string }[],
): boolean | undefined {
    let notReserved = false;

    for (const { name, content } of metas) {
        const key = name?.trim().toLowerCase();
        const value = content?.trim().toLowerCase() ?? '';

        if (key === 'tdm-reservation' && value === '1') {
            return true;
        }

        if (key === 'robots' && value.split(/[\s,]+/u).some((token) => NO_AI_TOKENS.has(token))) {
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
