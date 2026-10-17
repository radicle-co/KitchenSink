/**
 * @module @commise/features-recipes/byline — the ONE byline rule every surface renders (plan 2026-10-15-010 D11).
 *
 * The Clerk username is the public "@handle" (owner ruling 2026-10-13); the display name stays public beside it. A
 * surface hands in what the wire carries and renders the kind that comes back — the Discover card, the recipe detail
 * meta line, and a clone's "Copied from …" on the collection header, list and pull dialog.
 *
 * ⛔ An erased author is `former` and is decided FIRST: erasure rewrites the display name to the `user_<ULID>`
 * pseudonym and clears the username, so the `name` kind would print a string that reads like a username — and is a
 * legal Clerk one.
 *
 * @pattern Visitor — a discriminated union each surface renders through an exhaustive switch (`bylineText`)
 */
import { isPseudonymizedAuthorHandle } from '@kitchensink/recipe-core';

/** What a surface knows about the person (or source) behind a recipe or collection. */
export interface BylineInput {
    /** The author's Clerk username, when the wire carries one. */
    readonly username?: string;
    /** The author's display name, when the wire carries one. */
    readonly displayName?: string;
    /** Human-readable provenance of an imported recipe (e.g. `Serious Eats`). */
    readonly sourceAttribution?: string;
}

/** The byline to render. */
export type Byline =
    /** A cook with a username; the display name rides along unless it would only repeat the username. */
    | { readonly kind: 'person'; readonly username: string; readonly displayName?: string }
    /** A cook with no username: the display name, never prefixed "@". */
    | { readonly kind: 'name'; readonly displayName: string }
    /** An erased author. */
    | { readonly kind: 'former' }
    /** An imported recipe with no author. */
    | { readonly kind: 'source'; readonly attribution: string }
    /** Nothing known. */
    | { readonly kind: 'none' };

/** A non-blank string, trimmed, or `undefined`. Pure. */
function present(value: string | undefined): string | undefined {
    const trimmed = value?.trim();

    return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}

/** The same handle, compared as a reader would: case-insensitive, a leading "@" ignored. Pure. */
function sameHandle(a: string, b: string): boolean {
    const bare = (value: string): string => value.replace(/^@/, '').toLocaleLowerCase();

    return bare(a) === bare(b);
}

/**
 * Decide the byline. Pure.
 *
 * @param input - What the surface knows.
 * @returns The byline kind with exactly the text it renders.
 */
export function bylineOf(input: BylineInput): Byline {
    const username = present(input.username);
    const displayName = present(input.displayName);
    const attribution = present(input.sourceAttribution);

    if (displayName !== undefined && isPseudonymizedAuthorHandle(displayName)) {
        return { kind: 'former' };
    }

    if (username !== undefined) {
        return displayName === undefined || sameHandle(displayName, username)
            ? { kind: 'person', username }
            : { kind: 'person', username, displayName };
    }

    if (displayName !== undefined) {
        return { kind: 'name', displayName };
    }

    return attribution === undefined ? { kind: 'none' } : { kind: 'source', attribution };
}

/** The first letter of `text` (a whole code point, upper-cased), or `undefined` when it starts with no letter. */
function leadingLetter(text: string | undefined): string | undefined {
    const first = text === undefined ? undefined : Array.from(text)[0];

    return first !== undefined && /\p{L}/u.test(first) ? first.toLocaleUpperCase() : undefined;
}

/**
 * The avatar disc's letter: the username's first letter — the first character a reader sees — else the display
 * name's. `undefined` draws no disc, which is also the answer for a former member, a source and nothing known. Pure.
 */
export function bylineInitial(byline: Byline): string | undefined {
    switch (byline.kind) {
        case 'person':
            return leadingLetter(byline.username) ?? leadingLetter(byline.displayName);
        case 'name':
            return leadingLetter(byline.displayName);
        case 'former':
        case 'source':
        case 'none':
            return undefined;
    }
}
