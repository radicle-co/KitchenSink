/**
 * Matvaretabellen's `foods.json` as a mirror pull (plan U28, KTD-26). The publisher's "API" is the whole table as
 * static JSON files, which it invites callers to cache; `/api/en/foods.json` lists every food with every constituent.
 *
 * Each food is keyed by its `foodId`, which equals the xlsx `Matvare ID` the committed extract is keyed by, and keeps
 * the object exactly as published as its payload. Keys and names are trimmed as the xlsx extractor trims them: the
 * 2026-10-01 file holds 13 names with stray whitespace and the id `'01.332 '`.
 *
 * The document is read loosely, since a field the publisher adds is not a reason to stop mirroring, and each food
 * strictly in the two fields the mirror keys on.
 *
 * @pattern Parser — the publisher's document in, a versioned pull or a refusal out
 * @module
 */
import { z } from 'zod';

import { mirrorPullOf, type MirrorEntry, type MirrorPull } from '../mirror/mirrorFeed.js';
import { MirrorFeedFormatError } from '../mirror/mirrorFeed.errors.js';

const documentSchema = z.looseObject({ locale: z.literal('en'), foods: z.array(z.unknown()) });

const foodSchema = z.looseObject({ foodId: z.string(), foodName: z.string() });

/**
 * Read one food as a mirror entry. Pure.
 *
 * @param food - One element of the document's `foods`.
 * @param index - Its position, for a refusal.
 * @returns The entry.
 * @throws {MirrorFeedFormatError} when the food is not an object with a text id and a text name.
 */
function entryOf(food: unknown, index: number): MirrorEntry {
    const parsed = foodSchema.safeParse(food);

    if (!parsed.success) {
        throw new MirrorFeedFormatError(
            `food ${String(index + 1)}`,
            parsed.error.issues.map((issue) => `${issue.path.join('.') || '(food)'}: ${issue.message}`).join('; '),
        );
    }

    return { externalKey: parsed.data.foodId.trim(), name: parsed.data.foodName.trim(), payload: parsed.data };
}

/**
 * Read a `foods.json` document. Pure.
 *
 * @param text - The document's text.
 * @returns Every food, versioned.
 * @throws {MirrorFeedFormatError} when the text is not JSON, not the English document, or a food is not readable, or
 *   when an id repeats once trimmed or a name is blank.
 */
export function parseMatvaretabellenFoods(text: string): MirrorPull {
    let value: unknown;

    try {
        value = JSON.parse(text);
    } catch {
        throw new MirrorFeedFormatError('document', 'is not JSON');
    }

    const document = documentSchema.safeParse(value);

    if (!document.success) {
        throw new MirrorFeedFormatError(
            'document',
            document.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; '),
        );
    }

    return mirrorPullOf(document.data.foods.map(entryOf));
}
