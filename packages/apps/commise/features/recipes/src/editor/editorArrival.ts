/**
 * @module @commise/features-recipes/editor — where the editor opens: a section, and optionally one ingredient line.
 *
 * The web hash (`#ingredients/{version}.{position}`) and the native route params (`section`, `line`) are two spellings
 * of one thing, and {@link arrivalOf} is the ONE parser for both. A link is input from outside memory, so it is
 * parsed once, here, at the edge: only a safe non-negative integer survives (`seedLineKey` throws on anything else),
 * and a line address is dropped for every section but Ingredients.
 *
 * Pure and platform-agnostic. No React, no platform APIs.
 *
 * @pattern Value Object — {@link EditorArrival}, parsed once at the edge
 */
import { isEditorSectionId, type EditorSectionId } from './sections.js';

/** A stored ingredient line, named by the recipe version it was read at and its position in that read. */
export interface LineAddress {
    readonly version: number;
    readonly position: number;
}

/** Where the editor opens. */
export interface EditorArrival {
    readonly section: EditorSectionId;
    /** Present only for `ingredients`. */
    readonly line?: LineAddress;
}

const isIndex = (value: unknown): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const lineOf = (line: unknown): LineAddress | undefined => {
    if (typeof line !== 'object' || line === null) {
        return undefined;
    }

    const { version, position } = line as { version?: unknown; position?: unknown };

    return isIndex(version) && isIndex(position) ? { version, position } : undefined;
};

/**
 * Parse an arrival from untrusted parts (route params, or the hash's pieces).
 *
 * @param section - A section id, if the caller has one.
 * @param line - A `{ version, position }` address, if the caller has one.
 * @returns The arrival, or `undefined` without a known section. A bad address is dropped, the section kept. Pure.
 */
export function arrivalOf(section?: unknown, line?: unknown): EditorArrival | undefined {
    if (typeof section !== 'string' || !isEditorSectionId(section)) {
        return undefined;
    }

    const address = section === 'ingredients' ? lineOf(line) : undefined;

    return address === undefined ? { section } : { section, line: address };
}

const ADDRESS = /^(\d+)\.(\d+)$/;

/**
 * The arrival a URL hash names (blueprint A16): `#ingredients` or `#ingredients/{version}.{position}`. Read once, on
 * mount; the hash never reaches the server.
 *
 * @param hash - `location.hash`, with or without its `#`.
 * @returns The arrival, or `undefined` for an empty or unknown hash. Pure.
 */
export function arrivalFromHash(hash: string): EditorArrival | undefined {
    const text = hash.startsWith('#') ? hash.slice(1) : hash;
    const slash = text.indexOf('/');
    const name = slash === -1 ? text : text.slice(0, slash);
    const match = slash === -1 ? null : ADDRESS.exec(text.slice(slash + 1));

    return arrivalOf(name, match === null ? undefined : { version: Number(match[1]), position: Number(match[2]) });
}

/**
 * The hash that opens `arrival` — the inverse of {@link arrivalFromHash}.
 *
 * @param arrival - Where to open.
 * @returns `#section`, or `#ingredients/{version}.{position}`. Pure.
 */
export function arrivalHash(arrival: EditorArrival): string {
    const { section, line } = arrival;

    return line === undefined ? `#${section}` : `#${section}/${line.version}.${line.position}`;
}
