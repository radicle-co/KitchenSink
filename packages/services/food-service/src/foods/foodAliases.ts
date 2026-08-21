/**
 * THE STORED FORM OF A FOOD'S CURATED ALIASES — one place, used by every writer.
 *
 * USDA publishes a curated alias table nobody had to build: 9,648 "additional descriptions" across 5,432
 * FNDDS main descriptions — brands, regional synonyms and alternate forms (`Tillamook`, `Longhorn`,
 * `sharp cheese` for `Cheese, Cheddar`). This module owns how that list becomes the single `food.aliases`
 * text the search vector is generated from, and it is the sibling of {@link ../foods/foodName.js} for the
 * same reason: an alias is shared, ownerless, searched catalog text, so it carries the same Unicode
 * hazards a display name does and gets the same hygiene.
 *
 * ## ⛔ Why ONE `text` column and not `text[]`
 *
 * `food.aliases_search_vector` is a STORED GENERATED column, and Postgres requires a generated
 * expression to be **IMMUTABLE**. `array_to_string` is marked **STABLE** (`pg_proc.provolatile = 's'`,
 * verified on PostgreSQL 16.14), so
 *
 *     ALTER TABLE food ADD COLUMN v tsvector
 *       GENERATED ALWAYS AS (to_tsvector('english', array_to_string(aliases, ' '))) STORED;
 *
 * fails outright with `generation expression is not immutable`. The list is therefore flattened here,
 * once, at the write boundary — which makes the delimiter part of the stored contract and is why
 * {@link joinAliases} re-punctuates a value that contains it rather than emitting a string that cannot be
 * read back unambiguously.
 *
 * ⚠️ `array_to_tsvector` IS immutable and is still the wrong tool: it makes each element a lexeme
 * VERBATIM, with no stemming and no case folding, so a stored `Tillamook` would never match a typed
 * `tillamook`.
 */
import { sanitizeFoodName } from './foodName.js';

/**
 * The delimiter separating aliases inside the stored `food.aliases` text.
 *
 * `; ` mirrors USDA's own separator on the search envelope (`'Pioneer;New York;Tillamook;…'`), and the
 * trailing space keeps the flattened text readable in a query result and in `to_tsvector`'s input.
 */
export const ALIAS_DELIMITER = '; ';

/**
 * Longest alias kept. Mirrors the adapter's `NAME_MAX_LENGTH`: an alias is a name, and a value longer
 * than a name is upstream corruption rather than a synonym anyone would type.
 */
export const ALIAS_MAX_LENGTH = 256;

/**
 * Most aliases kept for one food. USDA's richest FNDDS rows carry well under twenty; the bound exists
 * because this text feeds a STORED GENERATED tsvector that is recomputed on EVERY write to the row, so
 * an unbounded upstream list is a write-amplification and index-bloat concern, not a display one.
 */
export const MAX_ALIASES = 64;

/** The reserved {@link ALIAS_DELIMITER} character, as it can appear inside a single alias value. */
const RESERVED_DELIMITER = /;/gu;

/**
 * Reduce a source's alias list to the values the catalog stores: catalog-name hygiene applied to each,
 * blanks and over-length values dropped, case-insensitive duplicates folded onto the first spelling, the
 * delimiter re-punctuated, and the list capped — all preserving order, because the order IS USDA's
 * curation rank and the first alias is the most representative one. Idempotent. Pure.
 *
 * Value-grain, never whole-candidate: this runs at the merge boundary alongside the nutrient/portion
 * filters (`mergeSanitize.ts`), and one malformed synonym must not cost a food its nutrition.
 *
 * @param values - The source's alias values, in its own rank order.
 * @returns The storable aliases, in order.
 */
export function normalizeAliases(values: readonly string[]): string[] {
    const kept: string[] = [];
    const seen = new Set<string>();

    for (const value of values) {
        const alias = sanitizeFoodName(value).replace(RESERVED_DELIMITER, ',');

        if (alias.length === 0 || alias.length > ALIAS_MAX_LENGTH) {
            continue;
        }

        const key = alias.toLowerCase();

        if (seen.has(key)) {
            continue;
        }

        seen.add(key);
        kept.push(alias);

        if (kept.length === MAX_ALIASES) {
            break;
        }
    }

    return kept;
}

/**
 * Flatten an alias list into the single text `food.aliases` stores, or `null` when nothing survives.
 *
 * ⚠️ `null`, never `''`: "this food has no curated aliases" is ABSENCE, and GR-019 forbids an
 * empty-string sentinel for it. An `''` would also be indistinguishable from "we tried and got nothing",
 * which is the state a later refresh needs to tell apart. Pure.
 *
 * @param values - The source's alias values, in rank order.
 * @returns The storable text, or `null` when the food has no usable alias.
 */
export function joinAliases(values: readonly string[]): string | null {
    const normalized = normalizeAliases(values);

    return normalized.length === 0 ? null : normalized.join(ALIAS_DELIMITER);
}
