/**
 * What a page says about WHO made a recipe and WHERE its picture is: evidence beside the recipe, never part of it.
 *
 * A `PageRecipe` stays exactly what becomes the import. Credit and the image address ride beside it, for the
 * statement step and the legal check, so a recipe cannot assert its own provenance.
 *
 * ⛔ Nothing is guessed. Markup that states no licence states none (016 FR-012b): every field may be absent. A text field
 * past its bound is LEFT OUT, never cut short, so a half-sentence is never shown as the credit. An image address is a
 * string only: it is never fetched, and only an absolute `http` or `https` address is kept.
 */
import { safeHttpUrl } from '../externalUrl.js';
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

/** Evidence beside a recipe. */
export interface PageEvidence {
    readonly credit: PageCredit;
    /** An absolute http(s) address, never fetched. ABSENT when the page names none that is usable. */
    readonly imageUrl?: string;
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
