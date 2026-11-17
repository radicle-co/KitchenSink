/**
 * THE CANONICAL INPUT of a recipe's content digest: the saved steps, ingredient lines and language.
 *
 * DESIGN PATTERN: **content-addressed key + Port**, like `parsing/parseKey.ts`. This module owns what goes into
 * the digest and in what order; the caller hashes the returned string (SHA-256, hex), so `recipe-core` stays free
 * of a crypto dependency and the service and the worker cannot drift on the preimage.
 *
 * Text goes through `sanitizeFoodName` (NFKC, invisible characters removed, whitespace collapsed), so composed and
 * decomposed accents and invisible characters never change a digest. The wording shingles use `comparisonForm`, which
 * goes further (case dropped, accents stripped, dashes and apostrophes folded), and the digest deliberately does not:
 * the shingles decide whether two texts are ALIKE, the digest decides whether a text CHANGED, so two different words
 * must never share one. Empty lines are dropped, so an edit that changes no words changes no digest. Step order is
 * meaningful and kept. Steps and ingredient lines are separate lists, because a step names
 * ingredients and an ingredient rename must change the digest. `v` versions the format.
 */

import { sanitizeFoodName } from '../foodName.js';

/** The saved content a digest covers. Taken from the server row, never a device draft. */
export interface ContentDigestParts {
    readonly steps: readonly string[];
    readonly ingredientLines: readonly string[];
    readonly language: string;
}

const tidy = (lines: readonly string[]): string[] =>
    lines.map((line) => sanitizeFoodName(line)).filter((line) => line !== '');

/**
 * The canonical JSON string to hash. Property order is fixed here, not by the caller.
 */
export function contentDigestInput({ steps, ingredientLines, language }: ContentDigestParts): string {
    return JSON.stringify({
        v: 1,
        lang: sanitizeFoodName(language),
        steps: tidy(steps),
        ingredients: tidy(ingredientLines),
    });
}
