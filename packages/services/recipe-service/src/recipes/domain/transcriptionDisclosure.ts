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
 * form, so it must reach the cook who supplied it (who sees "You wrote: …" beside a `NEEDS_REVIEW` line) and no
 * one else: not another cook, not a signed-out read, not a list, search or version snapshot. A client that hid it
 * would already have received it. The response mapper is typed so it cannot read the columns at all.
 *
 * ## The rule: the viewer owns the recipe AND the owner supplied this line (ADR-0090)
 *
 * Two conditions, both required. Ownership is decided ONCE per read ({@link transcriptionAudienceOf}); the per-line
 * half, `source_line_transcribed_by_owner`, is read in {@link disclosedSourceLine}, the only function that reads a
 * line. Ownership alone is not enough: a clone COPIES the text, because the verification gate judges it, and the
 * cloner then owns a copy of another cook's words. Lineage is not enough either: account erasure NULLs a clone's
 * `cloned_from_id`. So the line records who wrote it, when it is written. An `undefined` viewer is a reader, and an
 * unknown writer is "not the owner": the rule fails closed both ways.
 */

/** Who is reading: the recipe's owner, or anyone else. */
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
 * @param line - The stored line: its transcription, and whether the recipe's owner supplied it.
 * @returns The verbatim line for the owner who supplied it; `undefined` otherwise, so the key is omitted.
 */
export function disclosedSourceLine(
    audience: TranscriptionAudience,
    line: { readonly sourceLine: string | null; readonly sourceLineTranscribedByOwner: boolean },
): string | undefined {
    if (
        audience.kind !== 'transcriber' ||
        !line.sourceLineTranscribedByOwner ||
        line.sourceLine === null ||
        line.sourceLine === ''
    ) {
        return undefined;
    }

    return line.sourceLine;
}
