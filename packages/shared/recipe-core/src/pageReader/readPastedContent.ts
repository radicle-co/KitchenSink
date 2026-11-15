/**
 * What a cook pasted, read on their device into a recipe and a suggested source.
 *
 * DESIGN PATTERN: **Pipeline**. Size check → detect markup → parse → extract (the chain) → select one → gate → detect the source. Every
 * stage is pure, and the raw page never leaves the device: only the extracted recipe is sent (ADR-0072's rule that the
 * server receives recipes, not the file).
 *
 * ⛔ A hostile paste is bounded at every stage (`pageCaps.ts`): the size is checked in BYTES before anything is parsed
 * and an over-size paste is refused whole, never cut; parsing stops at a depth cap; JSON-LD is size-, count-, depth- and
 * node-bounded. Nothing is executed, fetched or logged, and no regular expression runs over a page. (A paste that is not a page goes to `extractSourceLink`, which runs one pattern per line, bounded by the line's length.)
 *
 * ⚠️ {@link PageRecipe} is a plain shape, not the service's `ImportRecipe`: `@kitchensink/schema-recipe` depends on this
 * package. The caller parses it with `importRecipeSchema`, the check that a recipe's size and step limits hold.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

import { extractSourceLink } from '../sourceLink.js';
import { detectPageSource, pageAddressesOf } from './detectPageSource.js';
import type { DetectedSource } from './detectPageSource.js';
import { MAX_PASTE_BYTES, classifyPaste } from './pageCaps.js';
import { parsePage } from './pageDocument.js';
import { imageUrlOf } from './pageEvidence.js';
import type { PageEvidence } from './pageEvidence.js';
import type { ExtractionTier, PageRecipe } from './pageRecipeCandidate.js';
import { acceptRecipe } from './recipeAcceptance.js';
import type { AcceptanceReason } from './recipeAcceptance.js';
import { extractRecipe } from './recipeExtractors.js';
import { selectCandidate } from './recipeSelection.js';

/** Why a paste gives no recipe: the page, the selection, or the first gate predicate it fails. */
export type NotExtractableReason =
    | AcceptanceReason
    /** Not a page: a text paste. */
    | 'notAPage'
    /** The page is nested deeper than the reader looks, and no recipe was found before the cut. */
    | 'pageTooComplex'
    /** The page has no structured recipe. */
    | 'noRecipe'
    /** The page holds several distinct recipes and none is the page's own. There is no pick-one. */
    | 'severalRecipes';

/**
 * What reading a paste came to: a recipe, or a plain no (owner ruling 2026-11-15: no review in the middle, no AI).
 * Every result but `tooLarge` carries the digest of the paste it read.
 */
export type PasteReadResult =
    | {
          readonly kind: 'extracted';
          readonly recipe: PageRecipe;
          readonly evidence: PageEvidence;
          readonly source: DetectedSource;
          /** Which strategy read it: for measurement on the device, never sent to the server. */
          readonly tier: ExtractionTier;
          readonly pasteDigest: string;
      }
    | {
          readonly kind: 'notExtractable';
          readonly reason: NotExtractableReason;
          /** The title of the recipe that was found and refused, so "We found {title}" can be said. */
          readonly title?: string;
          readonly source: DetectedSource;
          readonly pasteDigest: string;
      }
    | { readonly kind: 'tooLarge'; readonly maxBytes: number };

const NO_SOURCE: DetectedSource = { kind: 'none' };

/** A no, with the source the page still names and, when a recipe was found and refused, its title. */
function notExtractable(
    reason: NotExtractableReason,
    source: DetectedSource,
    pasteDigest: string,
    title?: string,
): PasteReadResult {
    return { kind: 'notExtractable', reason, ...(title === undefined ? {} : { title }), source, pasteDigest };
}

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
 * `notAPage`, and a line that is only a link in it is the suggested source (`extractSourceLink`, ADR-0089). A page goes
 * through the extractor chain; the one recipe it is about is selected (`recipeSelection.ts`) and judged (`recipeAcceptance.ts`).
 * A structured recipe the gate refuses is a no, and never falls through to a weaker reading (`recipeExtractors.ts`).
 *
 * @param text - Everything the cook pasted.
 * @returns `extracted` (the recipe, its evidence, a suggested source and the tier), `notExtractable` (why, and any source
 *   found), or `tooLarge` (over {@link MAX_PASTE_BYTES}). All but `tooLarge` carry `pasteDigest`, the SHA-256 hex of the
 *   UTF-8 paste. Pure.
 */
export function readPastedContent(text: string): PasteReadResult {
    const kind = classifyPaste(text);

    if (kind === 'tooLarge') {
        return { kind: 'tooLarge', maxBytes: MAX_PASTE_BYTES };
    }

    const pasteDigest = bytesToHex(sha256(utf8ToBytes(text)));

    if (kind !== 'page') {
        const { link } = extractSourceLink(text);

        return notExtractable(
            'notAPage',
            link === undefined ? NO_SOURCE : { kind: 'found', citation: link },
            pasteDigest,
        );
    }

    const page = parsePage(text);
    const extraction = extractRecipe(page);
    const addresses = pageAddressesOf(page);

    if (extraction.kind === 'none') {
        // A page cut short for depth may have held the recipe past the cut: say so rather than "no recipe".
        return notExtractable(
            page.truncated ? 'pageTooComplex' : 'noRecipe',
            detectPageSource(addresses, []),
            pasteDigest,
        );
    }

    const selection = selectCandidate(extraction.candidates, addresses);

    if (selection.kind === 'several') {
        return notExtractable('severalRecipes', detectPageSource(addresses, []), pasteDigest);
    }

    const { candidate } = selection;
    const source = detectPageSource(addresses, candidate.links);
    const acceptance = acceptRecipe(candidate.recipe, extraction.tier);

    return acceptance.ok
        ? {
              kind: 'extracted',
              recipe: candidate.recipe,
              evidence: evidenceOf(candidate.credit, candidate.imageRefs, source),
              source,
              tier: extraction.tier,
              pasteDigest,
          }
        : notExtractable(acceptance.reason, source, pasteDigest, candidate.title);
}
