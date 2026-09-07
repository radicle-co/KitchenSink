/**
 * The corpus REGISTRY — the public-domain cookbooks this tool imports from.
 *
 * DESIGN PATTERN: **Lookup table** (data, not mechanism). Frozen, exhaustive, and the ONE place a book's
 * identity, its licence evidence and the attribution string a reader will see are written down together.
 *
 * ## ⛔ The files are NOT in this repository, and are NOT fetched at runtime
 *
 * An operator downloads them once, by hand, and passes the path (`--file`). See `README.md`. The reason is
 * not repository size — it is that Project Gutenberg's Terms state the site "is intended for human users
 * only" and that automated access "will result in a temporary or permanent block of your IP address",
 * while its `robots.txt` only disallows `/ebooks/search` (both verified 2026-08-19). **robots.txt
 * compliance is not terms-of-use compliance.** A service-side fetch would put a whole stage's shared
 * `t4g.nano` NAT egress IP (ADR-0004) behind that block. See ADR-0023.
 *
 * ## Public-domain evidence
 *
 * Each entry was verified by reading the file's own header, which must carry Project Gutenberg's
 * unrestricted-use sentence — "This eBook is for the use of anyone anywhere in the United States and most
 * other parts of the world at no cost and with almost no restrictions whatsoever" — and NOT the
 * "copyrighted Project Gutenberg eBook" variant. {@link PUBLIC_DOMAIN_HEADER} is that sentence, and
 * {@link assertPublicDomain} re-checks it against the actual bytes at import time, so the claim is
 * verified per run rather than trusted from this comment.
 *
 * ## ⚠️ The attribution string is a ONE-WAY DOOR
 *
 * It is written into `recipes.source_attribution` on public rows and RENDERED on the recipe detail view.
 * Changing the format afterwards is a data migration over public content. The chosen form names the
 * ORIGINAL work and author (the public-domain thing) and credits Project Gutenberg as the transcription
 * source, which is where the copy came from. It does not reproduce the PG licence header, and it does not
 * use the Project Gutenberg trademark to describe the recipe itself. **Flagged for owner/legal review.**
 */

import type { BookMeasures } from './unitEquivalence.js';

/** Project Gutenberg's unrestricted-use sentence — the evidence a given file is public domain in the US. */
export const PUBLIC_DOMAIN_HEADER = 'This eBook is for the use of anyone anywhere in the United States and';

/** One public-domain cookbook. */
export interface Cookbook {
    /** Project Gutenberg ebook number. */
    readonly ebookId: number;
    /** The work's title, as its own title page gives it. */
    readonly title: string;
    /** The author, as the file's `Author:` header gives it. */
    readonly author: string;
    /** The plain-text URL the operator downloads from — persisted verbatim as `sourceUrl`. */
    readonly sourceUrl: string;
    /** The human-readable credit persisted as `sourceAttribution` and rendered to readers. */
    readonly attribution: string;
    /**
     * Which system of measure this book's volumes are read in, and whatever of its own table of weights
     * and measures has been transcribed (R33).
     *
     * ⛔ REQUIRED, with no default. R33 asks that each book's table be "read and recorded BEFORE that book
     * is imported", and a field the compiler lets you omit records nothing — the book would simply import
     * with its gills silently unconverted, or worse, converted as though it were American. Making it
     * required means registering a book is the moment somebody has to answer the question.
     */
    readonly measures: BookMeasures;
}

/**
 * Build a book entry, deriving the URL and the attribution from the identity so the three cannot disagree.
 *
 * Deriving rather than restating is the point: a hand-typed `sourceUrl` whose ebook id does not match the
 * entry's is a mislabelled provenance on a public recipe, which is exactly the failure attribution exists
 * to prevent, and it is invisible in review.
 *
 * @param ebookId - Project Gutenberg ebook number.
 * @param title - The work's title.
 * @param author - The work's author.
 * @param measures - The book's measure system and its own table of weights and measures (R33).
 * @returns The frozen entry. Pure.
 */
function cookbook(ebookId: number, title: string, author: string, measures: BookMeasures): Cookbook {
    return Object.freeze({
        ebookId,
        title,
        author,
        sourceUrl: `https://www.gutenberg.org/cache/epub/${ebookId}/pg${ebookId}.txt`,
        attribution: `${title} by ${author} (Project Gutenberg eBook #${ebookId}, public domain)`,
        measures,
    });
}

/**
 * The three American books whose own tables have not been read.
 *
 * ⚠️ SHARED because the two facts are literally the same two facts, not because the entries
 * look alike: each is an American work of the 1900s-1920s (recorded in the corpus survey of 2026-08-19
 * that selected them), and none of the three files is held locally, so no table has been transcribed from
 * any of them. If one is ever downloaded and read, it stops sharing this value and gets its own —
 * which is exactly the signal that the shared one was knowledge rather than coincidence.
 */
const AMERICAN_UNREAD: BookMeasures = {
    origin: {
        kind: 'established',
        system: 'us-customary',
        basis:
            'An American work of the 1900s-1920s; four of the five registered books are American, recorded ' +
            'in the corpus survey of 2026-08-19 that selected them.',
    },
};

/**
 * The registered corpus, keyed by the `--book` argument.
 *
 * Every entry is ALL-CAPS-heading, prose-bodied domestic cookery — the shape this tool's adapter reads.
 * They differ in the ways that matter, deliberately, so the parser is exercised rather than tuned to one
 * book: #12327 prints a trailing period on its headings, and #55555 and #31534 write quantities as
 * NUMERALS where the others spell them out.
 *
 * ## ⛔ MEMBERSHIP IS A QUALITY DECISION, NOT A LICENCE ONE — and most public-domain cookbooks FAIL it
 *
 * The public-domain header ({@link assertPublicDomain}) is the floor, not the bar. A book also has to
 * SEGMENT: `segmentCookbook` recognises a heading only as a
 * lone ALL-CAPS line, so a book that sets its recipe titles in Title Case, or runs them into the first
 * sentence, collapses whole chapters into ONE block — which then presents as a single "recipe" with
 * dozens of ingredients drawn from a dozen different dishes. That is not a parse failure the skip rules
 * catch (the mega-block has plenty of ingredients, steps and a stated duration), so it would be imported,
 * and it would be garbage.
 *
 * Measured over the 27 Gutenberg texts held locally on 2026-08-19, the tell is INGREDIENT LINES PER
 * ACCEPTED CANDIDATE. A registered book sits at 3.5–6.5; a book whose headings this adapter cannot see
 * sits at 20–180. Rejected on exactly that evidence, and NOT to be added without first teaching the
 * adapter their heading shape: #22790 (32), #26323 (16), #29728 (no candidates at all), #36689 (181),
 * #60598 (30), #65379 (108), #68983 (29), #71395 (33), #9101 (67). Rejected on sampled OUTPUT quality
 * despite an acceptable ratio: #10136 (Beeton — the `INGREDIENTS.--…` block is read as prose, yielding
 * lines like `4 lb or`), #13545 (narrative interleaved with recipes: `44 in large refrigerator`,
 * `7 quart [Illustration`) and #24407 (ingredients bleed across adjacent recipes).
 */
export const COOKBOOKS: Readonly<Record<string, Cookbook>> = Object.freeze({
    'international-jewish': cookbook(12350, 'The International Jewish Cook Book', 'Florence Kreisler Greenbaum', {
        origin: {
            kind: 'established',
            system: 'us-customary',
            basis:
                'The book pins its own system in prose: its TABLE OF WEIGHTS AND MEASURES directs that ' +
                '"the cup should be the regulation half-pint cup", and a half-pint cup is the US customary ' +
                'one. The system is READ OUT of the book rather than assumed from its origin.',
        },
    }),
    'jewish-manual': cookbook(12327, 'The Jewish Manual', 'Lady Judith Cohen Montefiore', {
        origin: {
            kind: 'established',
            system: 'british-imperial',
            basis:
                'A British work — Lady Judith Cohen Montefiore, published London, 1846 — so R33 ' +
                "puts it on its origin's system. This is the book the US/imperial split actually bites on: " +
                'it is the one most likely to state a gill, and an imperial gill is 142 mL against 118 mL.',
        },
    }),
    'golden-rule': cookbook(55555, 'The Golden Rule Cook Book', 'M. R. L. Sharpe', AMERICAN_UNREAD),
    'mrs-wilson': cookbook(17438, "Mrs. Wilson's Cook Book", 'Mary A. Wilson', AMERICAN_UNREAD),
    'sunday-dinners': cookbook(31534, 'Fifty-Two Sunday Dinners', 'Elizabeth O. Hiller', AMERICAN_UNREAD),
});

/** The `--book` keys this tool accepts. */
export type CookbookKey = keyof typeof COOKBOOKS;

/**
 * Fail loudly unless the supplied text carries Project Gutenberg's unrestricted-use header.
 *
 * ⚠️ This runs on the ACTUAL BYTES every run, rather than trusting the registry. The registry records a
 * claim made by a human reading a file once; this checks the file in front of us. A copyrighted Project
 * Gutenberg ebook (they exist, and they carry a different header) would otherwise be imported and
 * published as `imported_public` — a licence violation asserted in a user-visible attribution line.
 *
 * @param plainText - The downloaded book.
 * @param book - The registry entry it is claimed to be.
 * @throws {Error} When the header is absent — the run aborts rather than importing anything.
 */
export function assertPublicDomain(plainText: string, book: Cookbook): void {
    if (!plainText.includes(PUBLIC_DOMAIN_HEADER)) {
        throw new Error(
            `cookbook-import: the file supplied for "${book.title}" (#${book.ebookId}) does not carry Project ` +
                `Gutenberg's public-domain header. Refusing to import it — a copyrighted ebook must not be ` +
                `published as imported_public.`,
        );
    }
}
