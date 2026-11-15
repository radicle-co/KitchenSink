/**
 * Reading values out of parsed JSON-LD and microdata, which are `unknown` until proven otherwise.
 *
 * ⛔ Every read is of an OWN property (`Object.hasOwn`), so a key such as `constructor` or `__proto__` in a hostile page
 * never reaches `Object.prototype`, and no value is ever copied into an object by key (the `prototypePollutionSinks`
 * guard: a variable key on an object literal drops `__proto__` and lets what it carried travel). A parsed `__proto__` key
 * is plain data here.
 */
import { plainText } from './pageDocument.js';

/** A parsed JSON object, or a microdata item. */
export type SchemaNode = Readonly<Record<string, unknown>>;

/** Whether `value` is an object that is not an array. */
export function isSchemaNode(value: unknown): value is SchemaNode {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The own property `key` of `node`, or `undefined`. */
export function field(node: SchemaNode, key: string): unknown {
    return Object.hasOwn(node, key) ? node[key] : undefined;
}

/** `value` as a list: itself when it is one, `[]` when it is absent, otherwise a list of one. */
export function asList(value: unknown): readonly unknown[] {
    if (Array.isArray(value)) {
        return value as readonly unknown[];
    }

    return value === undefined || value === null ? [] : [value];
}

/**
 * The text of a value, on one line: a string, a number, or a JSON-LD value object (`{"@value": "…"}`). Markup is removed
 * and entities are decoded.
 *
 * @returns The text, or `undefined` when the value holds none (absent, blank, or any other shape). A list reads as its
 *   items joined by a space.
 */
export function textOf(value: unknown): string | undefined {
    if (Array.isArray(value)) {
        // Microdata gives every property as a list; several blocks of one value read as one line.
        const joined = (value as readonly unknown[]).flatMap((item) => textOf(item) ?? []).join(' ');

        return joined === '' ? undefined : joined;
    }

    const raw = isSchemaNode(value) ? field(value, '@value') : value;
    const text = typeof raw === 'string' ? plainText(raw) : typeof raw === 'number' ? String(raw) : '';

    return text === '' ? undefined : text;
}

/**
 * The type names of a node: `@type` (a string or a list) reduced to what follows the last `/` or `#`, so `Recipe`,
 * `schema:Recipe` and `https://schema.org/Recipe` all read `Recipe`.
 */
export function typeNames(node: SchemaNode): readonly string[] {
    return asList(field(node, '@type')).flatMap((type) => {
        if (typeof type !== 'string') {
            return [];
        }

        const name = type.endsWith('/') ? type.slice(0, -1) : type;
        const cut = Math.max(name.lastIndexOf('/'), name.lastIndexOf('#'), name.lastIndexOf(':'));

        return [name.slice(cut + 1)];
    });
}

/** The first item of a list, or the value itself: microdata gives every property as a list. */
export function scalar(value: unknown): unknown {
    return Array.isArray(value) ? (value as readonly unknown[])[0] : value;
}
