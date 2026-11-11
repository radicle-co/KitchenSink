/**
 * THE TRANSCRIPTION-DISCLOSURE RULE: who may be shown the line a cook pasted or imported.
 *
 * DESIGN PATTERN: **Specification / Policy module**, the sibling of `recipeVisibility.ts` and
 * `provenancePolicy.ts`: pure, total, no I/O, exhaustible as a truth table. The audience is a discriminated
 * union decided ONCE per read, so the line mapper receives a verdict and never a viewer id to compare.
 *
 * ## ⛔ Why this is decided on the server, in one place
 *
 * `ingredients.source_line` is verbatim copied text. ADR-0082 §2 forbids any line word for word on a public
 * form, so it must reach the recipe's owner (who sees "You wrote: …" beside a `NEEDS_REVIEW` line) and no one
 * else: not another cook, not a signed-out read, not a list, search or version snapshot. A client that hid it
 * would already have received it. The response mapper is typed so it cannot read the column at all.
 *
 * ## The seam
 *
 * Today the rule has ONE condition, "the viewer owns the recipe". A per-line "transcribed by the owner"
 * condition would be added in {@link disclosedSourceLine}, the only function that reads a line, and nowhere
 * else. An `undefined` viewer is a reader: the rule fails closed.
 */

/** Who is reading: the cook who transcribed the recipe, or anyone else. */
export type TranscriptionAudience = { readonly kind: 'transcriber' } | { readonly kind: 'reader' };

/**
 * Classify a read's viewer against the recipe. Pure.
 *
 * @param recipe - The recipe being read (only its owner matters).
 * @param viewerId - The viewing principal's app-user ULID, or `undefined` for a read with no viewer.
 * @returns `transcriber` iff the viewer is the owner; `reader` otherwise, including for an `undefined` viewer.
 */
export function transcriptionAudienceOf(
    recipe: { readonly ownerId: string },
    viewerId: string | undefined,
): TranscriptionAudience {
    return viewerId !== undefined && viewerId !== '' && viewerId === recipe.ownerId
        ? { kind: 'transcriber' }
        : { kind: 'reader' };
}

/**
 * The source line this audience may be shown for one stored line, or `undefined`. Pure.
 *
 * @param audience - The read's audience.
 * @param line - The stored line (only its transcription matters).
 * @returns The verbatim line for the transcriber when one is stored; `undefined` otherwise, so the key is omitted.
 */
export function disclosedSourceLine(
    audience: TranscriptionAudience,
    line: { readonly sourceLine: string | null },
): string | undefined {
    if (audience.kind !== 'transcriber' || line.sourceLine === null || line.sourceLine === '') {
        return undefined;
    }

    return line.sourceLine;
}
