/**
 * What a cook pasted, read on their device into a recipe and a suggested source.
 *
 * DESIGN PATTERN: **Pipeline**. Size check → detect markup → parse → extract (the chain) → detect the source. Every
 * stage is pure, and the raw page never leaves the device: only the extracted recipe is sent (ADR-0072's rule that the
 * server receives recipes, not the file).
 *
 * ⛔ A hostile paste is bounded at every stage (`pageCaps.ts`): the size is checked in BYTES before anything is parsed
 * and an over-size paste is refused whole, never cut; parsing stops at a depth cap; JSON-LD is size-, count-, depth- and
 * node-bounded. Nothing is executed, fetched or logged, and no regular expression runs over the paste.
 *
 * ⚠️ {@link PageRecipe} is a plain shape, not the service's `ImportRecipe`: `@kitchensink/schema-recipe` depends on this
 * package. The caller parses it with `importRecipeSchema`, the check that a recipe's size and step limits hold.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

import { extractSourceLink } from '../sourceLink.js';
import { detectPageSource } from './detectPageSource.js';
import type { DetectedSource } from './detectPageSource.js';
import { MAX_PASTE_BYTES, classifyPaste } from './pageCaps.js';
import { parsePage } from './pageDocument.js';
import { imageUrlOf } from './pageEvidence.js';
import type { PageEvidence } from './pageEvidence.js';
import type { PageRecipe, UnusableReason } from './pageRecipeCandidate.js';
import { extractRecipe } from './recipeExtractors.js';

/** Why a paste cannot be used: its recipe breaks a limit, or the page is nested too deeply to read all of it. */
export type PasteUnusableReason = UnusableReason | 'pageTooDeep';

/** What reading a paste came to. Every result but `tooLarge` carries the digest of the paste it read. */
export type PasteReadResult =
    | {
          readonly kind: 'found';
          readonly recipe: PageRecipe;
          readonly evidence: PageEvidence;
          readonly source: DetectedSource;
          readonly pasteDigest: string;
      }
    | {
          readonly kind: 'several';
          readonly titles: readonly string[];
          /** Each recipe in `titles` order, read and with its own evidence and suggested source, for the cook's pick. */
          readonly choices: readonly PasteChoice[];
          readonly pasteDigest: string;
      }
    | { readonly kind: 'none'; readonly source: DetectedSource; readonly pasteDigest: string }
    | { readonly kind: 'tooLarge'; readonly maxBytes: number }
    | { readonly kind: 'unusable'; readonly reason: PasteUnusableReason; readonly pasteDigest: string };

/** One of several recipes on a page: ready to send with its source, or over a limit. */
export type PasteChoice =
    | {
          readonly kind: 'found';
          readonly recipe: PageRecipe;
          readonly evidence: PageEvidence;
          readonly source: DetectedSource;
      }
    | { readonly kind: 'unusable'; readonly reason: UnusableReason };

const NO_SOURCE: DetectedSource = { kind: 'none' };

/** The evidence for one found recipe: its credit, and its image made absolute against the detected source. */
function evidenceOf(
    credit: PageEvidence['credit'],
    imageRefs: readonly string[],
    source: DetectedSource,
): PageEvidence {
    const imageUrl = imageUrlOf(imageRefs, source.kind === 'found' ? source.citation.url : undefined);

    return Object.freeze({ credit, ...(imageUrl === undefined ? {} : { imageUrl }) });
}

/**
 * Read a paste.
 *
 * What counts as a page, and as too large, is `classifyPaste`'s one rule. Anything that is not a page goes straight to
 * `none`, and a line that is only a link in it is the suggested source (`extractSourceLink`, ADR-0089). A page goes
 * through the extractor chain, and its source is the address it states for itself.
 *
 * @param text - Everything the cook pasted.
 * @returns `found` (the recipe, its evidence and a suggested source), `several` (the titles and each choice), `none` (no
 *   structured recipe, with any source found), `tooLarge` (over {@link MAX_PASTE_BYTES}), or `unusable`. All but
 *   `tooLarge` carry `pasteDigest`, the SHA-256 hex of the UTF-8 paste. Pure.
 */
export function readPastedContent(text: string): PasteReadResult {
    const kind = classifyPaste(text);

    if (kind === 'tooLarge') {
        return { kind: 'tooLarge', maxBytes: MAX_PASTE_BYTES };
    }

    const pasteDigest = bytesToHex(sha256(utf8ToBytes(text)));

    if (kind !== 'page') {
        const { link } = extractSourceLink(text);

        return {
            kind: 'none',
            source: link === undefined ? NO_SOURCE : { kind: 'found', citation: link },
            pasteDigest,
        };
    }

    const page = parsePage(text);
    const extraction = extractRecipe(page);

    switch (extraction.kind) {
        case 'found': {
            const source = detectPageSource(page, extraction.links);

            return {
                kind: 'found',
                recipe: extraction.recipe,
                evidence: evidenceOf(extraction.credit, extraction.imageRefs, source),
                source,
                pasteDigest,
            };
        }

        case 'several':
            return {
                kind: 'several',
                titles: extraction.titles,
                choices: extraction.choices.map((choice): PasteChoice => {
                    if (choice.kind === 'unusable') {
                        return choice;
                    }

                    const source = detectPageSource(page, choice.links);

                    return {
                        kind: 'found',
                        recipe: choice.recipe,
                        evidence: evidenceOf(choice.credit, choice.imageRefs, source),
                        source,
                    };
                }),
                pasteDigest,
            };
        case 'unusable':
            return { kind: 'unusable', reason: extraction.reason, pasteDigest };
        case 'none':
            // A page cut short for depth may have held the recipe past the cut: say so rather than "no recipe".
            return page.truncated
                ? { kind: 'unusable', reason: 'pageTooDeep', pasteDigest }
                : { kind: 'none', source: detectPageSource(page, []), pasteDigest };
    }
}
