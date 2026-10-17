/**
 * @module @commise/ui/recipe-cover — the monogram cover's pure rules (`docs/design/uiOverhaul/buildSpec.md` §1.8): which
 * of six tints a recipe's cover takes, and which letter it shows.
 *
 * The tint is chosen by a hash of the recipe's id, never by its cuisine, so the same recipe wears the same ground on
 * every screen and both platforms and two recipes of one cuisine do not all look alike. The hash is 32-bit FNV-1a over
 * the id's UTF-16 code units: a bucket hash, not a security boundary, so no library is needed (blueprint, RecipeCover).
 *
 * The tint is NAMED here, not valued: its light and dark values are tokens (`tokens/covers.ts`), each opaque so a cover
 * reads the same on cards, sheets and the canvas, and the theme picks one at render (D15).
 */
import { COVER_TINT_NAMES, type CoverTintName } from '../tokens/covers.js';

/** The 32-bit FNV-1a offset basis and prime. */
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * The tint a recipe's monogram cover takes. Pure.
 *
 * @param recipeId - The recipe's id.
 * @returns One of the six tint names; the theme gives its value (`tokens/covers.ts`).
 */
export function coverTintOf(recipeId: string): CoverTintName {
    let hash = FNV_OFFSET;

    for (let index = 0; index < recipeId.length; index += 1) {
        hash ^= recipeId.charCodeAt(index);
        hash = Math.imul(hash, FNV_PRIME) >>> 0;
    }

    return COVER_TINT_NAMES[hash % COVER_TINT_NAMES.length] as CoverTintName;
}

/**
 * What a monogram skips before the title's first letter: space and the punctuation a title can open with.
 *
 * ⚠️ A list rather than `\p{L}`: this module ships to Hermes, whose support for Unicode property escapes is unverified
 * (`docs/architecture/uiOverhaulBlueprint.md`, "Assumed" 1), and a regex that fails to compile at module scope would
 * take the whole bundle down. A caseless script (CJK) still works, because only the listed characters are skipped.
 */
const LEADING = /[\s"'“”‘’«»‹›()[\]{}.,;:!?¡¿…\-–—_*#/\\]/;

/**
 * The letter a monogram cover shows: the title's first character that is not space or punctuation, upper-cased. Pure.
 *
 * @param title - The recipe's title.
 * @returns The letter, or `''` when the title has none (the cover then shows its ground alone).
 */
export function monogramOf(title: string): string {
    return (Array.from(title).find((character) => !LEADING.test(character)) ?? '').toLocaleUpperCase();
}
