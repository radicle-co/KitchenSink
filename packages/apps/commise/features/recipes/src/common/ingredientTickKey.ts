/**
 * @module @commise/features-recipes/common — an ingredient tick's identity: the content of its recipe line (ADR-0096).
 *
 * A key is the line's digest (`l1:` and 8 hex chars over its stored, cook-authored, unscaled fields) and `#n`, the
 * line's ordinal among the lines with that same digest. Two identical butter lines are `d#0` and `d#1`; a different
 * line inserted above, a reorder or a servings change leaves every key as it was. Nothing reconciles or moves a
 * tick: a key matches a line or it matches nothing.
 *
 * The key format is the one persisted thing here. A later field list bumps the digest prefix, and an older client
 * keeps a newer client's keys untouched, because the parser accepts a key of any version.
 *
 * Pure and platform-agnostic. No React, no platform APIs.
 *
 * @pattern Value Object — the branded {@link IngredientTickKey}, a natural key derived from content
 * @pattern Parser — {@link ingredientTickKeysSchema} is the one parse boundary of every store that holds ticks
 */
import { INGREDIENT_LINE_DIGEST_VERSION, ingredientLineDigest } from '@kitchensink/cooking-core';
import type { IngredientLineDigestInput } from '@kitchensink/cooking-core';
import { z } from 'zod';

declare const ingredientTickKeyBrand: unique symbol;

/** An ingredient tick's identity. Branded, so a binding id or a position cannot be passed where a key is meant. */
export type IngredientTickKey = string & { readonly [ingredientTickKeyBrand]: true };

/** A key of ANY digest version: `l`, the version, `:`, 8 lowercase hex chars, `#`, the ordinal. */
const TICK_KEY = /^l\d+:[0-9a-f]{8}#\d+$/;

/**
 * Whether a string is a tick key. The one place the brand is asserted. Pure.
 *
 * @param text - The candidate.
 * @returns `true` for a key of any digest version, `false` for an old binding id or any other string.
 */
export const isIngredientTickKey = (text: string): text is IngredientTickKey => TICK_KEY.test(text);

/**
 * One key per line, in the lines' order.
 *
 * @param lines - A recipe's stored, UNSCALED lines. Scaled lines would key a tick to a servings count.
 * @returns The digest plus a running count per digest. This builds `l1` keys only.
 * @throws RangeError when a built key is not a key, which the digest's format makes unreachable.
 */
export function ingredientTickKeys(lines: readonly IngredientLineDigestInput[]): readonly IngredientTickKey[] {
    const seen = new Map<string, number>();

    return lines.map((line) => {
        const digest = ingredientLineDigest(line);
        const ordinal = seen.get(digest) ?? 0;
        const key = `${digest}#${ordinal}`;

        seen.set(digest, ordinal + 1);

        if (!isIngredientTickKey(key) || !key.startsWith(`l${INGREDIENT_LINE_DIGEST_VERSION}:`)) {
            throw new RangeError(`ingredientTickKeys: built a malformed key ${key}`);
        }

        return key;
    });
}

/**
 * The positions of the lines whose keys are ticked.
 *
 * @param keys - The key of each line, in order.
 * @param ticked - The ticked keys. A key no line has is ignored.
 * @returns The ticked positions.
 */
export function tickedPositions(
    keys: readonly IngredientTickKey[],
    ticked: ReadonlySet<IngredientTickKey>,
): ReadonlySet<number> {
    return new Set(keys.flatMap((key, position) => (ticked.has(key) ? [position] : [])));
}

/**
 * The parse boundary for stored ticks: any array of strings, keeping only the keys. An old binding id is dropped
 * without losing the rest, so one bad item never costs a whole record.
 */
export const ingredientTickKeysSchema = z.array(z.string()).transform((all) => all.filter(isIngredientTickKey));
